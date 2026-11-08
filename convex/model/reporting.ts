import { ConvexError } from "convex/values";
import {
	isPlanSaved,
	leftovers,
	month,
	nextMonth,
	planBalance,
} from "../../src/domain/budget";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { access } from "../access";
import { type funding, results } from "./accounting";
import { type summary as fundSummary, sameAllocations } from "./funds";

export async function dashboard(
	ctx: QueryCtx,
	args: { spaceId: Id<"spaces">; month: string },
) {
	await access(ctx, args.spaceId);
	month(args.month);
	const result = await results(ctx, args.spaceId, args.month);
	const plan = await ctx.db
		.query("plans")
		.withIndex("by_month", (q) =>
			q.eq("spaceId", args.spaceId).eq("month", args.month),
		)
		.unique();
	const categories = await ctx.db
		.query("categories")
		.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
		.collect();
	const reserved = await ctx.db
		.query("carry")
		.withIndex("by_source", (q) =>
			q.eq("spaceId", args.spaceId).eq("sourceMonth", args.month),
		)
		.collect();
	const state = planState(plan, result.fundedBy, result.funds, result.fundPlan);
	return {
		...result,
		balance: state.balance,
		plan: state.plan,
		categories: categories.sort((a, b) => a.order - b.order),
		reserved,
		available: leftovers(
			result.unreservedSavings,
			plan?.savingsTarget ?? 0,
			reserved.reduce((s, x) => s + x.amount, 0),
		),
	};
}

export async function list(
	ctx: QueryCtx,
	args: { spaceId: Id<"spaces">; from: string; to: string },
) {
	await access(ctx, args.spaceId);
	month(args.from);
	month(args.to);
	const rows = [];
	for (let m = args.from; m <= args.to; m = nextMonth(m)) {
		if (rows.length >= 24) throw new ConvexError("Select at most 24 months.");
		const result = await results(ctx, args.spaceId, m);
		rows.push({
			month: m,
			income: result.income,
			spending: result.spending,
			savings: result.savings,
			categories: result.spendingCategories,
		});
	}
	return rows;
}

/** Dashboard and forecasts use the same current funding and saved-plan checks. */
export function planState(
	plan: Doc<"plans"> | null,
	fundedBy: Id<"spaces"> | null,
	funds: Awaited<ReturnType<typeof funding>>,
	fundPlan: Awaited<ReturnType<typeof fundSummary>>,
) {
	const balance = plan
		? planBalance(
				{
					...plan,
					expectedIncome: fundedBy ? 0 : plan.expectedIncome,
				},
				funds.incoming,
				funds.outgoing,
				funds.carry,
				fundPlan.total,
			)
		: null;
	return {
		balance,
		plan: plan
			? {
					...plan,
					expectedIncome: fundedBy ? 0 : plan.expectedIncome,
					saved:
						isPlanSaved(plan) &&
						balance === 0 &&
						sameAllocations(plan.fundAllocations, fundPlan.allocations) &&
						(!fundedBy || plan.expectedIncome === 0),
				}
			: null,
	};
}
