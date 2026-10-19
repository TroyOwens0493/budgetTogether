import { randomUUID } from "node:crypto";
import { authComponent } from "../../convex/auth";
import * as budgets from "../../convex/budgets";
import * as personalAllocations from "../../convex/personalAllocations";
import { create } from "../../convex/sharing";
import { Memory } from "./memory";

type Handler = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handlers = new Map<string, unknown>([
	["budgets:home", budgets.home],
	["budgets:setup", budgets.setup],
	["budgets:dashboard", budgets.dashboard],
	["budgets:ensureMonth", budgets.ensureMonth],
	["budgets:savePlan", budgets.savePlan],
	["budgets:repeatPlan", budgets.repeatPlan],
	["budgets:review", budgets.review],
	["budgets:alerts", budgets.alerts],
	["budgets:reports", budgets.reports],
	["budgets:recurring", budgets.recurring],
	["personalAllocations:list", personalAllocations.list],
	["personalAllocations:save", personalAllocations.save],
	["sharing:create", create],
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
					runAfter: () => {
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
export async function createScenario() {
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
	const id = randomUUID();
	scenarios.set(id, scenario);
	return id;
}

export function deleteScenario(id: string) {
	scenarios.delete(id);
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
