import assert from "node:assert/strict";
import test from "node:test";
import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
	RegisteredMutation,
	RegisteredQuery,
} from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import * as accounts from "../convex/accounts.ts";
import { authComponent } from "../convex/auth.ts";
import * as bank from "../convex/bank.ts";
import * as budgets from "../convex/budgets.ts";
import * as contributions from "../convex/contributions.ts";
import * as personalAllocations from "../convex/personalAllocations.ts";
import * as sharing from "../convex/sharing.ts";

type Reference<T> =
	T extends RegisteredQuery<infer V, infer A, infer R>
		? FunctionReference<"query", V, A, Awaited<R>>
		: T extends RegisteredMutation<infer V, infer A, infer R>
			? FunctionReference<"mutation", V, A, Awaited<R>>
			: never;
type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Predicate = (row: Row) => boolean;
class Memory {
	rows = new Map<string, Row>();
	sequence = 0;
	current = "alice";
	async insert(table: string, value: Record<string, unknown>) {
		const id = `${table}:${++this.sequence}`;
		this.rows.set(id, {
			...value,
			_id: id,
			_creationTime: Date.now() - 100000 + this.sequence,
		});
		return id;
	}
	async get(id: string) {
		return this.rows.get(id) ?? null;
	}
	async patch(id: string, value: Record<string, unknown>) {
		const row = this.rows.get(id);
		if (!row) throw new Error("Missing row");
		this.rows.set(id, { ...row, ...value });
	}
	async delete(id: string) {
		this.rows.delete(id);
	}
	query(table: string) {
		const predicates: Predicate[] = [];
		let descending = false;
		const all = () =>
			[...this.rows.values()]
				.filter(
					(x) => x._id.startsWith(`${table}:`) && predicates.every((p) => p(x)),
				)
				.sort((a, b) => {
					const key =
						table === "transactions"
							? "date"
							: table === "plans"
								? "month"
								: "_creationTime";
					return (
						String(a[key]).localeCompare(String(b[key])) * (descending ? -1 : 1)
					);
				});
		const range = {
			eq: (field: string, value: unknown) => {
				predicates.push((row) => row[field] === value);
				return range;
			},
			gte: (field: string, value: string) => {
				predicates.push((row) => String(row[field]) >= value);
				return range;
			},
			lt: (field: string, value: string) => {
				predicates.push((row) => String(row[field]) < value);
				return range;
			},
		};
		const field = (name: string) => (row: Row) => row[name];
		const value = (item: unknown, row: Row) =>
			typeof item === "function" ? (item as (row: Row) => unknown)(row) : item;
		const query = {
			withIndex: (_index: string, fn: (q: typeof range) => unknown) => {
				fn(range);
				return query;
			},
			filter: (
				fn: (q: {
					field: typeof field;
					eq: (a: unknown, b: unknown) => Predicate;
					lte: (a: unknown, b: unknown) => Predicate;
				}) => Predicate,
			) => {
				predicates.push(
					fn({
						field,
						eq: (a, b) => (row) => value(a, row) === value(b, row),
						lte: (a, b) => (row) =>
							Number(value(a, row)) <= Number(value(b, row)),
					}),
				);
				return query;
			},
			order: (direction: string) => {
				descending = direction === "desc";
				return query;
			},
			collect: async () => all(),
			first: async () => all()[0] ?? null,
			unique: async () => {
				const rows = all();
				if (rows.length > 1) throw new Error("Not unique");
				return rows[0] ?? null;
			},
		};
		return query;
	}
}
let actor = "alice";
Object.defineProperty(authComponent, "getAuthUser", {
	value: async () => ({
		_id: actor,
		email: `${actor}@example.com`,
		name: actor,
	}),
});
async function invoke<T>(
	fn: T,
	db: Memory,
	args: FunctionArgs<Reference<T>>,
): Promise<FunctionReturnType<Reference<T>>> {
	actor = db.current;
	const backup = structuredClone(db.rows);
	try {
		return await (
			fn as unknown as {
				_handler: (
					ctx: unknown,
					args: unknown,
				) => Promise<FunctionReturnType<Reference<T>>>;
			}
		)._handler({ db, scheduler: { runAfter: async () => null } }, args);
	} catch (error) {
		db.rows = backup;
		throw error;
	}
}
const id = <
	T extends
		| "spaces"
		| "accounts"
		| "categories"
		| "transactions"
		| "connections"
		| "plans"
		| "contributions",
