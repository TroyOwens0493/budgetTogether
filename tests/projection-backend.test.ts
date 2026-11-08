import assert from "node:assert/strict";
import test from "node:test";
import * as accounts from "../convex/accounts.ts";
import * as bank from "../convex/bank.ts";
import * as budgets from "../convex/budgets.ts";
import {
	fetchHistoricalReturn,
	normalizeHoldings,
} from "../convex/investmentClient.ts";
import * as investments from "../convex/investments.ts";
import { today } from "../convex/model/projections.ts";
import { encrypt, selectAccount } from "../convex/plaidClient.ts";
import * as projections from "../convex/projections.ts";
import {
	holdingForecastErrors,
	prepareProjection,
} from "../src/components/projection-data.ts";
import { addMonths } from "../src/domain/projections.ts";
import { fixture, id, invoke, sharedBudget } from "./helpers/backend.ts";

async function forecastFixture() {
	const data = await fixture();
	await invoke(budgets.savePlan, data.db, {
		spaceId: data.privateId,
		month: today("America/Boise").slice(0, 7),
		expectedIncome: 100000,
		savingsTarget: 100000,
		limits: [],
		revision: 0,
	});
	await invoke(projections.saveSettings, data.db, {
		spaceId: data.privateId,
		currentAge: 33,
		targetAge: 65,
		cashBalance: 500000,
		cashAnnualReturn: 0,
		revision: 0,
	});
	return data;
}
const input = {
	accountName: "SoFi manual",
	accountType: "roth ira",
	name: "Public fund",
	type: "etf" as const,
	ticker: "VTI",
	balance: 100000,
	annualReturnOverride: 0,
	monthlyContribution: 40000,
	excluded: false,
	revision: 0,
};

test("the current savings target funds cash and investments once, using saved assumptions", async () => {
	const { db, privateId } = await forecastFixture();
	await invoke(projections.saveHolding, db, { ...input, spaceId: privateId });
	const data = await invoke(projections.list, db, { spaceId: privateId });
	const result = prepareProjection(data);
	assert.deepEqual(result.errors, []);
	assert.equal(result.cashMonthly, 60000);
	assert.equal(result.points[12].cash, 1220000);
	assert.equal(result.points[12].investments, 580000);
	assert.equal(result.points[12].contributions, 1200000);
	assert.equal(result.points.at(-1)?.month, 384);
	assert.equal(
		data.accounts.find((a) => a.name === input.accountName)?.type,
		"roth ira",
	);
	await assert.rejects(
		() =>
			invoke(projections.saveHolding, db, {
				...input,
				spaceId: privateId,
				monthlyContribution: 70000,
			}),
		/cannot exceed/,
	);
});

test("historical rates fill missing assumptions, overrides take priority, and smaller budgets block overfunded forecasts", async () => {
	const { db, privateId } = await forecastFixture();
	await invoke(projections.saveHolding, db, {
		...input,
		spaceId: privateId,
		annualReturnOverride: undefined,
	});
	let data = await invoke(projections.list, db, { spaceId: privateId });
	assert.match(prepareProjection(data).errors.join(" "), /annual return/);
	await db.insert("returnHistory", {
		ticker: "VTI",
		rate: 5,
		startDate: "2015-01-01",
		endDate: "2025-01-01",
		fetchedAt: Date.now(),
	});
	data = await invoke(projections.list, db, { spaceId: privateId });
	assert.deepEqual(prepareProjection(data).errors, []);
	assert.ok(prepareProjection(data).points[12].investments > 580000);
	const holding = data.accounts.flatMap((a) => a.holdings)[0];
	await invoke(projections.saveHolding, db, {
		...input,
		spaceId: privateId,
		id: holding._id,
		revision: holding.revision,
	});
	data = await invoke(projections.list, db, { spaceId: privateId });
	assert.equal(prepareProjection(data).points[12].investments, 580000);
	await invoke(budgets.savePlan, db, {
		spaceId: privateId,
		month: data.month,
		expectedIncome: 10000,
		savingsTarget: 10000,
		limits: [],
		revision: 1,
	});
	const smaller = prepareProjection(
		await invoke(projections.list, db, { spaceId: privateId }),
	);
	assert.equal(smaller.points.length, 0);
	assert.match(smaller.errors.join(" "), /exceed/);
	await invoke(projections.saveHolding, db, {
		...input,
		spaceId: privateId,
		id: holding._id,
		revision: holding.revision + 1,
		monthlyContribution: 10000,
	});
	assert.deepEqual(
		prepareProjection(
			await invoke(projections.list, db, { spaceId: privateId }),
		).errors,
		[],
	);
});

