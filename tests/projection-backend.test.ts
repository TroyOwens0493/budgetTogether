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
import * as projections from "../convex/projections.ts";
import * as sharing from "../convex/sharing.ts";
import { prepareProjection } from "../src/components/projection-data.ts";
import { fixture, id, invoke } from "./helpers/backend.ts";

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
	const sharedId = await invoke(sharing.create, db, {});
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
	assert.match(data[0].holdings[6].problem ?? "", /value/);
});

test("historical requests use adjusted monthly prices and never expose provider error details", async (context) => {
	context.mock.method(
		globalThis,
		"fetch",
		async (url: URL | string, init: RequestInit) => {
			const request = new URL(String(url));
			assert.equal(request.origin, "https://api.tiingo.com");
			assert.equal(request.pathname, "/tiingo/daily/BRK-B/prices");
			assert.equal(request.searchParams.get("resampleFreq"), "monthly");
			assert.equal(
				new Headers(init.headers).get("Authorization"),
				"Token test-key",
			);
			assert.equal(request.searchParams.has("token"), false);
			assert.equal(
				Number(request.searchParams.get("startDate")?.slice(0, 4)),
				new Date().getUTCFullYear() - 11,
			);
			return new Response(
				JSON.stringify([
					{ date: "2015-01-30T00:00:00.000Z", adjClose: 100, close: 50 },
					{ date: "2025-01-31T00:00:00.000Z", adjClose: 200, close: 500 },
				]),
			);
		},
	);
	const previous = process.env.TIINGO_API_TOKEN;
	process.env.TIINGO_API_TOKEN = "test-key";
	try {
		const result = await fetchHistoricalReturn("BRK.B");
		assert.ok(Math.abs(result.rate - 7.177) < 0.02);
		assert.equal(result.startDate, "2015-01-30");
		assert.equal(result.endDate, "2025-01-31");
		context.mock.method(
			globalThis,
			"fetch",
			async () =>
				new Response(
					JSON.stringify({ Information: "secret-provider-request-details" }),
					{ status: 429 },
				),
		);
		await assert.rejects(
			() => fetchHistoricalReturn("IBM"),
			(error: Error) =>
				/limit/.test(error.message) &&
				!error.message.includes("secret-provider"),
		);
	} finally {
		if (previous === undefined) delete process.env.TIINGO_API_TOKEN;
		else process.env.TIINGO_API_TOKEN = previous;
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

test("return cache reservations prevent duplicate work and bound daily requests", async () => {
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
	assert.equal(
		await invoke(investments.reserveReturn, db, { ticker: "IBM" }),
		null,
	);
	for (let i = 0; i < 24; i++)
		assert.ok(
			await invoke(investments.reserveReturn, db, { ticker: `FUND${i}` }),
		);
	assert.equal(
		await invoke(investments.reserveReturn, db, { ticker: "EXTRA" }),
		null,
	);
	const budget = [...db.rows.values()].find((row) =>
		row._id.startsWith("returnBudget:"),
	);
	assert.equal(budget?.count, 25);
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
