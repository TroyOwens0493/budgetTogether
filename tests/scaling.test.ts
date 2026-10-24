import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../convex/_generated/dataModel";
import * as bank from "../convex/bank.ts";
import { SYNC_BATCH_SIZE } from "../convex/bankTypes.ts";
import * as budgets from "../convex/budgets.ts";
import { encrypt, type PlaidTransaction } from "../convex/plaidClient.ts";
import { validateSplits } from "../src/domain/budget.ts";
import {
	drainSync,
	entry,
	fixture,
	id,
	invoke,
	type Memory,
} from "./helpers/backend.ts";

const tx = (
	transaction_id: string,
	extra: Partial<PlaidTransaction> = {},
): PlaidTransaction => ({
	transaction_id,
	account_id: "a",
	name: "Groceries",
	amount: 12.34,
	date: "2026-09-10",
	pending: false,
	...extra,
});
async function bankFixture() {
	const f = await fixture();
	const account = await f.db.get(f.accountId);
	const connectionId = id<"connections">(String(account?.connectionId));
	await f.db.patch(f.accountId, { externalId: "a" });
	f.db.forbidCollect = new Set([
		"transactions",
		"accounts",
		"categories",
		"bankSyncBatches",
	]);
	return { ...f, connectionId };
}
async function start(db: Memory, connectionId: Id<"connections">) {
	const state = await invoke(bank.beginSync, db, { id: connectionId });
	assert.ok(state);
	return state.run;
}
async function stage(
	db: Memory,
	runId: Id<"bankSyncRuns">,
	page: number,
	more: boolean,
	changed: PlaidTransaction[] = [],
	removed: { account_id: string; transaction_id: string }[] = [],
) {
	await invoke(bank.stageSync, db, {
		runId,
		page,
		more,
		changed,
		removed,
		cursor: `page-${page + 1}`,
	});
}
const imports = (db: Memory) =>
	[...db.rows.values()].filter(
		(x) =>
			x._id.startsWith("transactions:") && x.source === "plaid" && !x.removed,
	);
async function applyAll(db: Memory, runId: Id<"bankSyncRuns">) {
	for (let i = 0; i < 1000; i++) {
		const run = await db.get(runId);
		if (!run) return;
		assert.notEqual(run.phase, "fetching");
		await invoke(bank.applySyncBatch, db, {
			runId,
			phase: run.phase as "changes" | "removals",
			position: Number(run.position),
		});
	}
	throw new Error("Import did not finish");
}

test("transaction queries bound sparse filtering and can continue through empty pages", async () => {
	const { db, privateId, accountId, categoryId } = await fixture();
	const expected: string[] = [];
	for (let i = 0; i < 407; i++) {
		const row = await entry(
			db,
			privateId,
			accountId,
			100,
			"purchase",
			categoryId,
		);
		if (i % 103 === 0) {
			await db.patch(row, { description: "Rare MATCH" });
			expected.push(row);
		}
	}
	// Rows outside the month and budget do not enter the bounded index block.
	await entry(
		db,
		privateId,
		accountId,
		100,
		"purchase",
		categoryId,
		"2026-08-01",
	);
	db.forbidCollect.add("transactions");
	db.reads = [];
	let cursor: string | undefined;
	const found: string[] = [];
	let emptyPages = 0;
	let pages = 0;
	do {
		const page = await invoke(budgets.transactions, db, {
			spaceId: privateId,
			month: "2026-09",
			search: "rare match",
			categoryId,
			accountId,
			limit: 17,
			cursor,
		});
		if (page.rows.length === 0 && page.next) emptyPages++;
		found.push(...page.rows.map((x) => x._id));
		cursor = page.next ?? undefined;
		assert.ok(++pages < 30);
	} while (cursor);
	assert.deepEqual(found, expected.reverse());
	assert.ok(emptyPages > 0);
	const reads = db.reads.filter((x) => x.table === "transactions");
	assert.ok(reads.every((x) => x.method === "paginate" && x.rows <= 17));
	assert.equal(
		reads.reduce((sum, x) => sum + x.rows, 0),
		407,
	);
});