test("a fund without a trading symbol requests an override and exclusion removes its warning", async () => {
	const { db, privateId } = await forecastFixture();
	await invoke(projections.saveHolding, db, {
		...input,
		spaceId: privateId,
		ticker: "",
		annualReturnOverride: undefined,
	});
	let data = await invoke(projections.list, db, { spaceId: privateId });
	assert.deepEqual(prepareProjection(data).errors, [
		"Public fund: enter an annual return override. No trading symbol is available for historical returns.",
	]);
	const holding = data.accounts.flatMap((account) => account.holdings)[0];
	assert.deepEqual(holdingForecastErrors(holding), [
		"enter an annual return override. No trading symbol is available for historical returns.",
	]);
	assert.deepEqual(
		holdingForecastErrors({ ...holding, annualReturnOverride: 0 }),
		[],
	);
	await invoke(projections.saveHolding, db, {
		...input,
		spaceId: privateId,
		id: holding._id,
		ticker: "",
		annualReturnOverride: undefined,
		excluded: true,
		revision: holding.revision,
	});
	data = await invoke(projections.list, db, { spaceId: privateId });
	assert.deepEqual(
		holdingForecastErrors(
			data.accounts.flatMap((account) => account.holdings)[0],
		),
		[],
	);
	assert.deepEqual(prepareProjection(data).errors, []);
	assert.ok(prepareProjection(data).points.length > 0);
});

test("a CD needs an explicit yield and maturity date before it can be forecast", async () => {
	const { db, privateId } = await forecastFixture();
	await invoke(projections.saveHolding, db, {
		...input,
		spaceId: privateId,
		type: "cd",
		ticker: "",
		annualReturnOverride: undefined,
		monthlyContribution: 0,
	});
	let data = await invoke(projections.list, db, { spaceId: privateId });
	assert.equal(prepareProjection(data).points.length, 0);
	const holding = data.accounts.flatMap((a) => a.holdings)[0];
	await invoke(projections.saveHolding, db, {
		...input,
		spaceId: privateId,
		id: holding._id,
		type: "cd",
		ticker: "",
		annualReturnOverride: 4,
		monthlyContribution: 0,
		fixedIncome: { maturityDate: addMonths(data.startsOn, 12) },
		revision: holding.revision,
	});
	data = await invoke(projections.list, db, { spaceId: privateId });
	assert.deepEqual(prepareProjection(data).errors, []);
	assert.equal(prepareProjection(data).points[12].investments, 0);
});

test("manual holdings and settings require budget access and current revisions", async () => {
	const { db, privateId } = await forecastFixture();
	await invoke(projections.saveHolding, db, { ...input, spaceId: privateId });
	const data = await invoke(projections.list, db, { spaceId: privateId });
	const holding = data.accounts.flatMap((a) => a.holdings)[0];
	await assert.rejects(
		() =>
			invoke(projections.saveHolding, db, {
				...input,
				spaceId: privateId,
				id: holding._id,
			}),
		/changed/,
	);
	await assert.rejects(
		() =>
			invoke(projections.saveSettings, db, {
				spaceId: privateId,
				currentAge: 33,
				targetAge: 65,
				cashBalance: 0,
				cashAnnualReturn: 0,
				revision: 0,
			}),
		/changed/,
	);
	db.current = "bob";
	await assert.rejects(
		() => invoke(projections.list, db, { spaceId: privateId }),
		/access/,
	);
	await assert.rejects(
		() =>
			invoke(projections.saveHolding, db, {
				...input,
				spaceId: privateId,
				id: holding._id,
				revision: holding.revision,
			}),
		/access/,
	);
	await assert.rejects(
		() =>
			invoke(projections.removeHolding, db, {
				id: holding._id,
				revision: holding.revision,
			}),
		/access/,
	);
	db.current = "alice";
	await invoke(projections.removeHolding, db, {
		id: holding._id,
		revision: holding.revision,
	});
	assert.equal(
		(
			await invoke(projections.list, db, { spaceId: privateId })
		).accounts.flatMap((a) => a.holdings).length,
		0,
	);
});