>(
	value: string,
) => value as Id<T>;
async function connectedAccount(
	db: Memory,
	spaceId: Id<"spaces">,
	name = "Checking",
) {
	const connectionId = await db.insert("connections", {
		userId: db.current,
		itemId: `fixture-item-${db.sequence}`,
		accessToken: "encrypted",
		institution: "Fixture Bank",
		institutionId: "fixture-bank",
		status: "connected",
	});
	return id<"accounts">(
		await db.insert("accounts", {
			userId: db.current,
			spaceId,
			connectionId,
			externalId: `fixture-account-${db.sequence}`,
			name,
			type: "checking",
			mask: "0000",
			active: true,
			revision: 0,
		}),
	);
}
async function fixture() {
	const db = new Memory();
	await invoke(budgets.setup, db, { name: "Alice", timeZone: "America/Boise" });
	const privateId = id<"spaces">(
		[...db.rows.values()].find((x) => x.type === "private")!._id,
	);
	const categoryId = id<"categories">(
		[...db.rows.values()].find((x) => x.name === "Groceries")!._id,
	);
	const accountId = await connectedAccount(db, privateId);
	return { db, privateId, categoryId, accountId };
}
async function entry(
	db: Memory,
	spaceId: Id<"spaces">,
	accountId: Id<"accounts">,
	amount: number,
	kind: "income" | "purchase" | "transfer",
	categoryId?: Id<"categories">,
	date = "2026-09-10",
) {
	return db.insert("transactions", {
		spaceId,
		accountId,
		amount,
		kind,
		date,
		source: "manual",
		description: "Entry",
		pending: false,
		splits: categoryId ? [{ categoryId, amount }] : [],
		removed: false,
		note: "",
		revision: 0,
		edited: false,
	}) as Promise<Id<"transactions">>;
}
test("private budget reads and edits are denied to another user", async () => {
	const { db, privateId } = await fixture();
	db.current = "bob";
	const requests = [
		() =>
			invoke(budgets.dashboard, db, { spaceId: privateId, month: "2026-09" }),
		() => invoke(budgets.categories, db, { spaceId: privateId }),
		() =>
			invoke(budgets.transactions, db, {
				spaceId: privateId,
				month: "2026-09",
			}),
		() =>
			invoke(budgets.reports, db, {
				spaceId: privateId,
				from: "2026-09",
				to: "2026-09",
			}),
		() => invoke(budgets.recurring, db, { spaceId: privateId }),
		() => invoke(budgets.alerts, db, { spaceId: privateId, month: "2026-09" }),
		() =>
			invoke(budgets.ensureMonth, db, { spaceId: privateId, month: "2026-09" }),
		() =>
			invoke(budgets.setRecurring, db, {
				spaceId: privateId,
				merchant: "entry",
				status: "confirmed",
			}),
		() =>
			invoke(budgets.readAlert, db, {
				spaceId: privateId,
				key: `${privateId}:2026-09:carry`,
			}),
	];
	for (const request of requests) await assert.rejects(request, /access/);
});

test("historical reports match dashboard totals for refunds, pending entries, and transfers", async () => {
	const { db, privateId, categoryId, accountId } = await fixture();
	await entry(db, privateId, accountId, -10000, "income");
	await entry(db, privateId, accountId, 3000, "purchase", categoryId);
	await entry(db, privateId, accountId, -500, "purchase", categoryId);
	await entry(db, privateId, accountId, 2000, "transfer");
	const pending = await entry(
		db,
		privateId,
		accountId,
		700,
		"purchase",
		categoryId,
	);
	await db.patch(pending, { pending: true });
	const report = await invoke(budgets.reports, db, {
		spaceId: privateId,
		from: "2026-09",
		to: "2026-10",
	});
	assert.deepEqual(report, [
		{
			month: "2026-09",
			income: 10000,
			spending: 2500,
			savings: 7500,
			categories: { [categoryId]: 2500 },
		},
		{ month: "2026-10", income: 0, spending: 0, savings: 0, categories: {} },
	]);
	const dashboard = await invoke(budgets.dashboard, db, {
		spaceId: privateId,
		month: "2026-09",
	});
	assert.equal(dashboard.income, report[0].income);
	assert.equal(dashboard.spending, report[0].spending);
	assert.equal(dashboard.savings, report[0].savings);
	assert.equal(dashboard.pending, 700);
});

test("recurring suggestion decisions persist without creating duplicate states", async () => {
	const { db, privateId, categoryId, accountId } = await fixture();
	for (const date of ["2026-07-10", "2026-08-10", "2026-09-10"])
		await entry(db, privateId, accountId, 1500, "purchase", categoryId, date);
	const args = { spaceId: privateId };
	const suggested = await invoke(budgets.recurring, db, args);
	assert.deepEqual(suggested, [
		{
			merchant: "entry",
			amount: 1500,
			date: "2026-10-10",
			status: "suggested",
		},
	]);
	await invoke(budgets.setRecurring, db, {
		...args,
		merchant: "entry",
		status: "confirmed",
	});
	assert.equal(
		(await invoke(budgets.recurring, db, args))[0].status,
		"confirmed",
	);
	await invoke(budgets.setRecurring, db, {
		...args,
		merchant: "entry",
		status: "dismissed",
	});
	assert.equal(
		(await invoke(budgets.recurring, db, args))[0].status,
		"dismissed",
	);
	assert.equal(
		[...db.rows.values()].filter((row) => row._id.startsWith("recurring:"))
			.length,
		1,
	);
});

