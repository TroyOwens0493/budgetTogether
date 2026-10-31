import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import * as bank from "../convex/bank.ts";
import * as budgets from "../convex/budgets.ts";
import * as classification from "../convex/classification.ts";
import { classifyTransaction, JEV_MODEL } from "../convex/jevClient.ts";
import { fixture, id, invoke } from "./helpers/backend.ts";

const input = {
	description: "GROCERY STORE",
	merchant: "Market",
	amount: -1234,
	date: "2026-09-10",
	pending: false,
	accountType: "checking",
	categories: [{ id: "private-category", name: "Groceries" }],
};
function secret(t: TestContext) {
	const saved = process.env.JEV_SECRET;
	process.env.JEV_SECRET = "fixture-secret";
	t.after(() => {
		if (saved === undefined) delete process.env.JEV_SECRET;
		else process.env.JEV_SECRET = saved;
	});
}
function answer(kind = "purchase", category = "category_0", confidence = 0.95) {
	return {
		model: JEV_MODEL,
		answers: {
			kind: {
				type: "choice",
				choice: kind,
				confidence,
				probabilities: {
					purchase: kind === "purchase" ? 1 : 0,
					income: kind === "income" ? 1 : 0,
					transfer: kind === "transfer" ? 1 : 0,
				},
			},
			category: {
				type: "choice",
				choice: category,
				confidence,
				probabilities: {
					category_0: category === "category_0" ? 1 : 0,
					uncategorized: category === "uncategorized" ? 1 : 0,
				},
			},
		},
	};
}
test("TypeSafe receives two typed questions, cents and budget names without internal identifiers", async (t) => {
	secret(t);
	t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
		assert.equal(url, "https://api.typesafe.ai/v1/systemone");
		assert.equal(
			new Headers(init.headers).get("Authorization"),
			"Bearer fixture-secret",
		);
		const body = JSON.parse(String(init.body));
		assert.equal(body.model, JEV_MODEL);
		assert.equal(body.state.amount_cents, -1234);
		assert.equal(body.state.currency, "USD");
		assert.deepEqual(Object.keys(body.questions), ["kind", "category"]);
		assert.equal(body.questions.category.criteria.category_0, "Groceries");
		assert.ok(!String(init.body).includes("private-category"));
		assert.ok(!String(init.body).includes("fixture-secret"));
		return Response.json(answer());
	});
	assert.deepEqual(await classifyTransaction(input), {
		kind: "purchase",
		categoryId: "private-category",
		kindConfidence: 0.95,
		categoryConfidence: 0.95,
		model: JEV_MODEL,
	});
});
test("income and transfers discard speculative purchase category answers", async (t) => {
	secret(t);
	for (const kind of ["income", "transfer"] as const) {
		const mock = t.mock.method(globalThis, "fetch", async () =>
			Response.json(answer(kind)),
		);
		assert.equal((await classifyTransaction(input)).categoryId, undefined);
		mock.mock.restore();
	}
});
test("empty categories ask only for type and unknown categories stay uncategorized", async (t) => {
	secret(t);
	const mock = t.mock.method(
		globalThis,
		"fetch",
		async (_url: string, init: RequestInit) => {
			assert.deepEqual(Object.keys(JSON.parse(String(init.body)).questions), [
				"kind",
			]);
			return Response.json({
				model: JEV_MODEL,
				answers: { kind: answer().answers.kind },
			});
		},
	);
	assert.equal(
		(await classifyTransaction({ ...input, categories: [] })).categoryId,
		undefined,
	);
	mock.mock.restore();
	t.mock.method(globalThis, "fetch", async () =>
		Response.json(answer("purchase", "uncategorized")),
	);
	assert.equal((await classifyTransaction(input)).categoryId, undefined);
});
test("invalid provider answers cannot become budget classifications", async (t) => {
	secret(t);
	for (const bad of [
		{ ...answer(), model: "different-model" },
		{ ...answer(), answers: {} },
		{
			...answer(),
			answers: {
				...answer().answers,
				kind: { ...answer().answers.kind, choice: "invented" },
			},
		},
		{
			...answer(),
			answers: {
				...answer().answers,
				kind: { ...answer().answers.kind, confidence: 2 },
			},
		},
		{
			...answer(),
			answers: {
				...answer().answers,
				kind: { ...answer().answers.kind, probabilities: {} },
			},
		},
	]) {
		const mock = t.mock.method(globalThis, "fetch", async () =>
			Response.json(bad),
		);
		await assert.rejects(classifyTransaction(input), /JEV_INVALID_RESPONSE/);
		mock.mock.restore();
	}
});
test("provider errors do not expose the response body or credentials", async (t) => {
	secret(t);
	t.mock.method(
		globalThis,
		"fetch",
		async () => new Response("sensitive provider details", { status: 429 }),
	);
	await assert.rejects(classifyTransaction(input), /^Error: JEV_HTTP_429$/);
});
async function imported() {
	const f = await fixture();
	const account = await f.db.get(f.accountId);
	const connectionId = id<"connections">(String(account?.connectionId));
	await f.db.patch(f.accountId, { externalId: "bank-account" });
	const transaction = {
		transaction_id: "external-transaction",
		account_id: "bank-account",
		name: "Market refund",
		merchant_name: "Market",
		amount: -12.34,
		date: "2026-09-10",
		pending: false,
		personal_finance_category: { primary: "INCOME", detailed: "INCOME_WAGES" },
	};
	await invoke(bank.apply, f.db, {
		id: connectionId,
		cursor: "one",
		changed: [transaction],
		removed: [],
	});
	const row = [...f.db.rows.values()].find(
		(x) => x.externalId === transaction.transaction_id,
	);
	assert.ok(row);
	return {
		...f,
		connectionId,
		transaction,
		transactionId: id<"transactions">(row._id),
	};
}
const decision = {
	kind: "purchase" as const,
	kindConfidence: 0.95,
	categoryConfidence: 0.95,
	model: JEV_MODEL,
};
async function claimed(f: Awaited<ReturnType<typeof imported>>) {
	const state = await invoke(classification.claim, f.db, {
		id: f.transactionId,
	});
	assert.ok(state);
	const { input: _input, ...job } = state;
	return job;
}
test("imports ignore Plaid classifications and queue Jev without blocking bank sync", async () => {
	const f = await imported();
	const row = await f.db.get(f.transactionId);
	assert.equal(row?.kind, "purchase");
	assert.deepEqual(row?.splits, []);
	assert.equal(row?.classificationStatus, "pending");
	assert.equal((await f.db.get(f.connectionId))?.cursor, "one");
	assert.ok(f.db.scheduled.some((x) => x.name === "classification:classify"));
	const job = await claimed(f);
	await invoke(classification.complete, f.db, {
		...job,
		result: { ...decision, categoryId: f.categoryId },
	});
	assert.deepEqual((await f.db.get(f.transactionId))?.splits, [
		{ categoryId: f.categoryId, amount: -1234 },
	]);
	assert.equal(
		(await f.db.get(f.transactionId))?.classificationStatus,
		"classified",
	);
	assert.equal(
		(
			await invoke(budgets.dashboard, f.db, {
				spaceId: f.privateId,
				month: "2026-09",
			})
		).spending,
		-1234,
	);
});
test("uncertain and unmatched purchases apply the best answer and require review", async () => {
	for (const confidence of [0.79, 0.8]) {
		const f = await imported();
		const job = await claimed(f);
		await invoke(classification.complete, f.db, {
			...job,
			result: { ...decision, kind: "transfer", kindConfidence: confidence },
		});
		assert.equal((await f.db.get(f.transactionId))?.kind, "transfer");
		assert.equal(
			(await f.db.get(f.transactionId))?.classificationStatus,
			confidence < 0.8 ? "review" : "classified",
		);
	}
	const f = await imported();
	await invoke(classification.complete, f.db, {
		...(await claimed(f)),
		result: decision,
	});
	assert.equal(
		(await f.db.get(f.transactionId))?.classificationStatus,
		"review",
	);
});
test("manual edits during a Jev request win and clear the review flag", async () => {
	const f = await imported();
	const job = await claimed(f);
	await invoke(budgets.saveTransaction, f.db, {
		id: f.transactionId,
		spaceId: f.privateId,
		accountId: f.accountId,
		revision: job.revision,
		description: "My refund",
		amount: -1234,
		date: "2026-09-10",
		pending: false,
		kind: "purchase",
		note: "Private note",
		splits: [{ categoryId: f.categoryId, amount: -1234 }],
	});
	await invoke(classification.complete, f.db, {
		...job,
		result: { ...decision, kind: "income" },
	});
	const row = await f.db.get(f.transactionId);
	assert.equal(row?.kind, "purchase");
	assert.equal(row?.description, "My refund");
	assert.equal(row?.note, "Private note");
	assert.equal(row?.classificationStatus, "manual");
	assert.equal(
		await invoke(classification.claim, f.db, { id: f.transactionId }),
		null,
	);
});
test("bank corrections invalidate in-flight answers and identical imports do not call Jev again", async () => {
	const f = await imported();
	const job = await claimed(f);
	await invoke(bank.apply, f.db, {
		id: f.connectionId,
		expectedCursor: "one",
		cursor: "two",
		changed: [{ ...f.transaction, amount: -23.45 }],
		removed: [],
	});
	await invoke(classification.complete, f.db, {
		...job,
		result: { ...decision, categoryId: f.categoryId },
	});
	assert.equal(
		(await f.db.get(f.transactionId))?.classificationStatus,
		"pending",
	);
	await invoke(classification.complete, f.db, {
		...(await claimed(f)),
		result: { ...decision, categoryId: f.categoryId },
	});
	const revision = (await f.db.get(f.transactionId))?.revision;
	const scheduled = f.db.scheduled.length;
	await invoke(bank.apply, f.db, {
		id: f.connectionId,
		expectedCursor: "two",
		cursor: "three",
		changed: [{ ...f.transaction, amount: -23.45 }],
		removed: [],
	});
	assert.equal((await f.db.get(f.transactionId))?.revision, revision);
	assert.equal(f.db.scheduled.length, scheduled);
});
test("category changes invalidate a result and another budget's categories are rejected", async () => {
	const f = await imported();
	const job = await claimed(f);
	await f.db.patch(f.categoryId, { name: "Changed category" });
	await invoke(classification.complete, f.db, {
		...job,
		result: { ...decision, categoryId: f.categoryId },
	});
	assert.equal(
		(await f.db.get(f.transactionId))?.classificationStatus,
		"pending",
	);
	const foreign = id<"categories">(
		await f.db.insert("categories", {
			spaceId: "another-budget",
			name: "Private",
		}),
	);
	await assert.rejects(
		invoke(classification.complete, f.db, {
			...(await claimed(f)),
			result: { ...decision, categoryId: foreign },
		}),
		/must belong/,
	);
});
test("leases prevent duplicate workers and expired leases recover lost actions", async (t) => {
	const f = await imported();
	let now = Date.now();
	t.mock.method(Date, "now", () => now);
	const first = await claimed(f);
	assert.equal(
		await invoke(classification.claim, f.db, { id: f.transactionId }),
		null,
	);
	now += 60_001;
	const second = await claimed(f);
	await invoke(classification.complete, f.db, {
		...first,
		result: { ...decision, kind: "income" },
	});
	assert.equal(
		(await f.db.get(f.transactionId))?.classificationStatus,
		"pending",
	);
	await invoke(classification.complete, f.db, {
		...second,
		result: { ...decision, categoryId: f.categoryId },
	});
	assert.equal(
		(await f.db.get(f.transactionId))?.classificationStatus,
		"classified",
	);
});
test("failed requests retry with backoff and preserve bank history", async (t) => {
	const f = await imported();
	secret(t);
	t.mock.method(
		globalThis,
		"fetch",
		async () => new Response("unavailable", { status: 529 }),
	);
	await invoke(classification.classify, f.db, { id: f.transactionId });
	const row = await f.db.get(f.transactionId);
	assert.equal(row?.classificationStatus, "pending");
	assert.equal(row?.classificationError, "JEV_HTTP_529");
	assert.ok(
		f.db.scheduled.some(
			(x) => x.name === "classification:classify" && x.delay === 30_000,
		),
	);
	assert.equal(row?.amount, -1234);
	assert.equal((await f.db.get(f.connectionId))?.status, "connected");
});
test("backfill is bounded, includes disconnected history, and preserves manual or removed entries", async () => {
	const f = await imported();
	await f.db.patch(f.connectionId, { status: "disconnected" });
	for (let n = 0; n < 57; n++)
		await f.db.insert("transactions", {
			spaceId: f.privateId,
			accountId: f.accountId,
			description: "Legacy",
			amount: 100,
			date: "2026-09-10",
			pending: false,
			kind: "income",
			source: "plaid",
			edited: n === 0,
			removed: n === 1,
			splits: [],
			revision: 0,
		});
	f.db.forbidCollect.add("transactions");
	await invoke(classification.poll, f.db, {});
	assert.equal(
		[...f.db.rows.values()].filter(
			(x) => x.source === "plaid" && x.classificationStatus === undefined,
		).length,
		7,
	);
	await invoke(classification.poll, f.db, {});
	assert.equal(
		[...f.db.rows.values()].filter(
			(x) => x.source === "plaid" && x.classificationStatus === undefined,
		).length,
		0,
	);
	assert.ok(
		[...f.db.rows.values()].some((x) => x.classificationStatus === "manual"),
	);
	assert.ok(
		[...f.db.rows.values()].some((x) => x.classificationStatus === "skipped"),
	);
	assert.ok(
		f.db.reads
			.filter((x) => x.table === "transactions")
			.every((x) => x.rows <= 50),
	);
});