test("moving an investment account shares only its current assignment", async () => {
	const { db, privateId } = await forecastFixture();
	await invoke(projections.saveHolding, db, { ...input, spaceId: privateId });
	const sharedId = await sharedBudget(db);
	const data = await invoke(projections.list, db, { spaceId: privateId });
	const account = data.accounts.find((a) => a.investment);
	assert.ok(account);
	assert.equal(
		(await invoke(projections.list, db, { spaceId: sharedId })).accounts.length,
		0,
	);
	await invoke(accounts.move, db, {
		id: account._id,
		destinationId: sharedId,
		revision: account.revision,
	});
	assert.equal(
		(
			await invoke(projections.list, db, { spaceId: privateId })
		).accounts.flatMap((a) => a.holdings).length,
		0,
	);
	assert.equal(
		(
			await invoke(projections.list, db, { spaceId: sharedId })
		).accounts.flatMap((a) => a.holdings).length,
		1,
	);
	const membership = [...db.rows.values()].find(
		(row) =>
			row.spaceId === sharedId &&
			row.userId === "alice" &&
			row._id.startsWith("memberships:"),
	);
	assert.ok(membership);
	await db.patch(membership._id, { active: false, leftAt: Date.now() });
	await assert.rejects(
		() => invoke(projections.list, db, { spaceId: sharedId }),
		/access/,
	);
});

test("cash balances sync without importing investments as spending, and missing data blocks totals", async () => {
	const { db, privateId, accountId } = await forecastFixture();
	const account = await db.get(accountId);
	assert.ok(account);
	await db.patch(accountId, {
		type: "savings",
		balance: 200000,
		currency: "USD",
		balanceAsOf: Date.now(),
	});
	let data = await invoke(projections.list, db, { spaceId: privateId });
	assert.equal(prepareProjection(data).cash, 700000);
	await db.patch(accountId, { balance: undefined });
	data = await invoke(projections.list, db, { spaceId: privateId });
	assert.match(prepareProjection(data).errors.join(" "), /cash balance/);
	await invoke(projections.includeAccount, db, {
		id: accountId,
		excluded: true,
		revision: 0,
	});
	assert.deepEqual(
		prepareProjection(
			await invoke(projections.list, db, { spaceId: privateId }),
		).errors,
		[],
	);
	assert.equal(
		[...db.rows.values()].filter((row) => row._id.startsWith("transactions:"))
			.length,
		0,
	);
});

async function linkedFixture() {
	const data = await forecastFixture();
	const connectionId = await invoke(bank.store, data.db, {
		userId: "alice",
		spaceId: data.privateId,
		itemId: "investment-item",
		accessToken: "encrypted",
		institution: "SoFi",
		institutionId: "sofi",
		product: "investments",
		accounts: [
			{
				account_id: "ira",
				name: "SoFi IRA",
				type: "investment",
				subtype: "ira",
				mask: "1234",
			},
		],
	});
	const account = [...data.db.rows.values()].find(
		(row) => row.connectionId === connectionId && row.investment,
	);
	assert.ok(account);
	const accountId = id<"accounts">(account._id);
	await data.db.patch(connectionId, { investmentSyncAt: 1000 });
	return { ...data, connectionId, investmentAccountId: accountId };
}
const imported = {
	externalId: "security-1",
	name: "Imported stock",
	type: "stock" as const,
	ticker: "IBM",
	balance: 100000,
	currency: "USD",
};

test("holdings imports preserve overrides, reject stale workers, and retain data on disconnect", async () => {
	const { db, privateId, connectionId, investmentAccountId } =
		await linkedFixture();
	const args = {
		connectionId,
		syncAt: 1000,
		accountId: investmentAccountId,
		balance: 100000,
		currency: "USD",
		holdings: [imported],
	};
	await invoke(investments.store, db, args);
	let data = await invoke(projections.list, db, { spaceId: privateId });
	let holding = data.accounts.flatMap((a) => a.holdings)[0];
	await invoke(projections.saveHolding, db, {
		...input,
		spaceId: privateId,
		id: holding._id,
		name: imported.name,
		type: "stock",
		ticker: "IBM",
		annualReturnOverride: 8,
		revision: holding.revision,
	});
	await invoke(investments.store, db, {
		...args,
		balance: 120000,
		holdings: [{ ...imported, balance: 120000 }],
	});
	data = await invoke(projections.list, db, { spaceId: privateId });
	holding = data.accounts.flatMap((a) => a.holdings)[0];
	assert.equal(holding.balance, 120000);
	assert.equal(holding.annualReturnOverride, 8);
	assert.equal(holding.monthlyContribution, 40000);
	await assert.rejects(
		() =>
			invoke(projections.removeHolding, db, {
				id: holding._id,
				revision: holding.revision,
			}),
		/Exclude/,
	);
	await invoke(investments.store, db, { ...args, syncAt: 999, holdings: [] });
	assert.equal((await db.get(holding._id))?.active, true);
	await invoke(bank.stop, db, { id: connectionId });
	await invoke(investments.store, db, { ...args, holdings: [] });
	assert.equal((await db.get(holding._id))?.active, true);
	assert.equal(
		prepareProjection(
			await invoke(projections.list, db, { spaceId: privateId }),
		).warnings.some((text) => text.includes("last import")),
		true,
	);
});