test("shared alerts use posted spending and keep read state separate for each partner", async () => {
	const { db } = await fixture();
	const spaceId = await invoke(sharing.create, db, {});
	await db.insert("memberships", {
		spaceId,
		userId: "bob",
		active: true,
		joinedAt: Date.now(),
	});
	const accountId = await connectedAccount(db, spaceId);
	const categories = await invoke(budgets.categories, db, { spaceId });
	const categoryId = categories[0]._id;
	await invoke(budgets.savePlan, db, {
		spaceId,
		month: "2026-09",
		expectedIncome: 1000,
		savingsTarget: 0,
		limits: [{ categoryId, amount: 1000 }],
		revision: 0,
	});
	await entry(db, spaceId, accountId, 800, "purchase", categoryId);
	const pending = await entry(
		db,
		spaceId,
		accountId,
		500,
		"purchase",
		categoryId,
	);
	await db.patch(pending, { pending: true });
	const args = { spaceId, month: "2026-09" };
	const alerts = await invoke(budgets.alerts, db, args);
	assert.deepEqual(alerts, [
		{
			key: `${spaceId}:2026-09:${categoryId}:near`,
			text: `${categories[0].name}: 80% or more used`,
			read: false,
		},
	]);
	for (let i = 0; i < 2; i++)
		await invoke(budgets.readAlert, db, { spaceId, key: alerts[0].key });
	assert.equal((await invoke(budgets.alerts, db, args))[0].read, true);
	assert.equal(
		[...db.rows.values()].filter((row) => row._id.startsWith("alertReads:"))
			.length,
		1,
	);
	db.current = "bob";
	assert.equal((await invoke(budgets.alerts, db, args))[0].read, false);
});

