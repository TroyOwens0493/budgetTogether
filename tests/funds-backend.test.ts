import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../convex/_generated/dataModel";
import * as bank from "../convex/bank.ts";
import * as budgets from "../convex/budgets.ts";
import * as sharing from "../convex/sharing.ts";
import { fixture, id, invoke, type Memory } from "./helpers/backend.ts";

const month = "2026-09";

test("an overdrawn fund cannot release nonexistent reserves as available leftovers", async () => {
	const { db, privateId, categoryId, accountId } = await fixture();
	const fundId = await invoke(budgets.saveFund, db, {
		...fundArgs(privateId),
		openingBalance: 60000,
		targetMonth: month,
	});
	await saveMonth(db, privateId, month, categoryId, 0);
	await invoke(budgets.saveTransaction, db, {
		spaceId: privateId,
		accountId,
		description: "Larger premium",
		amount: 70000,
		date: "2026-09-10",
		kind: "purchase",
		pending: false,
		note: "",
		splits: [{ categoryId, fundId, amount: 70000 }],
		revision: 0,
	});
	const data = await invoke(budgets.dashboard, db, {
		spaceId: privateId,
		month,
	});
	assert.equal(data.fundPlan.items[0].balance, -10000);
	assert.equal(data.savings, -70000);
	assert.equal(data.unreservedSavings, -10000);
	assert.equal(data.available, 0);
	await assert.rejects(
		() =>
			invoke(budgets.review, db, {
				spaceId: privateId,
				month,
				revision: 1,
				allocations: [{ categoryId, amount: 1 }],
			}),
		/exceeds/,
	);
});

test("partners share fund edits while former members keep only the prior fund settings", async () => {
	const { db } = await fixture();
	const spaceId = await invoke(sharing.create, db, {});
	const membership = await db.insert("memberships", {
		spaceId,
		userId: "bob",
		active: true,
		joinedAt: 1,
	});
	const args = fundArgs(spaceId);
	const fundId = await invoke(budgets.saveFund, db, args);
	db.current = "bob";
	await invoke(budgets.saveFund, db, {
		...args,
		id: fundId,
		revision: 1,
		name: "Car insurance",
	});
	assert.equal(
		(await invoke(budgets.funds, db, { spaceId, month })).items[0].name,
		"Car insurance",
	);
	const fund = await db.get(fundId);
	assert.ok(fund);
	const settings = fund.schedules as { createdAt: number }[];
	const cutoff = settings.at(-1)?.createdAt ?? 0;
	await db.patch(membership, { active: false, leftAt: cutoff });
	db.current = "alice";
	await invoke(budgets.saveFund, db, {
		...args,
		id: fundId,
		revision: 2,
		name: "Updated after departure",
		targetAmount: 90000,
	});
	// Separate the timestamps deterministically, even on a fast test runner.
	const updated = await db.get(fundId);
	assert.ok(updated);
	const schedules = updated.schedules as { createdAt: number }[];
	schedules[schedules.length - 1].createdAt = cutoff + 1;
	await db.patch(fundId, { schedules });
	db.current = "bob";
	const history = await invoke(budgets.funds, db, { spaceId, month });
	assert.equal(history.items[0].name, "Car insurance");
	assert.equal(history.total, 20000);
	await assert.rejects(
		() => invoke(budgets.saveFund, db, { ...args, id: fundId, revision: 3 }),
		/access/,
	);
});
function fundArgs(spaceId: Id<"spaces">) {
	return {
		spaceId,
		startMonth: month,
		effectiveMonth: month,
		openingBalance: 0,
		name: "Insurance",
		targetAmount: 60000,
		targetMonth: "2026-11",
		intervalMonths: 6,
		revision: 0,
	};
}
async function saveMonth(
	db: Memory,
	spaceId: Id<"spaces">,
	m: string,
	categoryId: Id<"categories">,
	spending = 10000,
) {
	const data = await invoke(budgets.dashboard, db, { spaceId, month: m });
	await invoke(budgets.savePlan, db, {
		spaceId,
		month: m,
		expectedIncome: spending + data.fundPlan.total,
		savingsTarget: 0,
		limits: [{ categoryId, amount: spending }],
		revision: data.plan?.revision ?? 0,
		fundSignature: data.fundPlan.signature,
	});
	return invoke(budgets.dashboard, db, { spaceId, month: m });
}

