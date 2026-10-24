import assert from "node:assert/strict";
import test from "node:test";
import { parseTransactionAmounts } from "../src/domain/transaction-input.ts";

test("purchase splits keep their fund link and income discards it", () => {
	const splits = [
		{ categoryId: "insurance", fundId: "fund-1", amount: "1.00" },
	];
	assert.deepEqual(
		parseTransactionAmounts("purchase", "12.34", splits).data?.splits,
		[{ categoryId: "insurance", fundId: "fund-1", amount: 1234 }],
	);
	assert.deepEqual(
		parseTransactionAmounts("income", "-12.34", splits).data?.splits,
		[],
	);
});

test("a single category uses the full purchase or refund amount", () => {
	for (const value of ["12.34", "-12.34", "0.00"]) {
		const result = parseTransactionAmounts("purchase", value, [
			{ categoryId: "groceries", amount: "0.00" },
		]);
		assert.equal(result.error, null);
		assert.equal(result.data?.splits[0].amount, result.data?.amount);
	}
});

test("multiple categories require matching totals and signs", () => {
	const splits = [
		{ categoryId: "groceries", amount: "10.00" },
		{ categoryId: "housing", amount: "2.34" },
	];
	assert.deepEqual(parseTransactionAmounts("purchase", "12.34", splits).data, {
		amount: 1234,
		splits: [
			{ categoryId: "groceries", amount: 1000 },
			{ categoryId: "housing", amount: 234 },
		],
	});
	assert.ok(parseTransactionAmounts("purchase", "12.35", splits).error);
	assert.ok(parseTransactionAmounts("purchase", "-12.34", splits).error);
	assert.ok(
		parseTransactionAmounts("purchase", "12.34", [
			{ categoryId: "groceries", amount: "15.00" },
			{ categoryId: "housing", amount: "-2.66" },
		]).error,
	);
	assert.equal(
		parseTransactionAmounts(
			"purchase",
			"-12.34",
			splits.map((split) => ({ ...split, amount: `-${split.amount}` })),
		).error,
		null,
	);
});

test("invalid amounts and missing categories cannot be submitted", () => {
	for (const value of ["", "abc", "1.234", "9007199254740992"]) {
		assert.ok(parseTransactionAmounts("income", value, []).error);
	}
	assert.ok(parseTransactionAmounts("purchase", "1.00", []).error);
	assert.ok(
		parseTransactionAmounts("purchase", "1.00", [
			{ categoryId: "", amount: "1.00" },
		]).error,
	);
	assert.ok(
		parseTransactionAmounts("purchase", "1.00", [
			{ categoryId: "groceries", amount: "0.999" },
			{ categoryId: "housing", amount: "0.001" },
		]).error,
	);
});

test("income and transfers ignore unused category splits", () => {
	for (const kind of ["income", "transfer"] as const) {
		assert.deepEqual(
			parseTransactionAmounts(kind, "-12.34", [
				{ categoryId: "", amount: "invalid" },
			]).data,
			{ amount: -1234, splits: [] },
		);
	}
});