test("reconciliation retains manual classifications and counts only the imported entry", async () => {
	const { db, privateId, categoryId, accountId } = await fixture();
	const manualId = await entry(
		db,
		privateId,
		accountId,
		1000,
		"purchase",
		categoryId,
	);
	await db.patch(manualId, { note: "Weekly groceries" });
	const importId = await entry(db, privateId, accountId, 1000, "transfer");
	await db.patch(importId, { source: "plaid" });
	await invoke(budgets.reconcile, db, { manualId, importId, revision: 0 });
	const page = await invoke(budgets.transactions, db, {
		spaceId: privateId,
		month: "2026-09",
	});
	assert.equal(page.total, 1);
	assert.equal(page.rows[0]._id, importId);
	assert.equal(page.rows[0].note, "Weekly groceries");
	assert.deepEqual(page.rows[0].splits, [{ categoryId, amount: 1000 }]);
	assert.equal((await db.get(manualId))?.reconciledWith, importId);
	const dashboard = await invoke(budgets.dashboard, db, {
		spaceId: privateId,
		month: "2026-09",
	});
	assert.equal(dashboard.spending, 1000);
});
test("saving budgets rejects imbalance and stale edits", async () => {
	const { db, privateId, categoryId } = await fixture();
	const plan = {
		spaceId: privateId,
		month: "2026-09",
		expectedIncome: 10000,
		savingsTarget: 2000,
		limits: [{ categoryId, amount: 8000 }],
		revision: 0,
	};
	await assert.rejects(
		() => invoke(budgets.savePlan, db, { ...plan, savingsTarget: 2001 }),
		/balance/,
	);
	assert.equal(
		(
			await invoke(budgets.dashboard, db, {
				spaceId: privateId,
				month: plan.month,
			})
		).plan,
		null,
	);
	await invoke(budgets.savePlan, db, plan);
	assert.equal(
		(
			await invoke(budgets.dashboard, db, {
				spaceId: privateId,
				month: plan.month,
			})
		).plan?.saved,
		true,
	);
	await assert.rejects(
		() =>
			invoke(budgets.savePlan, db, {
				...plan,
				revision: 1,
				savingsTarget: 2001,
			}),
		/balance/,
	);
	await assert.rejects(() => invoke(budgets.savePlan, db, plan), /changed/);
});
test("repeated reviews replace carry-forward and destination allocations", async () => {
	const { db, privateId, categoryId, accountId } = await fixture();
	await entry(db, privateId, accountId, -100000, "income");
	await entry(db, privateId, accountId, 50000, "purchase", categoryId);
	await invoke(budgets.savePlan, db, {
		spaceId: privateId,
		month: "2026-09",
		expectedIncome: 100000,
		savingsTarget: 20000,
		limits: [{ categoryId, amount: 80000 }],
		revision: 0,
	});
	await invoke(budgets.review, db, {
		spaceId: privateId,
		month: "2026-09",
		allocations: [{ categoryId, amount: 10000 }],
		revision: 1,
	});
	await invoke(budgets.savePlan, db, {
		spaceId: privateId,
		month: "2026-10",
		expectedIncome: 100000,
		savingsTarget: 20000,
		limits: [{ categoryId, amount: 90000 }],
		revision: 1,
	});
	await invoke(budgets.review, db, {
		spaceId: privateId,
		month: "2026-09",
		allocations: [{ categoryId, amount: 5000 }],
		revision: 2,
	});
	const next = await invoke(budgets.dashboard, db, {
		spaceId: privateId,
		month: "2026-10",
	});
	assert.equal(next.funds.carry, 5000);
	assert.equal(next.plan?.limits[0].amount, 85000);
	assert.equal(next.plan?.saved, true);
	assert.equal(next.balance, 0);
	const source = await invoke(budgets.dashboard, db, {
		spaceId: privateId,
		month: "2026-09",
	});
	assert.equal(source.savings, 50000);
	assert.equal(source.plan?.savingsTarget, 20000);
	assert.equal(
		[...db.rows.values()].filter((x) => x._id.startsWith("carry:")).length,
		1,
	);
});
test("new months repeat limits but require a save before review", async () => {
	const { db, privateId, categoryId } = await fixture();
	const values = {
		spaceId: privateId,
		expectedIncome: 10000,
		savingsTarget: 2000,
		limits: [{ categoryId, amount: 8000 }],
	};
	await invoke(budgets.savePlan, db, {
		...values,
		month: "2026-09",
		revision: 0,
	});
	await invoke(budgets.ensureMonth, db, {
		spaceId: privateId,
		month: "2026-10",
	});
	const next = await invoke(budgets.dashboard, db, {
		spaceId: privateId,
		month: "2026-10",
	});
	assert.deepEqual(next.plan?.limits, values.limits);
	assert.equal(next.plan?.saved, false);
	await assert.rejects(
		() =>
			invoke(budgets.review, db, {
				spaceId: privateId,
				month: "2026-10",
				allocations: [],
				revision: 1,
			}),
		/Save this month/,
	);
	await invoke(budgets.savePlan, db, {
		...values,
		month: "2026-10",
		revision: 1,
	});
	await invoke(budgets.review, db, {
		spaceId: privateId,
		month: "2026-10",
		allocations: [],
		revision: 2,
	});
});
test("existing budget records remain readable and migrate on save", async () => {
	for (const status of ["draft", "active"] as const) {
		const { db, privateId, categoryId } = await fixture();
		const values = {
			spaceId: privateId,
			month: "2026-09",
			expectedIncome: 10000,
			savingsTarget: 2000,
			limits: [{ categoryId, amount: 8000 }],
			revision: 1,
		};
		const planId = await db.insert("plans", {
			...values,
			status,
			reviewed: false,
		});
		const before = await invoke(budgets.dashboard, db, {
			spaceId: privateId,
			month: values.month,
		});
		assert.equal(before.plan?.saved, status === "active");
		await invoke(budgets.savePlan, db, values);
		assert.equal((await db.get(planId))?.saved, true);
		assert.equal((await db.get(planId))?.status, undefined);
	}
});
test("planned contributions can change after saving and both budgets must be saved again", async () => {
	const { db, privateId, categoryId } = await fixture();
	const sharedId = await invoke(sharing.create, db, {});
	const personal = {
		spaceId: privateId,
		month: "2026-09",
		expectedIncome: 10000,
		savingsTarget: 2000,
		limits: [{ categoryId, amount: 8000 }],
		revision: 0,
	};
	const shared = {
		spaceId: sharedId,
		month: "2026-09",
		expectedIncome: 0,
		savingsTarget: 0,
		limits: [],
		revision: 0,
	};
	await invoke(budgets.savePlan, db, personal);
	await invoke(budgets.savePlan, db, shared);
	await invoke(contributions.savePlanned, db, {
		privateId,
		sharedId,
		month: "2026-09",
		planned: 1000,
		revision: 0,
	});
	for (const spaceId of [privateId, sharedId]) {
		const changed = await invoke(budgets.dashboard, db, {
			spaceId,
			month: "2026-09",
		});
		assert.equal(changed.plan?.saved, false);
		assert.equal(changed.plan?.revision, 2);
		await assert.rejects(
			() =>
				invoke(budgets.review, db, {
					spaceId,
					month: "2026-09",
					allocations: [],
					revision: 2,
				}),
			/Save this month/,
		);
	}
	await assert.rejects(
		() => invoke(budgets.savePlan, db, { ...personal, revision: 1 }),
		/changed/,
	);
	await invoke(budgets.savePlan, db, {
		...personal,
		limits: [{ categoryId, amount: 7000 }],
		revision: 2,
	});
	await invoke(budgets.savePlan, db, {
		...shared,
		savingsTarget: 1000,
		revision: 2,
	});
	await invoke(contributions.savePlanned, db, {
		privateId,
		sharedId,
		month: "2026-09",
		planned: 1000,
		revision: 1,
	});
	for (const spaceId of [privateId, sharedId]) {
		const saved = await invoke(budgets.dashboard, db, {
			spaceId,
			month: "2026-09",
		});
		assert.equal(saved.plan?.saved, true);
		assert.equal(saved.plan?.revision, 3);
		assert.equal(saved.balance, 0);
	}
});
test("sharing an account preserves private history and leaving limits future reads", async () => {
	const { db, privateId, accountId } = await fixture();
	const sharedId = await invoke(sharing.create, db, {});
	const before = await entry(db, privateId, accountId, 100, "transfer");
	await invoke(accounts.move, db, {
		id: accountId,
		destinationId: sharedId,
		revision: 0,
	});
	assert.equal((await db.get(before))!.spaceId, privateId);
	const previous = await entry(db, sharedId, accountId, 200, "transfer");
	await invoke(sharing.leave, db, { spaceId: sharedId });
	const future = await entry(db, sharedId, accountId, 300, "transfer");
	await db.patch(future, { _creationTime: Date.now() + 1000 });
	const page = await invoke(budgets.transactions, db, {
		spaceId: sharedId,
		month: "2026-09",
	});
	assert.deepEqual(
		page.rows.map((x) => x._id),
		[previous],
	);
	assert.equal((await db.get(accountId))!.spaceId, privateId);
	await assert.rejects(
		() =>
			invoke(budgets.saveCategory, db, {
				spaceId: sharedId,
				name: "Forbidden",
				color: "#123456",
			}),
		/access/,
	);
});
test("contribution matches cancel across budgets and stop counting when a bank correction invalidates them", async () => {
	const { db, privateId, accountId } = await fixture();
	const sharedId = await invoke(sharing.create, db, {});
	const sharedAccount = await connectedAccount(db, sharedId, "Shared checking");
	const outId = await entry(db, privateId, accountId, 30000, "transfer");
	const inId = await entry(db, sharedId, sharedAccount, -30000, "income");
	await invoke(contributions.confirm, db, { privateId, sharedId, outId, inId });
	const personal = await invoke(budgets.dashboard, db, {
		spaceId: privateId,
		month: "2026-09",
	});
	const shared = await invoke(budgets.dashboard, db, {
		spaceId: sharedId,
		month: "2026-09",
	});
	assert.equal(personal.savings, -30000);
	assert.equal(shared.savings, 30000);
	assert.equal(shared.income, 0);
	await assert.rejects(
		() =>
			invoke(contributions.confirm, db, { privateId, sharedId, outId, inId }),
		/already matched/,
	);
	await db.patch(inId, { removed: true });
	const corrected = await invoke(budgets.dashboard, db, {
		spaceId: sharedId,
		month: "2026-09",
	});
	assert.equal(corrected.incoming, 0);
});
test("bank imports are idempotent and posted entries replace pending entries", async () => {
	const { db, privateId, accountId } = await fixture();
	const connectionId = id<"connections">(
		await db.insert("connections", {
			userId: "alice",
			itemId: "item",
			accessToken: "encrypted",
			institution: "Bank",
			institutionId: "bank",
			status: "connected",
		}),
	);
	await db.patch(accountId, { connectionId, externalId: "a" });
	const pending = {
		transaction_id: "pending",
		account_id: "a",
		name: "Groceries",
		amount: 12.34,
		date: "2026-09-10",
		pending: true,
	};
	await invoke(bank.apply, db, {
		id: connectionId,
		cursor: "1",
		changed: [pending],
		removed: [],
	});
	const posted = {
		...pending,
		transaction_id: "posted",
		pending_transaction_id: "pending",
		pending: false,
	};
	await invoke(bank.apply, db, {
		id: connectionId,
		expectedCursor: "1",
		cursor: "2",
		changed: [posted],
		removed: ["pending"],
	});
	await invoke(bank.apply, db, {
		id: connectionId,
		expectedCursor: "2",
		cursor: "3",
		changed: [posted],
		removed: [],
	});
	const result = await invoke(budgets.dashboard, db, {
		spaceId: privateId,
		month: "2026-09",
	});
	assert.equal(result.entries.length, 1);
	assert.equal(result.spending, 1234);
	assert.equal(result.pending, 0);
});

