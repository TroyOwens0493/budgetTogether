import assert from "node:assert/strict";
import test from "node:test";
import {
	addMonths,
	forecastHorizon,
	historicalReturn,
	project,
} from "../src/domain/projections.ts";

test("a zero-return forecast counts each contribution once", () => {
	const points = project({
		cash: { balance: 100000, monthlyContribution: 30000, annualReturn: 0 },
		investments: [
			{
				id: "fund",
				balance: 200000,
				monthlyContribution: 20000,
				annualReturn: 0,
			},
		],
		months: 12,
	});
	assert.equal(points.length, 13);
	assert.deepEqual(points[12], {
		month: 12,
		cash: 460000,
		investments: 440000,
		total: 900000,
		contributions: 600000,
		growth: 0,
		assets: { fund: 440000 },
	});
});

test("effective annual returns compound to the stated annual rate", () => {
	const points = project({
		cash: { balance: 100000, monthlyContribution: 0, annualReturn: 4 },
		investments: [
			{ id: "gain", balance: 100000, monthlyContribution: 0, annualReturn: 10 },
			{
				id: "loss",
				balance: 100000,
				monthlyContribution: 0,
				annualReturn: -20,
			},
		],
		months: 12,
	});
	assert.equal(points[12].cash, 104000);
	assert.equal(points[12].assets.gain, 110000);
	assert.equal(points[12].assets.loss, 80000);
	assert.equal(points[12].growth, -6000);
});

test("end-of-month contributions earn no interest in their first month", () => {
	const points = project({
		cash: { balance: 0, monthlyContribution: 10000, annualReturn: 12 },
		investments: [],
		months: 12,
	});
	assert.equal(points[1].total, 10000);
	const monthlyRate = 1.12 ** (1 / 12) - 1;
	assert.equal(
		points[12].total,
		Math.round((10000 * ((1 + monthlyRate) ** 12 - 1)) / monthlyRate),
	);
});

test("invalid rates, cents, duplicate assets, horizons, and overflow fail clearly", () => {
	const valid = {
		cash: { balance: 0, monthlyContribution: 0, annualReturn: 0 },
		investments: [],
		months: 12,
	};
	for (const annualReturn of [-100, Infinity, NaN, 1001])
		assert.throws(() =>
			project({ ...valid, cash: { ...valid.cash, annualReturn } }),
		);
	for (const balance of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1])
		assert.throws(() =>
			project({ ...valid, cash: { ...valid.cash, balance } }),
		);
	for (const months of [0, 1.5, 1201])
		assert.throws(() => project({ ...valid, months }));
	const asset = { id: "fund", ...valid.cash };
	assert.throws(() => project({ ...valid, investments: [asset, asset] }));
	assert.throws(() =>
		project({
			...valid,
			cash: {
				balance: Number.MAX_SAFE_INTEGER,
				monthlyContribution: 1,
				annualReturn: 10,
			},
		}),
	);
});

test("historical growth uses compound return and reports actual observation dates", () => {
	const result = historicalReturn(
		[
			{ date: "2025-12-31", adjustedClose: 121 },
			{ date: "2023-12-31", adjustedClose: 100 },
			{ date: "2024-12-31", adjustedClose: 110 },
			{ date: "2026-12-31", adjustedClose: 200 },
		],
		10,
		"2026-10-24",
	);
	assert.equal(result.startDate, "2023-12-31");
	assert.equal(result.endDate, "2025-12-31");
	assert.ok(Math.abs(result.rate - 10) < 0.01);
	assert.ok(result.years < 10);
});

test("historical periods exclude future prices and use the requested anniversary", () => {
	const result = historicalReturn(
		[
			{ date: "2010-10-29", adjustedClose: 25 },
			{ date: "2015-09-30", adjustedClose: 50 },
			{ date: "2015-10-30", adjustedClose: 75 },
			{ date: "2025-10-31", adjustedClose: 100 },
		],
		10,
		"2025-11-01",
	);
	assert.equal(result.startDate, "2015-10-30");
	assert.ok(Math.abs(result.rate - ((100 / 75) ** 0.1 - 1) * 100) < 0.01);
});

test("missing, short, invalid, or duplicated historical data cannot imply a return", () => {
	assert.throws(() => historicalReturn([], 10, "2026-10-24"));
	const first = { date: "2025-12-31", adjustedClose: 100 };
	assert.throws(() => historicalReturn([first], 10, "2026-10-24"));
	assert.throws(() => historicalReturn([first, first], 10, "2026-10-24"));
	assert.throws(() =>
		historicalReturn([{ ...first, date: "2025-02-30" }], 10, "2026-10-24"),
	);
	assert.throws(() =>
		historicalReturn([{ ...first, adjustedClose: 0 }], 10, "2026-10-24"),
	);
});