test("a complete holdings snapshot retires disappeared holdings without duplicate imports", async () => {
	const { db, privateId, connectionId, investmentAccountId } =
		await linkedFixture();
	const args = {
		connectionId,
		syncAt: 1000,
		accountId: investmentAccountId,
		balance: 100000,
		currency: "USD",
		holdings: [imported],
	};
	await invoke(investments.store, db, args);
	await invoke(investments.store, db, args);
	assert.equal(
		(
			await invoke(projections.list, db, { spaceId: privateId })
		).accounts.flatMap((a) => a.holdings).length,
		1,
	);
	await invoke(investments.store, db, { ...args, holdings: [] });
	assert.equal(
		(
			await invoke(projections.list, db, { spaceId: privateId })
		).accounts.flatMap((a) => a.holdings).length,
		0,
	);
	assert.equal(
		[...db.rows.values()].filter((row) => row._id.startsWith("holdings:"))
			.length,
		1,
	);
});

test("normalization supports selected types and marks unsupported, missing, and non-USD data", () => {
	const data = normalizeHoldings({
		accounts: [
			{
				account_id: "ira",
				name: "IRA",
				type: "investment",
				subtype: "ira",
				mask: null,
			},
		],
		holdings: ["stock", "etf", "mutual", "bond", "cd", "crypto", "missing"].map(
			(security_id) => ({
				account_id: "ira",
				security_id,
				institution_value: security_id === "missing" ? null : 100,
				quantity: 2,
				iso_currency_code: security_id === "etf" ? "EUR" : "USD",
			}),
		),
		securities: [
			{ security_id: "stock", type: "equity", ticker_symbol: "IBM" },
			{ security_id: "etf", type: "etf" },
			{ security_id: "mutual", type: "mutual fund" },
			{
				security_id: "bond",
				type: "fixed income",
				fixed_income: {
					face_value: 1000,
					maturity_date: "2030-01-01",
					yield_rate: { percentage: 5, type: "coupon" },
				},
			},
			{
				security_id: "cd",
				type: "fixed income",
				subtype: "certificate of deposit",
			},
			{ security_id: "crypto", type: "cryptocurrency" },
		],
	});
	assert.deepEqual(
		data[0].holdings.map((h) => h.type),
		["stock", "etf", "mutualFund", "bond", "cd", "unsupported", "unsupported"],
	);
	assert.equal(data[0].holdings[3].fixedIncome?.faceValue, 200000);
	assert.match(data[0].holdings[1].problem ?? "", /USD/);
	assert.equal(
		data[0].holdings[5].problem,
		"This investment type is unsupported.",
	);
	assert.match(data[0].holdings[6].problem ?? "", /value/);
});

test("forecast errors hide provider details and simplify previously saved messages", async () => {
	const { db, privateId } = await forecastFixture();
	await invoke(projections.saveHolding, db, { ...input, spaceId: privateId });
	const historyId = await db.insert("returnHistory", {
		ticker: "VTI",
		rate: 5,
	});
	const data = await invoke(projections.list, db, { spaceId: privateId });
	const holding = data.accounts.flatMap((account) => account.holdings)[0];
	await db.patch(holding._id, {
		problem: "This investment type is outside this forecast's scope.",
	});
	for (const [error, expected] of [
		[
			"Tiingo has no price history for this symbol. Check its symbol or enter a return.",
			"No historical prices found.",
		],
		[
			"Tiingo has no adjusted price history for this symbol. Check its symbol or enter a return.",
			"No historical prices found.",
		],
		["No historical prices are available.", "No historical prices found."],
		[
			"Tiingo's request limit was reached.",
			"Historical return can't be calculated.",
		],
		[
			"At least one year of historical prices is required.",
			"Historical return can't be calculated.",
		],
		["private-provider-details", "Historical return can't be calculated."],
		[undefined, undefined],
	]) {
		await db.patch(historyId, { error });
		const result = await invoke(projections.list, db, { spaceId: privateId });
		const entry = result.accounts.flatMap((account) => account.holdings)[0];
		assert.equal(entry.history?.error, expected);
		assert.equal(entry.history?.rate, 5);
		assert.equal(entry.problem, "This investment type is unsupported.");
	}
});