test("category deletion reassigns transactions and preserves the sum of plan limits", async () => {
	const { db, privateId, categoryId, accountId } = await fixture();
	const replacementId = await invoke(budgets.saveCategory, db, {
		spaceId: privateId,
		name: "Replacement",
		color: "#123456",
	});
	await entry(db, privateId, accountId, 1000, "purchase", categoryId);
	await invoke(budgets.savePlan, db, {
		spaceId: privateId,
		month: "2026-09",
		expectedIncome: 10000,
		savingsTarget: 0,
		limits: [
			{ categoryId, amount: 6000 },
			{ categoryId: replacementId, amount: 4000 },
		],
		revision: 0,
	});
	await invoke(budgets.deleteCategory, db, {
		id: categoryId,
		replacementId,
		revision: 0,
	});
	const result = await invoke(budgets.dashboard, db, {
		spaceId: privateId,
		month: "2026-09",
	});
	assert.equal(result.plan!.limits.length, 1);
	assert.equal(result.plan!.limits[0].amount, 10000);
	assert.equal(result.entries[0].splits[0].categoryId, replacementId);
	assert.equal(result.spending, 1000);
});
test("manual entries are saved as posted, check split totals, and refuse deletion of imports", async () => {
	const { db, privateId, categoryId, accountId } = await fixture();
	const value = {
		spaceId: privateId,
		accountId,
		description: "Groceries",
		amount: 1000,
		date: "2026-09-10",
		kind: "purchase" as const,
		pending: false,
		note: "",
		splits: [{ categoryId, amount: 1000 }],
		revision: 0,
	};
	await invoke(budgets.saveTransaction, db, { ...value, pending: true });
	const transaction = id<"transactions">(
		[...db.rows.values()].find((x) => x._id.startsWith("transactions:"))!._id,
	);
	assert.equal((await db.get(transaction))!.pending, false);
	await assert.rejects(
		() =>
			invoke(budgets.saveTransaction, db, {
				...value,
				id: transaction,
				revision: 1,
				splits: [{ categoryId, amount: 999 }],
			}),
		/total/,
	);
	await db.patch(transaction, { pending: true });
	await invoke(budgets.saveTransaction, db, {
		...value,
		id: transaction,
		revision: 1,
		note: "Changed",
		pending: true,
	});
	assert.equal((await db.get(transaction))!.note, "Changed");
	assert.equal((await db.get(transaction))!.pending, false);
	await invoke(budgets.deleteTransaction, db, { id: transaction, revision: 2 });
	assert.equal(await db.get(transaction), null);
	const imported = await entry(
		db,
		privateId,
		accountId,
		1000,
		"purchase",
		categoryId,
	);
	await db.patch(imported, { source: "plaid" });
	await assert.rejects(
		() => invoke(budgets.deleteTransaction, db, { id: imported, revision: 0 }),
		/Only manual/,
	);
	await db.patch(imported, { pending: true });
	await invoke(budgets.saveTransaction, db, {
		...value,
		id: imported,
		pending: true,
	});
	assert.equal((await db.get(imported))!.pending, true);
	await assert.rejects(
		() =>
			invoke(budgets.saveTransaction, db, {
				...value,
				id: imported,
				revision: 1,
			}),
		/pending status are set by the bank/,
	);
});

