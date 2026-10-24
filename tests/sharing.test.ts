import assert from "node:assert/strict";
import test from "node:test";
import * as accounts from "../convex/accounts.ts";
import * as bank from "../convex/bank.ts";
import * as budgets from "../convex/budgets.ts";
import * as classification from "../convex/classification.ts";
import * as sharing from "../convex/sharing.ts";
import {
	connectedAccount,
	entry,
	fixture,
	id,
	invoke,
	type Memory,
} from "./helpers/backend.ts";

async function household() {
	const f = await fixture();
	const sharedId = await invoke(sharing.create, f.db, {});
	// Fix the history dates so tests do not depend on the current month.
	for (const row of f.db.rows.values())
		if (row._id.startsWith("memberships:") && row.spaceId === sharedId)
			await f.db.patch(row._id, {
				joinedAt: Date.parse("2026-09-01T12:00:00Z"),
			});
	f.db.current = "bob";
	await invoke(budgets.setup, f.db, { name: "Bob", timeZone: "UTC" });
	const bobPrivateId = (await invoke(budgets.home, f.db, {})).spaces[0]._id;
	await f.db.insert("memberships", {
		spaceId: sharedId,
		userId: "bob",
		active: true,
		joinedAt: Date.parse("2026-09-01T12:00:00Z"),
	});
	const bobAccountId = await connectedAccount(f.db, sharedId, "Bob checking");
	f.db.current = "alice";
	await f.db.patch(f.accountId, {
		spaceId: sharedId,
		assignments: [
			{ spaceId: f.privateId, startsOn: "0000-01-01" },
			{ spaceId: sharedId, startsOn: "2026-09-01" },
		],
	});
	return { ...f, sharedId, bobPrivateId, bobAccountId };
}

async function drainDeletion(db: Memory) {
	for (let i = 0; i < 100; i++) {
		const next = db.scheduled.findIndex((job) => job.name === "sharing:purge");
		if (next < 0) return;
		const [job] = db.scheduled.splice(next, 1);
		await invoke(
			sharing.purge,
			db,
			job.args as { spaceId: ReturnType<typeof id<"spaces">> },
		);
	}
	throw new Error("Budget deletion did not finish");
}