test("Tiingo requests adjusted monthly prices with header authentication and share-class symbols", async (context) => {
	const previous = process.env.TIINGO_API_TOKEN;
	process.env.TIINGO_API_TOKEN = "test-token";
	const endDate = new Date().toISOString().slice(0, 10);
	const startDate = addMonths(endDate, -120);
	context.mock.method(
		globalThis,
		"fetch",
		async (input: URL | string, init?: RequestInit) => {
			const url = new URL(String(input));
			assert.equal(url.origin, "https://api.tiingo.com");
			assert.equal(url.pathname, "/tiingo/daily/BRK-B/prices");
			assert.equal(url.searchParams.get("resampleFreq"), "monthly");
			assert.equal(url.searchParams.get("format"), "json");
			assert.equal(url.searchParams.get("endDate"), endDate);
			assert.ok(String(url.searchParams.get("startDate")) < startDate);
			assert.equal(url.searchParams.has("token"), false);
			assert.equal(
				new Headers(init?.headers).get("Authorization"),
				"Token test-token",
			);
			return new Response(
				JSON.stringify([
					{ date: `${startDate}T00:00:00.000Z`, adjClose: 100, close: 1000 },
					{ date: `${endDate}T00:00:00.000Z`, adjClose: 200, close: 1000 },
				]),
			);
		},
	);
	try {
		const result = await fetchHistoricalReturn("BRK.B");
		assert.ok(Math.abs(result.rate - 7.177) < 0.02);
		assert.equal(result.startDate, startDate);
		assert.equal(result.endDate, endDate);
	} finally {
		if (previous === undefined) delete process.env.TIINGO_API_TOKEN;
		else process.env.TIINGO_API_TOKEN = previous;
	}
});

test("Tiingo errors, missing adjusted prices, and invalid JSON never expose raw responses", async (context) => {
	const previous = process.env.TIINGO_API_TOKEN;
	process.env.TIINGO_API_TOKEN = "test-token";
	try {
		for (const [status, message] of [
			[401, /authorize/],
			[403, /authorize/],
			[404, /no price history/],
			[429, /limit/],
			[500, /unavailable/],
		] as const) {
			context.mock.method(
				globalThis,
				"fetch",
				async () =>
					new Response("private-provider-request-details", { status }),
			);
			await assert.rejects(
				() => fetchHistoricalReturn("IBM"),
				(error: Error) =>
					message.test(error.message) &&
					!error.message.includes("private-provider"),
			);
		}
		for (const body of [
			"private-provider-invalid-json",
			JSON.stringify({ detail: "private-provider-details" }),
			"[]",
			JSON.stringify([{ date: "2025-01-31", close: 100 }]),
		]) {
			context.mock.method(globalThis, "fetch", async () => new Response(body));
			await assert.rejects(
				() => fetchHistoricalReturn("IBM"),
				(error: Error) =>
					/history|adjusted prices/.test(error.message) &&
					!error.message.includes("private-provider"),
			);
		}
		delete process.env.TIINGO_API_TOKEN;
		await assert.rejects(
			() => fetchHistoricalReturn("IBM"),
			/Tiingo API token/,
		);
	} finally {
		if (previous === undefined) delete process.env.TIINGO_API_TOKEN;
		else process.env.TIINGO_API_TOKEN = previous;
	}
});

test("Tiingo cache prevents duplicate work, records the source, and caps hourly requests", async () => {
	const { db } = await fixture();
	const first = await invoke(investments.reserveReturn, db, { ticker: "IBM" });
	assert.ok(first);
	assert.equal(
		await invoke(investments.reserveReturn, db, { ticker: "IBM" }),
		null,
	);
	await invoke(investments.storeReturn, db, {
		...first,
		rate: 5,
		startDate: "2015-01-01",
		endDate: "2025-01-01",
	});
	assert.equal((await db.get(first.id))?.source, "Tiingo");
	assert.equal(
		await invoke(investments.reserveReturn, db, { ticker: "IBM" }),
		null,
	);
	for (let i = 0; i < 49; i++)
		assert.ok(
			await invoke(investments.reserveReturn, db, { ticker: `FUND${i}` }),
		);
	assert.equal(
		await invoke(investments.reserveReturn, db, { ticker: "EXTRA" }),
		null,
	);
	const budget = [...db.rows.values()].find((row) => row.date === "tiingo");
	assert.equal(budget?.count, 50);
	const blocked = [...db.rows.values()].find((row) => row.ticker === "EXTRA");
	assert.match(String(blocked?.error), /hourly/);
	assert.ok(budget);
	await db.patch(budget._id, {
		requests: Array(50).fill(Date.now() - 3600001),
	});
	assert.ok(await invoke(investments.reserveReturn, db, { ticker: "EXTRA" }));
});