test("saving budgets reserves funds exactly once and new months recalculate instead of copying credits", async () => {
	const { db, privateId, categoryId } = await fixture();
	await invoke(budgets.saveFund, db, fundArgs(privateId));
	const first = await saveMonth(db, privateId, month, categoryId);
	assert.equal(first.balance, 0);
	assert.equal(first.fundPlan.items[0].balance, 20000);
	assert.equal(first.fundPlan.total, 20000);
	assert.equal(
		first.savings,
		0,
		"reserving a fund does not manufacture earned income or actual savings",
	);
	assert.equal(
		(await saveMonth(db, privateId, month, categoryId)).fundPlan.items[0]
			.balance,
		20000,
	);
	await invoke(budgets.ensureMonth, db, {
		spaceId: privateId,
		month: "2026-10",
	});
	let next = await invoke(budgets.funds, db, {
		spaceId: privateId,
		month: "2026-10",
	});
	assert.equal(next.contributed, 0);
	assert.equal(next.items[0].balance, 20000);
	assert.equal(next.total, 20000);
	next = (await saveMonth(db, privateId, "2026-10", categoryId)).fundPlan;
	assert.equal(next.items[0].balance, 40000);
	await saveMonth(db, privateId, "2026-11", categoryId);
	assert.equal(
		(await invoke(budgets.funds, db, { spaceId: privateId, month: "2026-12" }))
			.total,
		10000,
	);
	assert.equal(
		(await invoke(budgets.funds, db, { spaceId: privateId, month })).items[0]
			.balance,
		20000,
	);
});

test("the server rejects bypassed automatic funding and stale fund amounts without changing reservations", async () => {
	const { db, privateId, categoryId } = await fixture();
	const args = fundArgs(privateId);
	const fundId = await invoke(budgets.saveFund, db, args);
	const old = await invoke(budgets.funds, db, { spaceId: privateId, month });
	await assert.rejects(
		() =>
			invoke(budgets.savePlan, db, {
				spaceId: privateId,
				month,
				expectedIncome: 10000,
				savingsTarget: 0,
				limits: [{ categoryId, amount: 10000 }],
				revision: 0,
			}),
		/Fund amounts changed/,
	);
	await assert.rejects(
		() =>
			invoke(budgets.savePlan, db, {
				spaceId: privateId,
				month,
				expectedIncome: 10000,
				savingsTarget: 0,
				limits: [{ categoryId, amount: 10000 }],
				revision: 0,
				fundSignature: old.signature,
			}),
		/must balance/,
	);
	await saveMonth(db, privateId, month, categoryId);
	await invoke(budgets.saveFund, db, {
		...args,
		id: fundId,
		revision: 1,
		targetAmount: 90000,
	});
	await assert.rejects(
		() =>
			invoke(budgets.savePlan, db, {
				spaceId: privateId,
				month,
				expectedIncome: 30000,
				savingsTarget: 0,
				limits: [{ categoryId, amount: 10000 }],
				revision: 1,
				fundSignature: old.signature,
			}),
		/Fund amounts changed/,
	);
	const changed = await invoke(budgets.dashboard, db, {
		spaceId: privateId,
		month,
	});
	assert.equal(changed.fundPlan.items[0].balance, 20000);
	assert.equal(changed.fundPlan.total, 30000);
	assert.equal(changed.plan?.saved, false);
	assert.equal(
		(await saveMonth(db, privateId, month, categoryId)).fundPlan.items[0]
			.balance,
		30000,
	);
});

test("fund payments, refunds, pending imports, and reconciliation keep real spending without using monthly limits twice", async () => {
	const { db, privateId, categoryId, accountId } = await fixture();
	const fundId = await invoke(budgets.saveFund, db, {
		...fundArgs(privateId),
		openingBalance: 60000,
		targetAmount: 60000,
		targetMonth: month,
	});
	await saveMonth(db, privateId, month, categoryId, 0);
	const payment = {
		spaceId: privateId,
		accountId,
		description: "Insurance payment",
		amount: 60000,
		date: "2026-09-10",
		kind: "purchase" as const,
		pending: false,
		note: "",
		splits: [{ categoryId, fundId, amount: 60000 }],
		revision: 0,
	};
	await invoke(budgets.saveTransaction, db, payment);
	const manual = [...db.rows.values()].find(
		(x) => x.description === payment.description,
	);
	assert.ok(manual);
	let data = await invoke(budgets.dashboard, db, { spaceId: privateId, month });
	assert.equal(data.fundPlan.items[0].balance, 0);
	assert.equal(data.spending, 60000);
	assert.equal(data.savings, -60000);
	assert.equal(data.unreservedSavings, 0);
	assert.deepEqual(
		await invoke(budgets.alerts, db, { spaceId: privateId, month }),
		[],
	);
	const reports = await invoke(budgets.reports, db, {
		spaceId: privateId,
		from: month,
		to: month,
	});
	assert.equal(reports[0].categories[categoryId], 60000);
	await invoke(budgets.saveTransaction, db, {
		...payment,
		description: "Refund",
		amount: -5000,
		splits: [{ categoryId, fundId, amount: -5000 }],
	});
	assert.equal(
		(await invoke(budgets.funds, db, { spaceId: privateId, month })).items[0]
			.balance,
		5000,
	);
	const imported = id<"transactions">(
		await db.insert("transactions", {
			...payment,
			source: "plaid",
			funded: true,
			pending: true,
			removed: false,
			edited: false,
		}),
	);
	assert.equal(
		(await invoke(budgets.funds, db, { spaceId: privateId, month })).items[0]
			.balance,
		5000,
	);
	await invoke(budgets.reconcile, db, {
		manualId: id<"transactions">(manual._id),
		importId: imported,
		revision: 1,
	});
	assert.equal(
		(await invoke(budgets.funds, db, { spaceId: privateId, month })).items[0]
			.balance,
		65000,
		"only posted payments count",
	);
	await db.patch(imported, { pending: false });
	data = await invoke(budgets.dashboard, db, { spaceId: privateId, month });
	assert.equal(data.fundPlan.items[0].balance, 5000);
	assert.equal(data.spending, 55000, "manual/imported match counts once");
});

