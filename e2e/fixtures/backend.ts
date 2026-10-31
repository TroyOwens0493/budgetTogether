import { randomUUID } from "node:crypto";
import { getFunctionName } from "convex/server";
import * as accounts from "../../convex/accounts";
import { authComponent } from "../../convex/auth";
import * as budgets from "../../convex/budgets";
import * as investments from "../../convex/investments";
import * as personalAllocations from "../../convex/personalAllocations";
import * as projections from "../../convex/projections";
import * as sharing from "../../convex/sharing";
import { Memory } from "./memory";

type Handler = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handlers = new Map<string, unknown>([
	["budgets:home", budgets.home],
	["budgets:setup", budgets.setup],
	["budgets:dashboard", budgets.dashboard],
	["budgets:ensureMonth", budgets.ensureMonth],
	["budgets:savePlan", budgets.savePlan],
	["budgets:funds", budgets.funds],
	["budgets:saveFund", budgets.saveFund],
	["budgets:transactions", budgets.transactions],
	["budgets:saveTransaction", budgets.saveTransaction],
	["accounts:list", accounts.list],
	["budgets:repeatPlan", budgets.repeatPlan],
	["budgets:review", budgets.review],
	["budgets:alerts", budgets.alerts],
	["budgets:readAlert", budgets.readAlert],
	["budgets:reports", budgets.reports],
	["budgets:recurring", budgets.recurring],
	["budgets:transactions", budgets.transactions],
	["budgets:categories", budgets.categories],
	["budgets:saveTransaction", budgets.saveTransaction],
	["accounts:list", accounts.list],
	["accounts:connections", accounts.connections],
	["projections:list", projections.list],
	["projections:saveSettings", projections.saveSettings],
	["projections:saveHolding", projections.saveHolding],
	["projections:removeHolding", projections.removeHolding],
	["projections:includeAccount", projections.includeAccount],
	["investments:reserveReturn", investments.reserveReturn],
	["investments:storeReturn", investments.storeReturn],
	["personalAllocations:list", personalAllocations.list],
	["personalAllocations:save", personalAllocations.save],
	["sharing:create", sharing.create],
	["sharing:status", sharing.status],
	["sharing:leave", sharing.leave],
]);
const users = new WeakMap<object, string>();
// Only identity is stubbed. Every request still runs the real access checks.
Object.defineProperty(authComponent, "getAuthUser", {
	value: async (ctx: object) => {
		const actor = users.get(ctx);
		if (!actor) throw new Error("Missing fixture session.");
		return { _id: actor, email: `${actor}@example.test`, name: actor };
	},
});

class Scenario {
	db = new Memory();
	private queue: Promise<unknown> = Promise.resolve();

	// Serialize handlers and roll back failed writes, as Convex transactions do.
	invoke(actor: string, name: string, args: unknown) {
		const result = this.queue.then(async () => {
			const handler = handlers.get(name) as Handler | undefined;
			if (!handler) throw new Error(`Unsupported fixture operation: ${name}`);
			const ctx = {
				db: this.db,
				scheduler: {
					runAfter: (
						_delay: number,
						reference: Parameters<typeof getFunctionName>[0],
					) => {
						// The test seeds the result explicitly; never call external services.
						if (getFunctionName(reference) === "investments:fetchReturn")
							return;
						throw new Error("External jobs are disabled in browser tests.");
					},
				},
			};
			users.set(ctx, actor);
			const backup = structuredClone(this.db.rows);
			try {
				return structuredClone(await handler._handler(ctx, args));
			} catch (error) {
				this.db.rows = backup;
				throw error;
			}
		});
		this.queue = result.catch(() => {});
		return result;
	}
}

const scenarios = new Map<string, Scenario>();
export async function createScenario(overspending = false) {
	const scenario = new Scenario();
	for (const name of ["Alice", "Bob"])
		await scenario.invoke(name.toLowerCase(), "budgets:setup", {
			name,
			timeZone: "UTC",
		});
	const sharedId = await scenario.invoke("alice", "sharing:create", {});
	// Seed an accepted membership directly; no invitation or email is created.
	await scenario.db.insert("memberships", {
		spaceId: sharedId,
		userId: "bob",
		active: true,
		joinedAt: Date.now(),
	});
	const accountId = await scenario.db.insert("accounts", {
		spaceId: sharedId,
		userId: "alice",
		name: "Checking",
		type: "checking",
		mask: "1234",
		active: true,
		revision: 0,
	});
	if (overspending) {
		const categories = [...scenario.db.rows.values()].filter(
			(row) => row._id.startsWith("categories:") && row.spaceId === sharedId,
		);

		await scenario.invoke("alice", "budgets:savePlan", {
			spaceId: sharedId,
			month: "2099-05",
			expectedIncome: categories.length * 10000,
			savingsTarget: 0,
			limits: categories.map((category) => ({
				categoryId: category._id,
				amount: 10000,
			})),
			revision: 0,
		});
		for (const [name, amount, pending] of [
			["Groceries", 12500, false],
			["Housing", 10000, false],
			["Housing", 5000, true],
		] as const) {
			const category = categories.find((row) => row.name === name);
			if (!category) throw new Error(`Missing fixture category: ${name}`);
			await scenario.db.insert("transactions", {
				spaceId: sharedId,
				accountId,
				description: `${name} purchase`,
				amount,
				date: "2099-05-10",
				kind: "purchase",
				pending,
				source: "manual",
				note: "",
				splits: [{ categoryId: category._id, amount }],
				revision: 0,
			});
		}
	}
	const id = randomUUID();
	scenarios.set(id, scenario);
	return id;
}

export function deleteScenario(id: string) {
	scenarios.delete(id);
}

export async function createClassificationScenario() {
	const id = await createScenario();
	const scenario = scenarios.get(id);
	if (!scenario) throw new Error("Missing classification scenario.");
	const space = [...scenario.db.rows.values()].find((x) => x.type === "shared");
	const category = [...scenario.db.rows.values()].find(
		(x) => x.spaceId === space?._id && x.name === "Groceries",
	);
	if (!space || !category) throw new Error("Missing classification budget.");
	const accountId = await scenario.db.insert("accounts", {
		spaceId: space._id,
		userId: "alice",
		name: "Checking",
		type: "checking",
		mask: "1234",
		active: true,
		revision: 0,
	});
	for (const status of ["pending", "review"])
		await scenario.db.insert("transactions", {
			spaceId: space._id,
			accountId,
			description:
				status === "review" ? "Market purchase" : "Awaiting classification",
			amount: 1200,
			date: "2099-05-10",
			pending: false,
			source: "plaid",
			kind: "purchase",
			note: "",
			removed: false,
			edited: false,
			revision: 0,
			classificationStatus: status,
			splits:
				status === "review" ? [{ categoryId: category._id, amount: 1200 }] : [],
		});
	return id;
}

export async function invokeSession(
	session: string,
	name: string,
	args: unknown,
) {
	const [id, actor] = session.split(":");
	const scenario = scenarios.get(id);
	if (!scenario || !["alice", "bob"].includes(actor))
		throw new Error("Invalid fixture session.");
	return scenario.invoke(actor, name, args);
}
