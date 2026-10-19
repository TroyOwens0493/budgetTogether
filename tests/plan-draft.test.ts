import assert from "node:assert/strict";
import test from "node:test";
import { type Plan, planBalance } from "../src/domain/budget.ts";
import {
	createPlanDraft,
	evaluatePlanDraft,
} from "../src/domain/plan-draft.ts";

const categories = [{ _id: "food" }, { _id: "rent" }];
const plan: Plan & { revision: number } = {
	expectedIncome: 10000,
	savingsTarget: 1000,
	limits: [
		{ categoryId: "food", amount: 2000 },
		{ categoryId: "rent", amount: 7000 },
	],
	revision: 3,
};
const context = {
	fundedByShared: false,
	funds: { incoming: 0, outgoing: 0, carry: 0 },
	revision: 3,
};

test("loading a plan creates exact editable strings for current categories", () => {
	assert.deepEqual(createPlanDraft(plan, categories), {
		expectedIncome: "100.00",
		savingsTarget: "10.00",
		limits: { food: "20.00", rent: "70.00" },
		revision: 3,
	});
	assert.deepEqual(createPlanDraft(null, [{ _id: "new" }]), {
		expectedIncome: "0.00",
		savingsTarget: "0.00",
		limits: { new: "0.00" },
		revision: 0,
	});
});

test("summary and save payload use the same parsed cents and domain balance", () => {
	const draft = createPlanDraft(plan, categories);
	draft.expectedIncome = " 100.0 ";
	const result = evaluatePlanDraft(draft, categories, context);
	assert.deepEqual(result.plan, {
		expectedIncome: plan.expectedIncome,
		savingsTarget: plan.savingsTarget,
		limits: plan.limits,
	});
	assert.equal(result.balance, planBalance(plan));
	assert.equal(result.total, 9000);
	assert.equal(result.available, 10000);
	assert.equal(result.error, "");
	assert.equal(result.canSave, true);
});

test("partial, malformed, negative, and unsafe money blocks save without old totals", () => {
	for (const value of [
		"",
		"-",
		".",
		"20.",
		"abc",
		"NaN",
		"Infinity",
		"1e2",
		"1,000",
		"20.001",
		"-0.01",
		"90071992547409.92",
	]) {
		for (const field of ["expectedIncome", "savingsTarget", "food"] as const) {
			const draft = createPlanDraft(plan, categories);
			if (field === "food") draft.limits.food = value;
			else draft[field] = value;
			const snapshot = structuredClone(draft);
			const result = evaluatePlanDraft(draft, categories, context);
			assert.equal(result.plan, null, `${field}: ${value}`);
			assert.equal(result.balance, null);
			assert.equal(result.canSave, false);
			assert.ok(result.error);
			if (field === "food") assert.equal(result.total, null);
			else assert.equal(result[field], null);
			assert.deepEqual(draft, snapshot);
			for (const amount of [result.total, result.available, result.balance])
				assert.ok(amount === null || Number.isSafeInteger(amount));
		}
	}
});

test("fixing a partial input restores balance from the new string", () => {
	const draft = createPlanDraft(plan, categories);
	draft.limits.food = "20.";
	assert.equal(evaluatePlanDraft(draft, categories, context).balance, null);
	draft.limits.food = "19.99";
	const result = evaluatePlanDraft(draft, categories, context);
	assert.equal(result.total, 8999);
	assert.equal(result.balance, 1);
	assert.equal(result.canSave, false);
	draft.savingsTarget = "10.01";
	assert.equal(evaluatePlanDraft(draft, categories, context).canSave, true);
});

test("new categories start at zero and accept edits without NaN", () => {
	const draft = createPlanDraft(plan, categories);
	const current = [...categories, { _id: "new" }];
	let result = evaluatePlanDraft(draft, current, context);
	assert.equal(result.total, 9000);
	assert.equal(result.canSave, true);
	assert.deepEqual(result.plan?.limits.at(-1), {
		categoryId: "new",
		amount: 0,
	});
	draft.limits.new = "1.00";
	result = evaluatePlanDraft(draft, current, context);
	assert.equal(result.total, 9100);
	assert.equal(result.balance, -100);
	assert.equal(result.canSave, false);
	draft.limits.new = "1.";
	assert.equal(evaluatePlanDraft(draft, current, context).balance, null);
});