test("age horizons and calendar months are bounded and preserve month-end dates", () => {
	assert.equal(forecastHorizon(33, 65), 384);
	for (const ages of [
		[33, 33],
		[33, 20],
		[1, 120],
		[-1, 65],
		[33.5, 65],
	])
		assert.throws(() => forecastHorizon(ages[0], ages[1]));
	assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
	assert.equal(addMonths("2028-01-31", 2), "2028-03-31");
});

test("bond coupons and face value move to cash once; market discount becomes growth", () => {
	const points = project({
		startsOn: "2026-01-01",
		months: 24,
		cash: { balance: 0, monthlyContribution: 0, annualReturn: 0 },
		investments: [
			{
				id: "bond",
				balance: 95000,
				monthlyContribution: 0,
				annualReturn: 0,
				fixedIncome: {
					kind: "bond",
					faceValue: 100000,
					couponRate: 6,
					paymentsPerYear: 2,
					nextPaymentDate: "2026-07-01",
					maturityDate: "2027-01-01",
				},
			},
		],
	});
	assert.equal(points[5].cash, 0);
	assert.equal(points[6].cash, 3000);
	assert.equal(points[6].investments, 95000);
	assert.equal(points[12].cash, 106000);
	assert.equal(points[12].investments, 0);
	assert.equal(points[12].growth, 11000);
	assert.equal(points[24].total, 106000);
});

test("CDs stop investment growth at maturity and cash earns the cash rate afterwards", () => {
	const points = project({
		startsOn: "2026-01-01",
		months: 24,
		cash: { balance: 0, monthlyContribution: 0, annualReturn: 2 },
		investments: [
			{
				id: "cd",
				balance: 100000,
				monthlyContribution: 0,
				annualReturn: 5,
				fixedIncome: { kind: "cd", maturityDate: "2027-01-01" },
			},
		],
	});
	assert.equal(points[11].cash, 0);
	assert.equal(points[12].cash, 105000);
	assert.equal(points[12].investments, 0);
	assert.equal(points[24].total, 107100);
});

test("zero-coupon bonds need no payment frequency and partial-month CDs stop on maturity", () => {
	const points = project({
		startsOn: "2026-01-01",
		months: 2,
		cash: { balance: 0, monthlyContribution: 0, annualReturn: 0 },
		investments: [
			{
				id: "zero",
				balance: 90000,
				monthlyContribution: 0,
				annualReturn: 0,
				fixedIncome: {
					kind: "bond",
					maturityDate: "2026-02-01",
					faceValue: 100000,
					couponRate: 0,
				},
			},
			{
				id: "cd",
				balance: 100000,
				monthlyContribution: 0,
				annualReturn: 12,
				fixedIncome: { kind: "cd", maturityDate: "2026-01-16" },
			},
		],
	});
	assert.equal(
		points[1].cash,
		100000 + Math.round(100000 * 1.12 ** (15 / 31 / 12)),
	);
	assert.equal(points[1].investments, 0);
	assert.equal(points[2].total, points[1].total);
});

test("missing bond terms, matured positions, and fixed-term contributions block a forecast", () => {
	const base = {
		startsOn: "2026-01-01",
		months: 12,
		cash: { balance: 0, monthlyContribution: 0, annualReturn: 0 },
		investments: [
			{
				id: "bond",
				balance: 100000,
				monthlyContribution: 0,
				annualReturn: 0,
				fixedIncome: {
					kind: "bond" as const,
					maturityDate: "2027-01-01",
					faceValue: 100000,
					couponRate: 5,
				},
			},
		],
	};
	assert.throws(() => project(base), /frequency/);
	assert.throws(
		() =>
			project({
				...base,
				investments: [
					{
						...base.investments[0],
						fixedIncome: {
							...base.investments[0].fixedIncome,
							couponRate: 0,
							maturityDate: "2025-01-01",
						},
					},
				],
			}),
		/matured/,
	);
	assert.throws(
		() =>
			project({
				...base,
				investments: [
					{
						...base.investments[0],
						monthlyContribution: 100,
						fixedIncome: { ...base.investments[0].fixedIncome, couponRate: 0 },
					},
				],
			}),
		/new holding/,
	);
});