test("transaction cursors survive deleted anchors and same-date insertion", async () => {
	const { db, privateId, accountId } = await fixture();
	const ids = [];
	for (let i = 0; i < 7; i++)
		ids.push(await entry(db, privateId, accountId, 100, "transfer"));
	const first = await invoke(budgets.transactions, db, {
		spaceId: privateId,
		month: "2026-09",
		limit: 3,
	});
	assert.deepEqual(
		first.rows.map((x) => x._id),
		ids.slice(4).reverse(),
	);
	await db.delete(first.rows[2]._id);
	await entry(db, privateId, accountId, 100, "transfer");
	assert.ok(first.next);
	const second = await invoke(budgets.transactions, db, {
		spaceId: privateId,
		month: "2026-09",
		limit: 3,
		cursor: first.next,
	});
	assert.deepEqual(
		second.rows.map((x) => x._id),
		ids.slice(1, 4).reverse(),
	);
});

test("staged imports bound batches, defer live changes and advance cursor only on completion", async () => {
	const { db, connectionId } = await bankFixture();
	await db.patch(connectionId, { cursor: "base" });
	const run = await start(db, connectionId);
	for (let page = 0; page < 12; page++) {
		await stage(
			db,
			run._id,
			page,
			page < 11,
			Array.from({ length: SYNC_BATCH_SIZE }, (_, n) => tx(`p${page}-${n}`)),
		);
		assert.equal(imports(db).length, 0);
		assert.equal((await db.get(connectionId))?.cursor, "base");
	}
	await invoke(bank.applySyncBatch, db, {
		runId: run._id,
		phase: "changes",
		position: 0,
	});
	assert.equal(imports(db).length, 100);
	assert.equal((await db.get(connectionId))?.cursor, "base");
	// A duplicate worker cannot apply the same batch again.
	const before = structuredClone(db.rows);
	await invoke(bank.applySyncBatch, db, {
		runId: run._id,
		phase: "changes",
		position: 0,
	});
	assert.deepEqual(db.rows, before);
	await applyAll(db, run._id);
	assert.equal(imports(db).length, 1200);
	assert.equal((await db.get(connectionId))?.cursor, "page-12");
	assert.equal((await db.get(connectionId))?.status, "connected");
	assert.equal((await db.get(connectionId))?.syncRunId, undefined);
	assert.equal(
		[...db.rows.values()].filter((x) => x._id.startsWith("bankSync")).length,
		0,
	);
	assert.ok(
		db.reads
			.filter((x) =>
				["transactions", "accounts", "categories", "bankSyncBatches"].includes(
					x.table,
				),
			)
			.every((x) => x.rows <= 1),
	);
});

test("sync restarts fetch from its start cursor and rejects stale workers", async () => {
	const { db, connectionId } = await bankFixture();
	await db.patch(connectionId, { cursor: "base" });
	const run = await start(db, connectionId);
	await stage(db, run._id, 0, true, [tx("abandoned")]);
	await invoke(bank.syncFailure, db, {
		runId: run._id,
		phase: "fetching",
		pages: 1,
		position: 0,
		error: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
	});
	const resumed = await start(db, connectionId);
	assert.notEqual(resumed._id, run._id);
	assert.equal(resumed.cursor, "base");
	assert.equal(resumed.pages, 0);
	await stage(db, run._id, 1, false, [tx("stale")]);
	await invoke(bank.syncFailure, db, {
		runId: run._id,
		phase: "fetching",
		pages: 1,
		position: 0,
		error: "ITEM_LOGIN_REQUIRED",
	});
	await stage(db, resumed._id, 0, false, [tx("accepted")]);
	await applyAll(db, resumed._id);
	await invoke(bank.cleanupSync, db, { runId: run._id });
	assert.deepEqual(
		imports(db).map((x) => x.externalId),
		["accepted"],
	);
	assert.equal((await db.get(connectionId))?.status, "connected");
});