test("deleted categories cannot affect totals, validation, or save payload", () => {
	const draft = createPlanDraft(plan, categories);
	for (const removedValue of ["20.00", "bad"]) {
		draft.limits.food = removedValue;
		const result = evaluatePlanDraft(draft, [{ _id: "rent" }], context);
		assert.equal(result.total, 7000);
		assert.equal(result.balance, 2000);
		assert.equal(result.canSave, false);
		assert.deepEqual(result.plan?.limits, [
			{ categoryId: "rent", amount: 7000 },
		]);
	}
	draft.savingsTarget = "30.00";
	assert.equal(
		evaluatePlanDraft(draft, [{ _id: "rent" }], context).canSave,
		true,
	);
});

test("remote revisions preserve dirty strings and block a balanced stale save", () => {
	const draft = createPlanDraft(plan, categories);
	draft.limits.food = "19.99";
	draft.savingsTarget = "10.01";
	const snapshot = structuredClone(draft);
	const remote = { ...context, revision: 4 };
	const result = evaluatePlanDraft(draft, categories, remote);
	assert.equal(result.balance, 0);
	assert.equal(result.stale, true);
	assert.equal(result.canSave, false);
	assert.deepEqual(draft, snapshot);

	const currentPlan = { ...plan, expectedIncome: 11000, revision: 4 };
	const loaded = createPlanDraft(currentPlan, categories);
	assert.equal(loaded.expectedIncome, "110.00");
	assert.equal(loaded.savingsTarget, "10.00");
	assert.equal(loaded.limits.food, "20.00");
	assert.equal(loaded.revision, 4);
	assert.equal(evaluatePlanDraft(loaded, categories, remote).stale, false);
});

test("successful save revisions permit another save before and after subscription updates", () => {
	const draft = { ...createPlanDraft(plan, categories), revision: 4 };
	assert.equal(evaluatePlanDraft(draft, categories, context).canSave, true);
	assert.equal(
		evaluatePlanDraft(draft, categories, { ...context, revision: 4 }).canSave,
		true,
	);
	assert.equal(
		evaluatePlanDraft(draft, categories, { ...context, revision: 5 }).canSave,
		false,
	);
});

test("shared personal funding ignores hidden income and follows funding changes", () => {
	const draft = createPlanDraft(plan, categories);
	draft.expectedIncome = "invalid";
	const personal = {
		...context,
		fundedByShared: true,
		funds: { incoming: 9500, carry: 1000, outgoing: 500 },
	};
	const result = evaluatePlanDraft(draft, categories, personal);
	assert.equal(result.expectedIncome, 0);
	assert.equal(result.plan?.expectedIncome, 0);
	assert.equal(result.available, 10500);
	assert.equal(result.balance, 0);
	assert.equal(result.canSave, true);
	assert.equal(
		result.balance,
		planBalance({ ...plan, expectedIncome: 0 }, 9500, 500, 1000),
	);
	const changed = evaluatePlanDraft(draft, categories, {
		...personal,
		funds: { ...personal.funds, incoming: 9000 },
	});
	assert.equal(changed.balance, -500);
	assert.equal(changed.canSave, false);
	assert.equal(evaluatePlanDraft(draft, categories, context).balance, null);
});

test("unsafe totals and invalid funding never enable a save", () => {
	const draft = createPlanDraft(plan, categories);
	draft.limits.food = "90071992547409.91";
	draft.limits.rent = "90071992547409.91";
	assert.equal(evaluatePlanDraft(draft, categories, context).total, null);
	assert.equal(evaluatePlanDraft(draft, categories, context).canSave, false);

	for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
		for (const key of ["incoming", "outgoing", "carry"] as const) {
			const result = evaluatePlanDraft(
				createPlanDraft(plan, categories),
				categories,
				{
					...context,
					funds: { ...context.funds, [key]: value },
				},
			);
			assert.equal(result.balance, null);
			assert.equal(result.canSave, false);
		}
	}
});