test("possible duplicates pause imports and require an explicit same or different decision", async () => {
	const { db, privateId, accountId } = await fixture();
	const original = await invoke(bank.store, db, {
		userId: "alice",
		spaceId: privateId,
		itemId: "original",
		accessToken: "encrypted",
		institution: "Bank",
		institutionId: "bank",
		accounts: [
			{
				account_id: "original",
				name: "Checking",
				type: "depository",
				subtype: "checking",
				mask: "1234",
			},
		],
	});
	const args = {
		userId: "alice",
		spaceId: privateId,
		accessToken: "encrypted",
		institution: "Bank",
		institutionId: "bank",
		accounts: [
			{
				account_id: "new",
				name: "Checking",
				type: "depository",
				subtype: "checking",
				mask: "1234",
			},
		],
	};
	const pending = await invoke(bank.store, db, { ...args, itemId: "pending" });
	assert.equal((await db.get(pending))?.status, "review");
	assert.equal(
		[...db.rows.values()].filter((r) => r.connectionId === pending).length,
		0,
	);
	await invoke(bank.apply, db, {
		id: pending,
		cursor: "bad",
		changed: [],
		removed: [],
	});
	await invoke(bank.event, db, {
		itemId: "pending",
		error: "ITEM_LOGIN_REQUIRED",
	});
	await invoke(bank.fail, db, { id: pending, error: "SYNC_FAILED" });
	assert.equal((await db.get(pending))?.status, "review");
	assert.equal((await db.get(pending))?.cursor, undefined);
	await assert.rejects(
		invoke(bank.confirmAccounts, db, { id: pending, decisions: [] }),
		/Identify each/,
	);
	db.current = "bob";
	await assert.rejects(
		invoke(bank.review, db, { id: pending }),
		/Connection not found/,
	);
	await assert.rejects(
		invoke(bank.confirmAccounts, db, {
			id: pending,
			decisions: [{ accountId: "new", sameAccount: false }],
		}),
		/not awaiting review/,
	);
	db.current = "alice";
	await invoke(bank.confirmAccounts, db, {
		id: pending,
		decisions: [{ accountId: "new", sameAccount: true }],
	});
	assert.equal((await db.get(pending))?.status, "discarding");
	assert.equal((await db.get(original))?.status, "syncing");
	assert.ok(await db.get(accountId));
	const different = await invoke(bank.store, db, {
		...args,
		itemId: "different",
	});
	await invoke(bank.confirmAccounts, db, {
		id: different,
		decisions: [{ accountId: "new", sameAccount: false }],
	});
	assert.equal((await db.get(different))?.status, "syncing");
	assert.equal(
		[...db.rows.values()].filter((r) => r.connectionId === different).length,
		1,
	);
});
test("partner duplicate checks do not expose private names and preserve other selected accounts", async () => {
	const { db, privateId } = await fixture();
	const sharedId = await invoke(sharing.create, db, {});
	await db.insert("memberships", {
		spaceId: sharedId,
		userId: "bob",
		active: true,
		joinedAt: Date.now(),
	});
	const partnerConnection = await db.insert("connections", {
		userId: "bob",
		itemId: "partner",
		institution: "Bank",
		institutionId: "bank",
		status: "connected",
		accessToken: "encrypted",
	});
	await db.insert("accounts", {
		userId: "bob",
		spaceId: "private-bob",
		connectionId: partnerConnection,
		name: "Secret account name",
		type: "checking",
		mask: "4321",
		active: true,
		revision: 0,
	});
	const pending = await invoke(bank.store, db, {
		userId: "alice",
		spaceId: privateId,
		itemId: "mix",
		accessToken: "encrypted",
		institution: "Bank",
		institutionId: "bank",
		accounts: [
			{
				account_id: "match",
				name: "New checking",
				type: "depository",
				subtype: "checking",
				mask: "4321",
			},
			{
				account_id: "other",
				name: "New savings",
				type: "depository",
				subtype: "savings",
				mask: "9876",
			},
		],
	});
	const review = await invoke(bank.review, db, { id: pending });
	assert.deepEqual(
		review?.map((a) => a.possibleDuplicate),
		[true, false],
	);
	assert.ok(!JSON.stringify(review).includes("Secret account name"));
	await invoke(bank.confirmAccounts, db, {
		id: pending,
		decisions: [{ accountId: "match", sameAccount: true }],
	});
	const imported = [...db.rows.values()].filter(
		(r) => r.connectionId === pending,
	);
	assert.equal(imported.length, 1);
	assert.equal(imported[0].externalId, "other");
});