test("Tiingo usage limits track rolling days and different symbols over thirty days", async () => {
	const { db } = await fixture();
	const now = Date.now();
	const budgetId = await db.insert("returnBudget", {
		date: "tiingo",
		count: 1000,
		requests: Array(1000).fill(now - 2 * 3600000),
		symbols: [],
	});
	assert.equal(
		await invoke(investments.reserveReturn, db, { ticker: "IBM" }),
		null,
	);
	assert.match(
		String([...db.rows.values()].find((row) => row.ticker === "IBM")?.error),
		/daily/,
	);
	await db.patch(budgetId, {
		requests: [now - 86400001],
		symbols: Array.from({ length: 500 }, (_, i) => ({
			ticker: `FUND${i}`,
			requestedAt: now,
		})),
	});
	assert.equal(
		await invoke(investments.reserveReturn, db, { ticker: "IBM" }),
		null,
	);
	assert.match(
		String([...db.rows.values()].find((row) => row.ticker === "IBM")?.error),
		/500 different/,
	);
	assert.ok(await invoke(investments.reserveReturn, db, { ticker: "FUND0" }));
	await db.patch(budgetId, {
		symbols: [{ ticker: "OLD", requestedAt: now - 31 * 86400000 }],
	});
	assert.ok(await invoke(investments.reserveReturn, db, { ticker: "IBM" }));
	const usage = await db.get(budgetId);
	assert.equal((usage?.symbols as unknown[]).length, 1);
});

test("saved legacy returns stay attributed to their provider until Tiingo succeeds", async () => {
	const { db } = await fixture();
	const id = await db.insert("returnHistory", {
		ticker: "IBM",
		rate: 7,
		startDate: "2015-01-01",
		endDate: "2025-01-01",
		fetchedAt: Date.now(),
		requestedAt: Date.now(),
	});
	const reservation = await invoke(investments.reserveReturn, db, {
		ticker: "IBM",
	});
	assert.ok(reservation);
	await invoke(investments.storeReturn, db, {
		...reservation,
		error: "Tiingo is unavailable.",
	});
	assert.equal((await db.get(id))?.rate, 7);
	assert.equal((await db.get(id))?.source, undefined);
	await db.patch(id, { requestedAt: reservation.requestedAt - 1 });
	await invoke(investments.storeReturn, db, { ...reservation, rate: 1 });
	assert.equal((await db.get(id))?.rate, 7);
	await db.patch(id, { requestedAt: Date.now() - 60001 });
	const retry = await invoke(investments.reserveReturn, db, { ticker: "IBM" });
	assert.ok(retry);
	await invoke(investments.storeReturn, db, {
		...retry,
		rate: 6,
		startDate: "2016-01-01",
		endDate: "2026-01-01",
	});
	assert.equal((await db.get(id))?.source, "Tiingo");
	assert.equal((await db.get(id))?.rate, 6);
});