test("either partner can delete the shared budget, its records and both memberships", async () => {
	const {
		db,
		sharedId,
		privateId,
		accountId,
		bobPrivateId,
		bobAccountId,
		categoryId,
	} = await household();
	const privateEntry = await entry(
		db,
		privateId,
		accountId,
		123,
		"purchase",
		categoryId,
		"2026-08-10",
	);
	await entry(db, sharedId, accountId, 500, "purchase");
	await entry(db, sharedId, bobAccountId, 800, "purchase");
	const before = new Map(db.rows);
	for (const personal of [privateId, bobPrivateId]) {
		await db.insert("plans", {
			spaceId: personal,
			month: "2026-09",
			expectedIncome: 0,
			savingsTarget: 0,
			limits: [],
			saved: true,
			reviewed: true,
			revision: 1,
		});
		await db.insert("personalAllocations", {
			privateId: personal,
			sharedId,
			month: "2026-09",
			amount: 1000,
			revision: 1,
		});
		await db.insert("contributions", {
			privateId: personal,
			sharedId,
			month: "2026-08",
			planned: 500,
			pairs: [],
			revision: 1,
		});
	}
	const earlierPlan = await db.insert("plans", {
		spaceId: privateId,
		month: "2026-07",
		expectedIncome: 0,
		savingsTarget: 0,
		limits: [],
		saved: true,
		reviewed: false,
		revision: 1,
	});
	const contributionPlan = await db.insert("plans", {
		spaceId: privateId,
		month: "2026-08",
		expectedIncome: 1000,
		savingsTarget: 0,
		limits: [{ categoryId, amount: 500 }],
		saved: true,
		reviewed: false,
		revision: 1,
	});
	await db.insert("funds", {
		spaceId: sharedId,
		startMonth: "2026-09",
		openingBalance: 5000,
		schedules: [
			{
				effectiveMonth: "2026-09",
				name: "Insurance",
				targetAmount: 60000,
				targetMonth: "2027-01",
				intervalMonths: 6,
				createdAt: Date.now(),
			},
		],
		revision: 1,
	});
	await db.insert("plans", {
		spaceId: sharedId,
		month: "2026-09",
		expectedIncome: 0,
		savingsTarget: 0,
		limits: [],
		reviewed: false,
		revision: 1,
	});
	await db.insert("carry", {
		spaceId: sharedId,
		sourceMonth: "2026-08",
		destinationMonth: "2026-09",
		amount: 100,
	});
	await db.insert("recurring", {
		spaceId: sharedId,
		merchant: "Rent",
		status: "confirmed",
	});
	await db.insert("projectionSettings", {
		spaceId: sharedId,
		currentAge: 30,
		targetAge: 65,
		ageAsOf: "2026-09-01",
		cashBalance: 10000,
		cashAnnualReturn: 0,
		revision: 1,
	});
	const holding = await db.insert("holdings", {
		accountId: bobAccountId,
		name: "Investment",
		type: "stock",
		currency: "USD",
		balance: 10000,
		monthlyContribution: 0,
		excluded: false,
		active: true,
		revision: 1,
	});
	for (const actor of ["alice", "bob"]) {
		await db.insert("alertReads", {
			userId: actor,
			key: `${sharedId}:2026-09:carry`,
		});
		await db.insert("invitations", {
			spaceId: sharedId,
			inviterId: actor,
			email: `${actor}@example.com`,
			tokenHash: actor,
			expiresAt: Date.now() + 86400000,
			status: "pending",
			delivery: "queued",
		});
	}
	const privateRead = await db.insert("alertReads", {
		userId: "alice",
		key: `${privateId}:2026-09:carry`,
	});
	db.current = "bob"; // The non-owner has the same right to leave and delete.
	await invoke(sharing.leave, db, { spaceId: sharedId });
	await drainDeletion(db);
	assert.equal(await db.get(sharedId), null);
	for (const row of db.rows.values()) {
		assert.notEqual(row.spaceId, sharedId);
		assert.notEqual(row.sharedId, sharedId);
		assert.ok(!String(row.key ?? "").startsWith(`${sharedId}:`));
	}
	assert.equal((await db.get(accountId))?.spaceId, privateId);
	assert.equal((await db.get(bobAccountId))?.spaceId, bobPrivateId);
	assert.deepEqual(await db.get(privateEntry), before.get(privateEntry));
	assert.ok(await db.get(holding));
	assert.ok(await db.get(privateRead));
	assert.equal((await db.get(earlierPlan))?.saved, true);
	assert.equal((await db.get(contributionPlan))?.saved, false);
	for (const account of [accountId, bobAccountId]) {
		const row = await db.get(account);
		assert.ok(row?.active);
		assert.ok(await db.get(String(row?.connectionId)));
		assert.ok(!JSON.stringify(row?.assignments).includes(sharedId));
	}
	for (const actor of ["alice", "bob"]) {
		db.current = actor;
		const home = await invoke(budgets.home, db, {});
		assert.equal(home.spaces.length, 1);
		const dashboard = await invoke(budgets.dashboard, db, {
			spaceId: home.spaces[0]._id,
			month: "2026-09",
		});
		assert.equal(dashboard.fundedBy, null);
		assert.equal(dashboard.funds.incoming, 0);
		assert.equal(dashboard.plan?.saved, false);
		await assert.rejects(
			() =>
				invoke(budgets.dashboard, db, { spaceId: sharedId, month: "2026-09" }),
			/not found/,
		);
		await assert.rejects(
			() => invoke(sharing.status, db, { spaceId: sharedId }),
			/not found/,
		);
		await assert.rejects(
			() =>
				invoke(budgets.saveCategory, db, {
					spaceId: sharedId,
					name: "No",
					color: "#123456",
				}),
			/not found/,
		);
		assert.ok(await invoke(sharing.create, db, {}));
	}
});