async function fundedHousehold() {
	const fixtureData = await fixture();
	const { db } = fixtureData;
	const sharedId = await invoke(sharing.create, db, {});
	const membership = [...db.rows.values()].find(
		(x) => x.spaceId === sharedId && x.userId === "alice",
	)!;
	await db.patch(membership._id, {
		joinedAt: Date.parse("2026-09-01T12:00:00Z"),
	});
	db.current = "bob";
	await invoke(budgets.setup, db, { name: "Bob", timeZone: "America/Boise" });
	const bobId = id<"spaces">(
		[...db.rows.values()].find(
			(x) => x.type === "private" && x.ownerId === "bob",
		)!._id,
	);
	await db.insert("memberships", {
		spaceId: sharedId,
		userId: "bob",
		active: true,
		joinedAt: Date.parse("2026-09-01T12:00:00Z"),
	});
	db.current = "alice";
	return { ...fixtureData, sharedId, bobId };
}

test("shared allocations fund both personal budgets immediately without bank transfers", async () => {
	const { db, privateId, sharedId, bobId, categoryId, accountId } =
		await fundedHousehold();
	await entry(db, privateId, accountId, -100000, "income");
	await entry(db, privateId, accountId, 10000, "purchase", categoryId);
	await invoke(personalAllocations.save, db, {
		sharedId,
		privateId,
		month: "2026-09",
		amount: 20000,
		revision: 0,
	});
	await invoke(personalAllocations.save, db, {
		sharedId,
		privateId: bobId,
		month: "2026-09",
		amount: 30000,
		revision: 0,
	});
	const shared = await invoke(budgets.dashboard, db, {
		spaceId: sharedId,
		month: "2026-09",
	});
	const personal = await invoke(budgets.dashboard, db, {
		spaceId: privateId,
		month: "2026-09",
	});
	db.current = "bob";
	const bob = await invoke(budgets.dashboard, db, {
		spaceId: bobId,
		month: "2026-09",
	});
	assert.equal(shared.income, 100000);
	assert.equal(shared.outgoing, 50000);
	assert.equal(shared.savings, 50000);
	assert.equal(personal.income, 0);
	assert.equal(personal.incoming, 20000);
	assert.equal(personal.savings, 10000);
	assert.equal(bob.incoming, 30000);
	assert.equal(shared.savings + personal.savings + bob.savings, 90000);
	assert.equal(shared.entries.length, 0);
	assert.equal(shared.spending, 0);
	assert.equal(
		[...db.rows.values()].filter((x) => x._id.startsWith("transactions:"))
			.length,
		2,
	);
});

test("both partners can edit allocations without private access; outsiders and stale edits are rejected", async () => {
	const { db, privateId, sharedId, bobId } = await fundedHousehold();
	db.current = "bob";
	await invoke(personalAllocations.save, db, {
		sharedId,
		privateId,
		month: "2026-09",
		amount: 12300,
		revision: 0,
	});
	const rows = await invoke(personalAllocations.list, db, {
		sharedId,
		month: "2026-09",
	});
	assert.deepEqual(
		rows.find((x) => x.privateId === privateId),
		{ privateId, name: "Alice", active: true, amount: 12300, revision: 1 },
	);
	assert.equal(rows.find((x) => x.privateId === bobId)!.amount, 0);
	await assert.rejects(
		() =>
			invoke(budgets.dashboard, db, { spaceId: privateId, month: "2026-09" }),
		/access/,
	);
	await assert.rejects(
		() =>
			invoke(personalAllocations.save, db, {
				sharedId,
				privateId,
				month: "2026-09",
				amount: 100,
				revision: 0,
			}),
		/changed/,
	);
	await assert.rejects(
		() =>
			invoke(personalAllocations.save, db, {
				sharedId,
				privateId,
				month: "2026-09",
				amount: -1,
				revision: 1,
			}),
		/negative/,
	);
	db.current = "eve";
	await assert.rejects(
		() => invoke(personalAllocations.list, db, { sharedId, month: "2026-09" }),
		/access/,
	);
	await assert.rejects(
		() =>
			invoke(personalAllocations.save, db, {
				sharedId,
				privateId,
				month: "2026-09",
				amount: 100,
				revision: 1,
			}),
		/access/,
	);
	await invoke(budgets.setup, db, { name: "Eve", timeZone: "UTC" });
	const eveId = id<"spaces">(
		[...db.rows.values()].find(
			(x) => x.type === "private" && x.ownerId === "eve",
		)!._id,
	);
	db.current = "alice";
	await assert.rejects(
		() =>
			invoke(personalAllocations.save, db, {
				sharedId,
				privateId: eveId,
				month: "2026-09",
				amount: 100,
				revision: 0,
			}),
		/active member/,
	);
});