test("retry exhaustion pauses fetching and a later sync starts fresh", async () => {
	const { db, connectionId } = await bankFixture();
	const original = await start(db, connectionId);
	let run = original;
	for (let attempt = 0; attempt < 3; attempt++) {
		await stage(db, run._id, 0, true, [tx(`abandoned-${attempt}`)]);
		await invoke(bank.syncFailure, db, {
			runId: run._id,
			phase: "fetching",
			pages: 1,
			position: 0,
			error: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
		});
		if (attempt < 2) run = await start(db, connectionId);
	}
	assert.equal((await db.get(connectionId))?.status, "stale");
	assert.equal((await db.get(connectionId))?.syncRunId, undefined);
	assert.equal(
		await invoke(bank.beginSync, db, { id: connectionId, runId: run._id }),
		null,
	);
	assert.equal(imports(db).length, 0);
	const fresh = await start(db, connectionId);
	assert.equal(fresh.restarts, 0);
	assert.equal(fresh.cursor, undefined);
});

test("apply failures resume after committed batches and do not let old failures pause progress", async () => {
	const { db, connectionId } = await bankFixture();
	const run = await start(db, connectionId);
	await stage(db, run._id, 0, true, [tx("one")]);
	await stage(db, run._id, 1, false, [tx("two")]);
	await invoke(bank.applySyncBatch, db, {
		runId: run._id,
		phase: "changes",
		position: 0,
	});
	const first = structuredClone(imports(db)[0]);
	await invoke(bank.syncFailure, db, {
		runId: run._id,
		phase: "changes",
		pages: 2,
		position: 0,
		error: "SYNC_FAILED",
	});
	assert.equal((await db.get(connectionId))?.status, "syncing");
	await invoke(bank.syncFailure, db, {
		runId: run._id,
		phase: "changes",
		pages: 2,
		position: 1,
		error: "SYNC_FAILED",
	});
	assert.equal((await db.get(connectionId))?.status, "stale");
	assert.equal(
		await invoke(bank.beginSync, db, { id: connectionId, runId: run._id }),
		null,
	);
	const resumed = await start(db, connectionId);
	assert.equal(resumed.position, 1);
	await applyAll(db, resumed._id);
	assert.equal(imports(db).length, 2);
	assert.deepEqual(imports(db)[0], first);
});

test("pending replacements across pages preserve edits, history and exact split amounts", async () => {
	const { db, connectionId, privateId, categoryId, accountId } =
		await bankFixture();
	await invoke(bank.apply, db, {
		id: connectionId,
		cursor: "base",
		changed: [tx("pending", { pending: true, amount: 10 })],
		removed: [],
	});
	const pending = imports(db)[0];
	const other = id<"categories">(
		String([...db.rows.values()].find((x) => x.name === "Other")?._id),
	);
	await invoke(budgets.saveTransaction, db, {
		id: id<"transactions">(pending._id),
		spaceId: privateId,
		accountId,
		description: "My description",
		amount: 1000,
		date: "2026-09-10",
		kind: "purchase",
		pending: true,
		note: "Keep this note",
		splits: [
			{ categoryId, amount: 700 },
			{ categoryId: other, amount: 300 },
		],
		revision: Number(pending.revision),
	});
	const movedSpace = id<"spaces">(
		await db.insert("spaces", {
			name: "Later",
			type: "private",
			ownerId: "alice",
			timeZone: "UTC",
		}),
	);
	await db.patch(accountId, {
		spaceId: movedSpace,
		assignments: [{ spaceId: movedSpace, startsOn: "2026-09-01" }],
	});
	const run = await start(db, connectionId);
	await stage(
		db,
		run._id,
		0,
		true,
		[],
		[{ account_id: "a", transaction_id: "pending" }],
	);
	await stage(db, run._id, 1, false, [
		tx("posted", { amount: 2.01, pending_transaction_id: "pending" }),
	]);
	await applyAll(db, run._id);
	const posted = imports(db)[0];
	assert.equal(imports(db).length, 1);
	assert.equal(posted._id, pending._id);
	assert.equal(posted._creationTime, pending._creationTime);
	assert.equal(posted.spaceId, privateId);
	assert.equal(posted.pending, false);
	assert.equal(posted.description, "My description");
	assert.equal(posted.note, "Keep this note");
	assert.deepEqual(posted.splits, [
		{ categoryId, amount: 140 },
		{ categoryId: other, amount: 61 },
	]);
	validateSplits(
		Number(posted.amount),
		posted.splits as { categoryId: string; amount: number }[],
	);
	// Replay older pending data, then a posted update, in a new import.
	const retry = await start(db, connectionId);
	await stage(db, retry._id, 0, false, [
		tx("pending", { pending: true, amount: 10 }),
		tx("posted", { amount: 2.01, pending_transaction_id: "pending" }),
	]);
	await applyAll(db, retry._id);
	assert.deepEqual(imports(db), [posted]);
});