test("private budgets, outsiders and former members cannot delete a shared budget", async () => {
	const { db, privateId, sharedId } = await household();
	await assert.rejects(
		() => invoke(sharing.leave, db, { spaceId: privateId }),
		/only a shared/,
	);
	db.current = "outsider";
	await assert.rejects(
		() => invoke(sharing.leave, db, { spaceId: sharedId }),
		/access/,
	);
	const member = [...db.rows.values()].find(
		(row) => row.spaceId === sharedId && row.userId === "bob",
	);
	assert.ok(member);
	await db.patch(member._id, { active: false, leftAt: Date.now() });
	db.current = "bob";
	await assert.rejects(
		() => invoke(sharing.leave, db, { spaceId: sharedId }),
		/access/,
	);
	await invoke(sharing.purge, db, { spaceId: sharedId });
	assert.ok(await db.get(sharedId));
});

test("large histories delete in bounded retry-safe batches and block reads immediately", async () => {
	const { db, privateId, sharedId, accountId } = await household();
	for (let i = 0; i < 257; i++)
		await entry(db, sharedId, accountId, i, "purchase");
	db.forbidCollect.add("transactions");
	await invoke(sharing.leave, db, { spaceId: sharedId });
	assert.equal(await db.get(sharedId), null);
	assert.equal((await invoke(budgets.home, db, {})).spaces.length, 1);
	assert.equal((await db.get(accountId))?.spaceId, privateId);
	assert.ok([...db.rows.values()].some((row) => row.spaceId === sharedId));
	await assert.rejects(
		() =>
			invoke(budgets.transactions, db, { spaceId: sharedId, month: "2026-09" }),
		/not found/,
	);
	await drainDeletion(db);
	await invoke(sharing.purge, db, { spaceId: sharedId });
	assert.ok(![...db.rows.values()].some((row) => row.spaceId === sharedId));
	assert.ok(
		db.reads
			.filter((read) => read.table === "transactions")
			.every((read) => read.rows <= 100),
	);
});

test("bank sync cannot restore deleted shared periods and still imports private history and new entries", async () => {
	const { db, privateId, sharedId, accountId } = await household();
	const account = await db.get(accountId);
	assert.ok(account);
	const connectionId = id<"connections">(String(account.connectionId));
	const tx = (transaction_id: string, date: string) => ({
		transaction_id,
		account_id: String(account.externalId),
		date,
		amount: 10,
		pending: false,
		name: "Purchase",
	});
	await invoke(bank.apply, db, {
		id: connectionId,
		cursor: "before",
		changed: [tx("shared", "2026-09-10")],
		removed: [],
	});
	const sharedEntry = [...db.rows.values()].find(
		(row) => row.externalId === "shared",
	);
	assert.ok(sharedEntry);
	await invoke(sharing.leave, db, { spaceId: sharedId });
	await drainDeletion(db);
	await invoke(classification.claim, db, {
		id: id<"transactions">(sharedEntry._id),
	});
	await invoke(bank.apply, db, {
		id: connectionId,
		expectedCursor: "before",
		cursor: "after",
		changed: [
			tx("shared", "2026-09-10"),
			tx("late-shared", "2026-09-20"),
			tx("private", "2026-08-10"),
			tx("new-private", "9999-01-01"),
		],
		removed: [],
	});
	const rows = [...db.rows.values()].filter((row) =>
		row._id.startsWith("transactions:"),
	);
	assert.deepEqual(rows.map((row) => row.externalId).sort(), [
		"new-private",
		"private",
	]);
	assert.ok(rows.every((row) => row.spaceId === privateId));
});

