import { ConvexError } from "convex/values";
import {
	isPlanSaved,
	leftovers,
	month,
	nextMonth,
	planBalance,
} from "../../src/domain/budget";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { access, readCutoff } from "../access";
import { results } from "./accounting";
import { sameAllocations } from "./funds";

export async function dashboard(
	ctx: QueryCtx,
	args: { spaceId: Id<"spaces">; month: string },
) {
	const cutoff = await readCutoff(ctx, args.spaceId);
	month(args.month);
	const result = await results(ctx, args.spaceId, args.month);
	const plan = await ctx.db
		.query("plans")
		.withIndex("by_month", (q) =>
			q.eq("spaceId", args.spaceId).eq("month", args.month),
		)
		.filter((q) =>
			q.lte(
				q.field("_creationTime"),
				Number.isFinite(cutoff) ? cutoff : Number.MAX_SAFE_INTEGER,
			),
		)
		.unique();
	const categories = await ctx.db
		.query("categories")
		.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
		.filter((q) =>
			q.lte(
				q.field("_creationTime"),
				Number.isFinite(cutoff) ? cutoff : Number.MAX_SAFE_INTEGER,
			),
		)
		.collect();
	const reserved = await ctx.db
		.query("carry")
		.withIndex("by_source", (q) =>
			q.eq("spaceId", args.spaceId).eq("sourceMonth", args.month),
		)
		.filter((q) =>
			q.lte(
				q.field("_creationTime"),
				Number.isFinite(cutoff) ? cutoff : Number.MAX_SAFE_INTEGER,
			),
		)
		.collect();
	return {
		...result,
		plan: plan
			? {
					...plan,
					expectedIncome: result.fundedBy ? 0 : plan.expectedIncome,
					saved:
						isPlanSaved(plan) &&
						sameAllocations(
							plan.fundAllocations,
							result.fundPlan.allocations,
						) &&
						(!result.fundedBy || plan.expectedIncome === 0),
				}
			: null,
		categories: categories.sort((a, b) => a.order - b.order),
		reserved,
		available: leftovers(
			result.unreservedSavings,
			plan?.savingsTarget ?? 0,
			reserved.reduce((s, x) => s + x.amount, 0),
		),
		balance: plan
			? planBalance(
					{
						...plan,
						expectedIncome: result.fundedBy ? 0 : plan.expectedIncome,
					},
					result.funds.incoming,
					result.funds.outgoing,
					result.funds.carry,
					result.fundPlan.total,
				)
			: null,
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