for (const status of ["disconnected", "review", "discarding"]) {
	test(`${status} blocks staged writes and cursor advancement`, async () => {
		const { db, connectionId } = await bankFixture();
		const run = await start(db, connectionId);
		await stage(db, run._id, 0, false, [tx("blocked")]);
		await db.patch(connectionId, { status });
		assert.equal(await invoke(bank.beginSync, db, { id: connectionId }), null);
		await invoke(bank.applySyncBatch, db, {
			runId: run._id,
			phase: "changes",
			position: 0,
		});
		await invoke(bank.syncFailure, db, {
			runId: run._id,
			phase: "changes",
			pages: 1,
			position: 0,
			error: "SYNC_FAILED",
		});
		assert.equal(imports(db).length, 0);
		assert.equal((await db.get(connectionId))?.cursor, undefined);
		assert.equal((await db.get(connectionId))?.status, status);
		await invoke(bank.cleanupSync, db, { runId: run._id });
		assert.equal(await db.get(run._id), null);
	});
}

test("cursor conflicts cancel staged work and cleanup has bounded reads", async () => {
	const { db, connectionId } = await bankFixture();
	const run = await start(db, connectionId);
	for (let i = 0; i < 23; i++)
		await stage(db, run._id, i, true, [tx(`orphan-${i}`)]);
	await db.patch(connectionId, { cursor: "newer" });
	await stage(db, run._id, 23, false, [tx("stale")]);
	assert.equal(
		await invoke(bank.beginSync, db, { id: connectionId, runId: run._id }),
		null,
	);
	db.scheduled = [];
	await invoke(bank.cleanupSync, db, { runId: run._id });
	assert.ok(await db.get(run._id));
	await drainSync(db);
	assert.equal(await db.get(run._id), null);
	assert.ok(
		db.reads
			.filter((x) => x.table === "bankSyncBatches")
			.every((x) => x.rows <= 10),
	);
	assert.equal(imports(db).length, 0);
	assert.equal((await db.get(connectionId))?.cursor, "newer");
});

test("oversized batches are rejected before staging or live writes", async () => {
	const { db, connectionId } = await bankFixture();
	const run = await start(db, connectionId);
	await assert.rejects(
		stage(
			db,
			run._id,
			0,
			false,
			Array.from({ length: SYNC_BATCH_SIZE + 1 }, (_, n) =>
				tx(`oversize-${n}`),
			),
		),
		/import limit/,
	);
	await assert.rejects(
		stage(db, run._id, 0, false, [
			tx("oversize", { name: "x".repeat(512_001) }),
		]),
		/import limit/,
	);
	assert.equal((await db.get(run._id))?.pages, 0);
	assert.equal(imports(db).length, 0);
});