test("shared planned income and personal allocations balance; allocation changes require both plans to be saved again", async () => {
	const { db, privateId, sharedId, categoryId } = await fundedHousehold();
	await invoke(personalAllocations.save, db, {
		sharedId,
		privateId,
		month: "2026-09",
		amount: 20000,
		revision: 0,
	});
	const personalPlan = {
		spaceId: privateId,
		month: "2026-09",
		expectedIncome: 0,
		savingsTarget: 0,
		limits: [{ categoryId, amount: 20000 }],
		revision: 0,
	};
	const sharedPlan = {
		spaceId: sharedId,
		month: "2026-09",
		expectedIncome: 100000,
		savingsTarget: 80000,
		limits: [],
		revision: 0,
	};
	await invoke(budgets.savePlan, db, personalPlan);
	await invoke(budgets.savePlan, db, sharedPlan);
	await assert.rejects(
		() =>
			invoke(budgets.savePlan, db, {
				...personalPlan,
				expectedIncome: 1000,
				revision: 1,
			}),
		/shared budget/,
	);
	await assert.rejects(
		() =>
			invoke(contributions.savePlanned, db, {
				privateId,
				sharedId,
				month: "2026-09",
				planned: 100,
				revision: 0,
			}),
		/shared monthly budget/,
	);
	await invoke(personalAllocations.save, db, {
		sharedId,
		privateId,
		month: "2026-09",
		amount: 25000,
		revision: 1,
	});
	for (const spaceId of [privateId, sharedId]) {
		const data = await invoke(budgets.dashboard, db, {
			spaceId,
			month: "2026-09",
		});
		assert.equal(data.plan!.saved, false);
		assert.equal(data.plan!.revision, 2);
	}
	await invoke(budgets.savePlan, db, {
		...personalPlan,
		limits: [{ categoryId, amount: 25000 }],
		revision: 2,
	});
	await invoke(budgets.savePlan, db, {
		...sharedPlan,
		savingsTarget: 75000,
		revision: 2,
	});
});

test("income routing preserves months before joining and excludes private income imported after departure", async () => {
	const { db, privateId, sharedId, accountId } = await fundedHousehold();
	await entry(
		db,
		privateId,
		accountId,
		-10000,
		"income",
		undefined,
		"2026-08-10",
	);
	assert.equal(
		(
			await invoke(budgets.dashboard, db, {
				spaceId: privateId,
				month: "2026-08",
			})
		).income,
		10000,
	);
	assert.equal(
		(
			await invoke(budgets.dashboard, db, {
				spaceId: sharedId,
				month: "2026-08",
			})
		).income,
		0,
	);
	await entry(db, privateId, accountId, -20000, "income");
	const membership = [...db.rows.values()].find(
		(x) => x.spaceId === sharedId && x.userId === "alice",
	)!;
	const leftAt = Date.now();
	await db.patch(membership._id, { active: false, leftAt });
	const later = await entry(db, privateId, accountId, -30000, "income");
	await db.patch(later, { _creationTime: leftAt + 1 });
	db.current = "bob";
	assert.equal(
		(
			await invoke(budgets.dashboard, db, {
				spaceId: sharedId,
				month: "2026-09",
			})
		).income,
		20000,
	);
	db.current = "alice";
	assert.equal(
		(
			await invoke(budgets.dashboard, db, {
				spaceId: privateId,
				month: "2026-09",
			})
		).income,
		30000,
	);
});

test("bank transfers and legacy contributions do not add funding to the new allocation model", async () => {
	const { db, privateId, sharedId, accountId } = await fundedHousehold();
	const sharedAccount = await connectedAccount(db, sharedId, "Shared checking");
	const outId = await entry(db, privateId, accountId, 5000, "transfer");
	const inId = await entry(db, sharedId, sharedAccount, -5000, "transfer");
	await db.insert("contributions", {
		privateId,
		sharedId,
		month: "2026-09",
		planned: 5000,
		pairs: [{ outId, inId, amount: 5000 }],
		revision: 1,
	});
	await invoke(personalAllocations.save, db, {
		sharedId,
		privateId,
		month: "2026-09",
		amount: 10000,
		revision: 0,
	});
	const personal = await invoke(budgets.dashboard, db, {
		spaceId: privateId,
		month: "2026-09",
	});
	const shared = await invoke(budgets.dashboard, db, {
		spaceId: sharedId,
		month: "2026-09",
	});
	assert.equal(personal.funds.incoming, 10000);
	assert.equal(personal.funds.outgoing, 0);
	assert.equal(personal.incoming, 10000);
	assert.equal(personal.outgoing, 0);
	assert.equal(shared.funds.incoming, 0);
	assert.equal(shared.funds.outgoing, 10000);
	assert.equal(shared.income, 0);
	assert.equal(shared.savings + personal.savings, 0);
	await assert.rejects(
		() =>
			invoke(contributions.confirm, db, {
				privateId,
				sharedId,
				outId: id<"transactions">(outId),
				inId: id<"transactions">(inId),
			}),
		/budget allocation/,
	);
});
