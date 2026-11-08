import {
	cents,
	money,
	type Plan,
	personalFundingRequired,
	planBalance,
} from "./budget";

export type PlanDraft = {
	expectedIncome: string;
	savingsTarget: string;
	limits: Record<string, string>;
	revision: number;
};

/** Loading current values is explicit, so remote revisions cannot erase edits. */
export function createPlanDraft(
	plan: (Plan & { revision: number }) | null,
	categories: readonly { _id: string }[],
): PlanDraft {
	return {
		expectedIncome: ((plan?.expectedIncome ?? 0) / 100).toFixed(2),
		savingsTarget: ((plan?.savingsTarget ?? 0) / 100).toFixed(2),
		limits: Object.fromEntries(
			categories.map((category) => [
				category._id,
				(
					(plan?.limits.find((limit) => limit.categoryId === category._id)
						?.amount ?? 0) / 100
				).toFixed(2),
			]),
		),
		revision: plan?.revision ?? 0,
	};
}

function parseAmount(value: string): number | null {
	try {
		return money(cents(value), true);
	} catch {
		return null;
	}
}

function checkedAmount(value: number): number | null {
	return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Summary and save payload always use the same current categories and funding. */
export function evaluatePlanDraft<CategoryId extends string>(
	draft: PlanDraft,
	categories: readonly { _id: CategoryId }[],
	context: {
		fundedByShared: boolean;
		funds: {
			incoming: number;
			outgoing: number;
			carry: number;
			automaticPersonalFunding?: boolean;
		};
		revision: number;
		fundAmount?: number;
	},
) {
	const expectedIncome = context.fundedByShared
		? 0
		: parseAmount(draft.expectedIncome);
	const savingsTarget = parseAmount(draft.savingsTarget);
	// New categories start at zero; deleted categories no longer affect the plan.
	const limits = categories.map((category) => ({
		categoryId: category._id,
		amount: parseAmount(draft.limits[category._id] ?? "0.00"),
	}));
	const total = limits.every((limit) => limit.amount !== null)
		? checkedAmount(limits.reduce((sum, limit) => sum + (limit.amount ?? 0), 0))
		: null;
	let incoming: number | null = context.funds.incoming;
	if (
		context.funds.automaticPersonalFunding &&
		savingsTarget !== null &&
		total !== null
	) {
		try {
			incoming = personalFundingRequired(
				{ savingsTarget, limits: [{ categoryId: "total", amount: total }] },
				context.fundAmount ?? 0,
				context.funds.carry,
			);
		} catch {
			incoming = null;
		}
	}
	const available =
		expectedIncome === null || incoming === null
			? null
			: checkedAmount(expectedIncome + incoming + context.funds.carry);
	let plan: {
		expectedIncome: number;
		savingsTarget: number;
		limits: { categoryId: CategoryId; amount: number }[];
	} | null = null;
	let balance: number | null = null;
	let error = "Check the amounts before saving your budget.";
	if (
		expectedIncome !== null &&
		savingsTarget !== null &&
		total !== null &&
		available !== null &&
		incoming !== null
	) {
		const parsed = {
			expectedIncome,
			savingsTarget,
			limits: limits.map((limit) => ({
				categoryId: limit.categoryId,
				amount: limit.amount ?? 0,
			})),
		};
		try {
			balance = planBalance(
				parsed,
				incoming,
				context.funds.outgoing,
				context.funds.carry,
				context.fundAmount ?? 0,
			);
			plan = parsed;
			error = "";
		} catch {
			// Invalid funding, duplicate categories, or unsafe totals cannot be saved.
		}
	}
	const stale = context.revision > draft.revision;
	return {
		plan,
		incoming,
		expectedIncome,
		savingsTarget,
		total,
		available,
		balance,
		error,
		stale,
		canSave: plan !== null && balance === 0 && !stale,
	};
}