test("sync action fetches one bounded page per step and an old watchdog cannot start another run", async (t) => {
	const { db, connectionId } = await bankFixture();
	const saved = {
		key: process.env.PLAID_TOKEN_ENCRYPTION_KEY,
		client: process.env.PLAID_CLIENT_ID,
		secret: process.env.PLAID_SECRET,
	};
	process.env.PLAID_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
		"base64",
	);
	process.env.PLAID_CLIENT_ID = "fixture-client";
	process.env.PLAID_SECRET = "fixture-secret";
	t.after(() => {
		for (const [key, value] of Object.entries({
			PLAID_TOKEN_ENCRYPTION_KEY: saved.key,
			PLAID_CLIENT_ID: saved.client,
			PLAID_SECRET: saved.secret,
		})) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
	await db.patch(connectionId, { accessToken: await encrypt("fixture-token") });
	const cursors: (string | undefined)[] = [];
	t.mock.method(
		globalThis,
		"fetch",
		async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body));
			assert.equal(body.count, SYNC_BATCH_SIZE);
			cursors.push(body.cursor);
			const page = cursors.length;
			return Response.json({
				added: [tx(`fetched-${page}`)],
				modified: [],
				removed: [],
				has_more: page < 3,
				next_cursor: `fetched-page-${page}`,
				accounts: [],
			});
		},
	);
	await invoke(bank.syncInternal, db, { id: connectionId });
	assert.equal(cursors.length, 1);
	assert.equal(imports(db).length, 0);
	await drainSync(db);
	assert.deepEqual(cursors, [undefined, "fetched-page-1", "fetched-page-2"]);
	assert.equal(imports(db).length, 3);
	assert.equal((await db.get(connectionId))?.cursor, "fetched-page-3");
	const watchdog = db.scheduled.find((x) => x.name === "bank:syncInternal");
	assert.ok(watchdog);
	await invoke(
		bank.syncInternal,
		db,
		watchdog.args as { id: Id<"connections">; runId: Id<"bankSyncRuns"> },
	);
	assert.equal(cursors.length, 3);
	assert.equal((await db.get(connectionId))?.syncRunId, undefined);
});

test("a failed apply mutation rolls back its batch and manual retry resumes it", async (t) => {
	const { db, connectionId } = await bankFixture();
	const run = await start(db, connectionId);
	await stage(db, run._id, 0, false, [tx("one"), tx("two")]);
	const insert = db.insert.bind(db);
	let inserts = 0;
	const fault = t.mock.method(
		db,
		"insert",
		async (table: string, value: Record<string, unknown>) => {
			if (table === "transactions" && ++inserts === 2)
				throw new Error("Simulated write failure");
			return insert(table, value);
		},
	);
	await invoke(bank.syncInternal, db, { id: connectionId, runId: run._id });
	assert.equal(imports(db).length, 0);
	assert.equal((await db.get(run._id))?.position, 0);
	assert.equal((await db.get(connectionId))?.cursor, undefined);
	assert.equal((await db.get(connectionId))?.status, "stale");
	fault.mock.restore();
	await invoke(bank.syncInternal, db, { id: connectionId });
	await drainSync(db);
	assert.equal(imports(db).length, 2);
	assert.equal((await db.get(connectionId))?.status, "connected");
});

test("a watchdog recovers a lost apply action and disconnect cleans staged data", async () => {
	const { db, connectionId } = await bankFixture();
	const run = await start(db, connectionId);
	await stage(db, run._id, 0, false, [tx("recover")]);
	// Lose the immediate continuation. Keep only the durable delayed watchdog.
	db.scheduled = db.scheduled.filter((x) => x.delay > 0);
	const watchdog = db.scheduled[0];
	await invoke(
		bank.syncInternal,
		db,
		watchdog.args as { id: Id<"connections">; runId: Id<"bankSyncRuns"> },
	);
	await drainSync(db);
	assert.equal(imports(db).length, 1);
	const next = await start(db, connectionId);
	await invoke(bank.stageSync, db, {
		runId: next._id,
		page: 0,
		more: true,
		cursor: "next-page",
		changed: [tx("never-applied")],
		removed: [],
	});
	await invoke(bank.stop, db, { id: connectionId });
	await drainSync(db);
	assert.equal(await db.get(next._id), null);
	assert.equal((await db.get(connectionId))?.status, "disconnected");
	assert.equal((await db.get(connectionId))?.syncRunId, undefined);
	assert.deepEqual(
		imports(db).map((x) => x.externalId),
		["recover"],
	);
});
