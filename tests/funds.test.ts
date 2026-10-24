import assert from "node:assert/strict";
import test from "node:test";
import {
	type Fund,
	type FundContribution,
	fundForMonth,
	validateFundSchedule,
} from "../src/domain/funds.ts";

function repeating(): Fund {
	return {
		_id: "insurance",
		startMonth: "2026-09",
		openingBalance: 0,
		revision: 1,
		schedules: [
			{
				effectiveMonth: "2026-09",
				name: "Insurance",
				targetAmount: 60000,
				targetMonth: "2026-11",
				intervalMonths: 6,
				createdAt: 1,
			},
		],
	};
}

test("funds catch up for the first bill and fund each later cycle, even before a bill posts", () => {
	const fund = repeating();
	const credits: FundContribution[] = [];
	for (const month of ["2026-09", "2026-10", "2026-11"]) {
		assert.equal(fundForMonth(fund, month, credits, [])?.required, 20000);
		credits.push({ fundId: fund._id, month, amount: 20000 });
		assert.equal(fundForMonth(fund, month, credits, [])?.required, 20000);
	}
	const paid = [{ fundId: fund._id, month: "2026-11", amount: 60000 }];
	assert.equal(fundForMonth(fund, "2026-12", credits, paid)?.required, 10000);
	assert.equal(fundForMonth(fund, "2026-12", credits, paid)?.balance, 0);
	assert.equal(fundForMonth(fund, "2026-12", credits, [])?.required, 10000);
	assert.equal(fundForMonth(fund, "2026-12", credits, [])?.balance, 60000);
	assert.equal(
		fundForMonth(fund, "2026-12", credits, paid)?.targetMonth,
		"2027-05",
	);
	assert.equal(
		fundForMonth(fund, "2026-12", credits, [{ ...paid[0], amount: 70000 }])
			?.required,
		11667,
	);
});

test("missed budgets require catch-up; future budgets and payments cannot fund earlier months", () => {
	const fund = repeating();
	assert.equal(fundForMonth(fund, "2026-10", [], [])?.required, 30000);
	assert.equal(fundForMonth(fund, "2026-11", [], [])?.required, 60000);
	assert.equal(fundForMonth(fund, "2026-08", [], []), null);
	const future = [{ fundId: fund._id, month: "2027-01", amount: 60000 }];
	assert.equal(fundForMonth(fund, "2026-09", future, future)?.required, 20000);
	assert.equal(fundForMonth(fund, "2026-09", future, future)?.balance, 0);
});

test("cent rounding reaches the goal exactly and a purchased one-time goal stays funded", () => {
	const fund = repeating();
	delete fund.schedules[0].intervalMonths;
	fund.schedules[0].targetAmount = 10000;
	const credits: FundContribution[] = [];
	for (const [month, amount] of [
		["2026-09", 3334],
		["2026-10", 3333],
		["2026-11", 3333],
	] as const) {
		assert.equal(fundForMonth(fund, month, credits, [])?.required, amount);
		credits.push({ fundId: fund._id, month, amount });
	}
	const payments = [{ fundId: fund._id, month: "2026-11", amount: 10000 }];
	assert.equal(fundForMonth(fund, "2026-12", credits, payments)?.required, 0);
	assert.equal(
		fundForMonth(fund, "2026-12", credits, payments)?.complete,
		true,
	);
	assert.equal(fundForMonth(fund, "2026-12", credits, payments)?.balance, 0);
});

test("monthly goals use opening balances, cap the last contribution, and restore refunds", () => {
	const fund = repeating();
	fund.openingBalance = 95000;
	fund.schedules = [
		{
			effectiveMonth: fund.startMonth,
			name: "Vehicle",
			targetAmount: 100000,
			monthlyAmount: 20000,
			createdAt: 1,
		},
	];
	assert.equal(fundForMonth(fund, "2026-09", [], [])?.required, 5000);
	const credits = [{ fundId: fund._id, month: "2026-09", amount: 5000 }];
	const payments = [
		{ fundId: fund._id, month: "2026-09", amount: 110000 },
		{ fundId: fund._id, month: "2026-10", amount: -20000 },
	];
	assert.equal(
		fundForMonth(fund, "2026-09", credits, payments)?.balance,
		-10000,
	);
	assert.equal(
		fundForMonth(fund, "2026-10", credits, payments)?.balance,
		10000,
	);
	assert.equal(fundForMonth(fund, "2026-10", credits, payments)?.required, 0);
});

test("fund edits keep past requirements and do not count earlier recurring payments twice", () => {
	const fund = repeating();
	const credits = ["2026-09", "2026-10", "2026-11"].map((month) => ({
		fundId: fund._id,
		month,
		amount: 20000,
	}));
	fund.schedules.push({
		...fund.schedules[0],
		effectiveMonth: "2026-12",
		targetMonth: "2027-05",
		name: "Car insurance",
		createdAt: 2,
	});
	assert.equal(fundForMonth(fund, "2026-10", credits, [])?.name, "Insurance");
	assert.equal(fundForMonth(fund, "2026-12", credits, [])?.required, 10000);
	fund.schedules.push({
		...fund.schedules[1],
		targetAmount: 72000,
		createdAt: 3,
	});
	assert.equal(fundForMonth(fund, "2026-12", credits, [])?.required, 12000);
	assert.equal(fundForMonth(fund, "2026-10", credits, [])?.required, 20000);
});

test("fund validation rejects unsafe amounts, bad dates, invalid intervals, and ambiguous goals", () => {
	const schedule = repeating().schedules[0];
	validateFundSchedule(schedule, "2026-09");
	for (const change of [
		{ targetAmount: 0 },
		{ targetAmount: -1 },
		{ targetAmount: 0.5 },
		{ targetAmount: Number.MAX_SAFE_INTEGER + 1 },
		{ name: " " },
		{ targetMonth: "2026-08" },
		{ targetMonth: "2026-13" },
		{ intervalMonths: 1 },
		{ intervalMonths: 2.5 },
		{ intervalMonths: 121 },
		{ monthlyAmount: 100 },
	])
		assert.throws(() =>
			validateFundSchedule({ ...schedule, ...change }, "2026-09"),
		);
	assert.throws(() =>
		validateFundSchedule({ ...schedule, targetMonth: undefined }, "2026-09"),
	);
	assert.throws(() =>
		validateFundSchedule(
			{ ...schedule, intervalMonths: undefined, targetMonth: undefined },
			"2026-09",
		),
	);
	assert.throws(() => validateFundSchedule(schedule, "0000-01"));
});