test("bank replacements and amount corrections keep fund links and update the reserved balance", async () => {
	const { db, privateId, accountId, categoryId } = await fixture();
	const fundId = await invoke(budgets.saveFund, db, {
		...fundArgs(privateId),
		openingBalance: 10000,
	});
	const account = await db.get(accountId);
	const connectionId = id<"connections">(String(account?.connectionId));
	await db.patch(accountId, { externalId: "a" });
	const tx = {
		account_id: "a",
		transaction_id: "pending",
		name: "Insurance",
		amount: 10,
		date: "2026-09-10",
		pending: true,
	};
	await invoke(bank.apply, db, {
		id: connectionId,
		cursor: "one",
		changed: [tx],
		removed: [],
	});
	const pending = [...db.rows.values()].find((x) => x.externalId === "pending");
	assert.ok(pending);
	await invoke(budgets.saveTransaction, db, {
		spaceId: privateId,
		id: id<"transactions">(pending._id),
		accountId,
		description: "Insurance",
		amount: 1000,
		date: tx.date,
		kind: "purchase",
		pending: true,
		note: "",
		splits: [{ categoryId, fundId, amount: 1000 }],
		revision: Number(pending.revision),
	});
	await invoke(bank.apply, db, {
		id: connectionId,
		expectedCursor: "one",
		cursor: "two",
		changed: [
			{
				...tx,
				transaction_id: "posted",
				pending_transaction_id: "pending",
				pending: false,
				amount: 12,
			},
		],
		removed: [],
	});
	assert.equal(
		(await invoke(budgets.funds, db, { spaceId: privateId, month })).items[0]
			.balance,
		8800,
	);
	await invoke(bank.apply, db, {
		id: connectionId,
		expectedCursor: "two",
		cursor: "three",
		changed: [{ ...tx, transaction_id: "posted", pending: false, amount: 15 }],
		removed: [],
	});
	assert.equal(
		(await invoke(budgets.funds, db, { spaceId: privateId, month })).items[0]
			.balance,
		8500,
	);
	await invoke(bank.apply, db, {
		id: connectionId,
		expectedCursor: "three",
		cursor: "four",
		changed: [],
		removed: [{ account_id: "a", transaction_id: "posted" }],
	});
	assert.equal(
		(await invoke(budgets.funds, db, { spaceId: privateId, month })).items[0]
			.balance,
		10000,
	);
});

test("fund access, revisions, immutable opening balances, and payment space/date are checked on the server", async () => {
	const { db, privateId, categoryId, accountId } = await fixture();
	const args = fundArgs(privateId);
	const fundId = await invoke(budgets.saveFund, db, args);
	await assert.rejects(
		() => invoke(budgets.saveFund, db, { ...args, id: fundId }),
		/changed/,
	);
	await assert.rejects(
		() =>
			invoke(budgets.saveFund, db, {
				...args,
				id: fundId,
				revision: 1,
				openingBalance: 500,
			}),
		/opening balance cannot change/,
	);
	const payment = {
		spaceId: privateId,
		accountId,
		description: "Purchase",
		amount: 100,
		date: "2026-08-10",
		kind: "purchase" as const,
		pending: false,
		note: "",
		splits: [{ categoryId, fundId, amount: 100 }],
		revision: 0,
	};
	await assert.rejects(
		() => invoke(budgets.saveTransaction, db, payment),
		/before the fund/,
	);
	db.current = "bob";
	await assert.rejects(
		() => invoke(budgets.funds, db, { spaceId: privateId, month }),
		/access/,
	);
	await assert.rejects(
		() => invoke(budgets.saveFund, db, { ...args, id: fundId, revision: 1 }),
		/access/,
	);
	await invoke(budgets.setup, db, { name: "Bob", timeZone: "UTC" });
	const bob = id<"spaces">(
		String(
			[...db.rows.values()].find(
				(x) => x.ownerId === "bob" && x.type === "private",
			)?._id,
		),
	);
	const foreign = await invoke(budgets.saveFund, db, fundArgs(bob));
	db.current = "alice";
	await assert.rejects(
		() =>
			invoke(budgets.saveTransaction, db, {
				...payment,
				date: "2026-09-10",
				splits: [{ categoryId, fundId: foreign, amount: 100 }],
			}),
		/from this budget/,
	);
	await assert.rejects(
		() =>
			invoke(budgets.saveCategory, db, {
				spaceId: privateId,
				name: " Funds ",
				color: "#000000",
			}),
		/calculated automatically/,
	);
});