test("investment linking requests Investments and accepts only investment accounts with selected balance fields", async (context) => {
	const { db } = await fixture();
	const previous = {
		client: process.env.PLAID_CLIENT_ID,
		secret: process.env.PLAID_SECRET,
		encryption: process.env.PLAID_TOKEN_ENCRYPTION_KEY,
	};
	process.env.PLAID_CLIENT_ID = "test-client";
	process.env.PLAID_SECRET = "test-secret";
	process.env.PLAID_TOKEN_ENCRYPTION_KEY = btoa("1".repeat(32));
	const responses: Record<string, unknown> = {
		"/link/token/create": { link_token: "test-link" },
		"/item/public_token/exchange": {
			access_token: "test-token",
			item_id: "linked-investment",
		},
		"/accounts/get": {
			accounts: [
				{
					account_id: "brokerage",
					name: "SoFi brokerage",
					type: "investment",
					subtype: "brokerage",
					mask: "4321",
					balances: {
						current: 1234.56,
						available: 100,
						limit: null,
						iso_currency_code: "USD",
						last_updated_datetime: "2026-10-24T00:00:00Z",
					},
				},
				{
					account_id: "checking",
					name: "Checking",
					type: "depository",
					subtype: "checking",
					mask: "0000",
				},
			],
		},
		"/item/get": { item: { institution_id: "sofi" } },
		"/institutions/get_by_id": { institution: { name: "SoFi" } },
	};
	context.mock.method(
		globalThis,
		"fetch",
		async (input: string | URL | Request, init?: RequestInit) => {
			const path = new URL(String(input)).pathname;
			const body = JSON.parse(String(init?.body));
			if (path === "/link/token/create") {
				assert.deepEqual(body.products, ["investments"]);
				assert.equal(body.account_filters, undefined);
			}
			assert.ok(responses[path], `Unexpected endpoint: ${path}`);
			return new Response(JSON.stringify(responses[path]));
		},
	);
	try {
		assert.equal(
			await invoke(bank.link, db, { investments: true }),
			"test-link",
		);
		const connectionId = await invoke(bank.exchange, db, {
			publicToken: "public-test",
			investments: true,
		});
		assert.equal((await db.get(connectionId))?.product, "investments");
		const accounts = [...db.rows.values()].filter(
			(row) => row.connectionId === connectionId,
		);
		assert.equal(accounts.length, 1);
		assert.equal(accounts[0].investment, true);
		assert.equal(accounts[0].balance, 123456);
		const raw = (
			responses["/accounts/get"] as {
				accounts: Parameters<typeof selectAccount>[0][];
			}
		).accounts[0];
		assert.deepEqual(Object.keys(selectAccount(raw).balances ?? {}).sort(), [
			"current",
			"iso_currency_code",
			"unofficial_currency_code",
		]);
	} finally {
		for (const [name, value] of Object.entries({
			PLAID_CLIENT_ID: previous.client,
			PLAID_SECRET: previous.secret,
			PLAID_TOKEN_ENCRYPTION_KEY: previous.encryption,
		})) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
});

test("bank sync routes Investments through holdings, retains failed imports, and never creates budget transactions", async (context) => {
	const { db, privateId, connectionId, investmentAccountId } =
		await linkedFixture();
	const previous = {
		client: process.env.PLAID_CLIENT_ID,
		secret: process.env.PLAID_SECRET,
		encryption: process.env.PLAID_TOKEN_ENCRYPTION_KEY,
	};
	process.env.PLAID_CLIENT_ID = "test-client";
	process.env.PLAID_SECRET = "test-secret";
	process.env.PLAID_TOKEN_ENCRYPTION_KEY = btoa("2".repeat(32));
	await db.patch(connectionId, {
		accessToken: await encrypt("investment-token"),
		investmentSyncAt: undefined,
	});
	let failing = false;
	context.mock.method(
		globalThis,
		"fetch",
		async (url: string | URL | Request, init?: RequestInit) => {
			assert.equal(new URL(String(url)).pathname, "/investments/holdings/get");
			const body = JSON.parse(String(init?.body));
			assert.deepEqual(body.options.account_ids, ["ira"]);
			assert.equal(body.access_token, "investment-token");
			if (failing)
				return new Response(
					JSON.stringify({ error_code: "ITEM_LOGIN_REQUIRED" }),
					{ status: 400 },
				);
			return new Response(
				JSON.stringify({
					accounts: [
						{
							account_id: "ira",
							name: "SoFi IRA",
							type: "investment",
							subtype: "ira",
							mask: "1234",
							balances: { current: 1000, iso_currency_code: "USD" },
						},
					],
					holdings: [
						{
							account_id: "ira",
							security_id: "security-1",
							institution_value: 1000,
							quantity: 2,
							iso_currency_code: "USD",
						},
					],
					securities: [
						{
							security_id: "security-1",
							name: "Imported stock",
							type: "equity",
							ticker_symbol: "IBM",
						},
					],
				}),
			);
		},
	);
	try {
		await invoke(bank.sync, db, { id: connectionId });
		assert.equal((await db.get(connectionId))?.status, "connected");
		assert.equal((await db.get(investmentAccountId))?.balance, 100000);
		assert.equal(
			(
				await invoke(projections.list, db, { spaceId: privateId })
			).accounts.flatMap((a) => a.holdings).length,
			1,
		);
		assert.equal(
			[...db.rows.values()].some((row) => row._id.startsWith("transactions:")),
			false,
		);
		failing = true;
		await assert.rejects(
			() => invoke(bank.sync, db, { id: connectionId }),
			/sync failed/,
		);
		assert.equal((await db.get(connectionId))?.status, "reconnect");
		assert.equal(
			(
				await invoke(projections.list, db, { spaceId: privateId })
			).accounts.flatMap((a) => a.holdings).length,
			1,
		);
		db.current = "bob";
		await invoke(budgets.setup, db, { name: "Bob", timeZone: "UTC" });
		await assert.rejects(
			() => invoke(bank.sync, db, { id: connectionId }),
			/not found/,
		);
	} finally {
		for (const [name, value] of Object.entries({
			PLAID_CLIENT_ID: previous.client,
			PLAID_SECRET: previous.secret,
			PLAID_TOKEN_ENCRYPTION_KEY: previous.encryption,
		})) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
});

test("loaded historical prices feed budget-funded forecasts through the return cache", async (context) => {
	const { db, privateId } = await forecastFixture();
	await invoke(projections.saveHolding, db, {
		...input,
		spaceId: privateId,
		annualReturnOverride: undefined,
	});
	assert.match(
		prepareProjection(
			await invoke(projections.list, db, { spaceId: privateId }),
		).errors.join(" "),
		/load historical returns/,
	);
	const previous = process.env.TIINGO_API_TOKEN;
	process.env.TIINGO_API_TOKEN = "test-key";
	context.mock.method(
		globalThis,
		"fetch",
		async () =>
			new Response(
				JSON.stringify([
					{ date: "2015-01-30T00:00:00.000Z", adjClose: 100 },
					{ date: "2025-01-31T00:00:00.000Z", adjClose: 200 },
				]),
			),
	);
	try {
		await invoke(investments.refreshReturns, db, { spaceId: privateId });
		const data = await invoke(projections.list, db, { spaceId: privateId });
		const forecast = prepareProjection(data);
		assert.deepEqual(forecast.errors, []);
		const years =
			(Date.parse("2025-01-31") - Date.parse("2015-01-30")) /
			(365.2425 * 86400000);
		const annualFactor = 2 ** (1 / years);
		const monthlyFactor = annualFactor ** (1 / 12);
		const expected = Math.round(
			100000 * annualFactor +
				(40000 * (annualFactor - 1)) / (monthlyFactor - 1),
		);
		assert.equal(forecast.points[12].investments, expected);
		assert.equal(forecast.points[12].cash, 1220000);
		assert.equal(forecast.points[12].contributions, 1200000);
		assert.equal(forecast.points[12].growth, expected - 580000);
	} finally {
		if (previous === undefined) delete process.env.TIINGO_API_TOKEN;
		else process.env.TIINGO_API_TOKEN = previous;
	}
});

test("failed historical lookups can retry after repair without bypassing the cooldown", async (context) => {
	const { db } = await fixture();
	const now = Date.now();
	context.mock.method(Date, "now", () => now);
	const first = await invoke(investments.reserveReturn, db, { ticker: "VTI" });
	assert.ok(first);
	await invoke(investments.storeReturn, db, {
		...first,
		error:
			"Historical returns are unavailable until the market-data service is configured.",
	});
	assert.equal(
		await invoke(investments.reserveReturn, db, { ticker: "VTI" }),
		null,
	);
	context.mock.method(Date, "now", () => now + 60000);
	const retry = await invoke(investments.reserveReturn, db, { ticker: "VTI" });
	assert.ok(retry);
	assert.equal(retry.id, first.id);
	assert.equal(retry.requestedAt, now + 60000);
	assert.equal(
		await invoke(investments.reserveReturn, db, { ticker: "VTI" }),
		null,
	);
});

test("draft and unbalanced saved plans cannot supply forecast funding", async () => {
	const { db, privateId } = await forecastFixture();
	const plan = [...db.rows.values()].find(
		(row) => row._id.startsWith("plans:") && row.spaceId === privateId,
	);
	assert.ok(plan);
	await db.patch(plan._id, { saved: false });
	let data = await invoke(projections.list, db, { spaceId: privateId });
	assert.equal(data.savedPlan, false);
	assert.equal(data.savingsTarget, 0);
	assert.equal(prepareProjection(data).points.length, 0);
	await db.patch(plan._id, { saved: true, expectedIncome: 0 });
	data = await invoke(projections.list, db, { spaceId: privateId });
	assert.equal(data.savedPlan, false);
	assert.equal(data.savingsTarget, 0);
	assert.match(
		prepareProjection(data).errors.join(" "),
		/Save a balanced monthly budget/,
	);
	await db.patch(plan._id, { expectedIncome: 100000 });
	data = await invoke(projections.list, db, { spaceId: privateId });
	assert.equal(data.savedPlan, true);
	assert.equal(data.savingsTarget, 100000);
	assert.ok(prepareProjection(data).points.length > 0);
});