test("accounts moved out before departure also forget deleted shared periods", async () => {
	const { db, sharedId, privateId, accountId } = await household();
	await invoke(accounts.move, db, {
		id: accountId,
		destinationId: privateId,
		revision: 0,
	});
	const before = await db.get(accountId);
	assert.ok(before);
	await invoke(sharing.leave, db, { spaceId: sharedId });
	const after = await db.get(accountId);
	assert.ok(after);
	assert.equal(after.spaceId, before.spaceId);
	assert.ok(!JSON.stringify(after.assignments).includes(sharedId));
	assert.ok(JSON.stringify(after.assignments).includes('"spaceId":null'));
});

test("deleted imports cannot return on the departure date or through pending replacements", async () => {
	const { db, sharedId, privateId, accountId } = await household();
	const account = await db.get(accountId);
	assert.ok(account);
	const connectionId = id<"connections">(String(account.connectionId));
	const today = new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Boise",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
	const tx = (
		transaction_id: string,
		pending = false,
		pending_transaction_id?: string,
	) => ({
		transaction_id,
		account_id: String(account.externalId),
		date: today,
		amount: 10,
		pending,
		name: "Purchase",
		...(pending_transaction_id ? { pending_transaction_id } : {}),
	});
	await invoke(bank.apply, db, {
		id: connectionId,
		cursor: "before",
		changed: [
			tx("same-day"),
			tx("pending", true),
			tx("already-posted", false, "old-pending"),
		],
		removed: [],
	});
	await invoke(sharing.leave, db, { spaceId: sharedId });
	await drainDeletion(db);
	for (const [expectedCursor, cursor, changed] of [
		[
			"before",
			"after",
			[
				tx("same-day"),
				tx("posted", false, "pending"),
				tx("old-pending", true),
				tx("new-private"),
			],
		],
		["after", "replayed", [tx("posted"), tx("already-posted")]],
	] as const)
		await invoke(bank.apply, db, {
			id: connectionId,
			expectedCursor,
			cursor,
			changed: [...changed],
			removed: [],
		});
	const rows = [...db.rows.values()].filter((row) =>
		row._id.startsWith("transactions:"),
	);
	assert.deepEqual(
		rows.map((row) => row.externalId),
		["new-private"],
	);
	assert.equal(rows[0].spaceId, privateId);
});

test("bank corrections during background deletion cannot later return as new private entries", async () => {
	const { db, sharedId, accountId } = await household();
	const account = await db.get(accountId);
	assert.ok(account);
	const connectionId = id<"connections">(String(account.connectionId));
	const tx = (
		transaction_id: string,
		date: string,
		pending_transaction_id?: string,
	) => ({
		transaction_id,
		account_id: String(account.externalId),
		date,
		amount: 10,
		pending: false,
		name: "Purchase",
		...(pending_transaction_id ? { pending_transaction_id } : {}),
	});
	// Leave the pending entry beyond the first deletion batch.
	for (let i = 0; i < 110; i++)
		await entry(
			db,
			sharedId,
			accountId,
			100,
			"purchase",
			undefined,
			"2026-09-01",
		);
	await invoke(bank.apply, db, {
		id: connectionId,
		cursor: "before",
		changed: [{ ...tx("pending", "2026-09-20"), pending: true }],
		removed: [],
	});
	await invoke(sharing.leave, db, { spaceId: sharedId });
	await invoke(bank.apply, db, {
		id: connectionId,
		expectedCursor: "before",
		cursor: "during",
		changed: [tx("posted", "9999-01-01", "pending"), tx("late", "2026-09-20")],
		removed: [],
	});
	await drainDeletion(db);
	await invoke(bank.apply, db, {
		id: connectionId,
		expectedCursor: "during",
		cursor: "after",
		changed: [tx("posted", "9999-01-01"), tx("late", "9999-01-01")],
		removed: [],
	});
	assert.ok(
		![...db.rows.values()].some((row) => row._id.startsWith("transactions:")),
	);
});
