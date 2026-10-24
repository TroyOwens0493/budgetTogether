import { ConvexError } from "convex/values";
import {
	assertRevision,
	isPlanSaved,
	money,
	month,
	nextMonth,
	planBalance,
} from "../../src/domain/budget";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { access } from "../access";
import { funding, results } from "./accounting";
import { summary as fundSummary, sameAllocations } from "./funds";
import { sharedForPersonal } from "./personalFunding";

type MonthArgs = { spaceId: Id<"spaces">; month: string };

export async function save(
	ctx: MutationCtx,
	args: MonthArgs & {
		expectedIncome: number;
		savingsTarget: number;
		limits: Doc<"plans">["limits"];
		revision: number;
		fundSignature?: string;
	},
) {
	const { space } = await access(ctx, args.spaceId, true);
	month(args.month);
	if (
		(await sharedForPersonal(ctx, space, args.month)) &&
		args.expectedIncome !== 0
	)
		throw new ConvexError(
			"Enter planned income in the shared budget. Personal funding comes from its allocation.",
		);
	const old = await ctx.db
		.query("plans")
		.withIndex("by_month", (q) =>
			q.eq("spaceId", args.spaceId).eq("month", args.month),
		)
		.unique();
	assertRevision(old?.revision ?? 0, args.revision);
	for (const limit of args.limits) {
		if (limit.fundId)
			throw new ConvexError(
				"Set fund amounts in Funds, not in spending limits.",
			);
		const category = await ctx.db.get(limit.categoryId);
		if (category?.spaceId !== args.spaceId)
			throw new ConvexError("Every category must belong to this budget.");
	}
	const funds = await funding(ctx, args.spaceId, args.month);
	const fundPlan = await fundSummary(ctx, args);
	if (fundPlan.items.length && args.fundSignature !== fundPlan.signature)
		throw new ConvexError(
			"Fund amounts changed. Check the Funds row, then save the budget again.",
		);
	for (const source of new Set(funds.allocations.map((x) => x.sourceMonth))) {
		const sourceResult = await results(ctx, args.spaceId, source);
		const sourcePlan = await ctx.db
			.query("plans")
			.withIndex("by_month", (q) =>
				q.eq("spaceId", args.spaceId).eq("month", source),
			)
			.unique();
		const allocated = await ctx.db
			.query("carry")
			.withIndex("by_source", (q) =>
				q.eq("spaceId", args.spaceId).eq("sourceMonth", source),
			)
			.collect();
		if (
			allocated.reduce((sum, x) => sum + x.amount, 0) >
			Math.max(
				0,
				sourceResult.unreservedSavings - (sourcePlan?.savingsTarget ?? 0),
			)
		)
			throw new ConvexError(
				`Carry-forward from ${source} is invalid. Reopen its review.`,
			);
	}
	const balance = planBalance(
		args,
		funds.incoming,
		funds.outgoing,
		funds.carry,
		fundPlan.total,
	);
	if (balance !== 0)
		throw new ConvexError(
			`The plan must balance. ${balance} cents remain to allocate.`,
		);
	const value = {
		spaceId: args.spaceId,
		month: args.month,
		expectedIncome: args.expectedIncome,
		savingsTarget: args.savingsTarget,
		limits: args.limits,
		fundAllocations: fundPlan.allocations,
		saved: true,
		reviewed: false,
		revision: (old?.revision ?? 0) + 1,
	};
	if (old) await ctx.db.patch(old._id, { ...value, status: undefined });
	else await ctx.db.insert("plans", value);
}

export async function repeat(ctx: MutationCtx, args: MonthArgs) {
	const { space } = await access(ctx, args.spaceId, true);
	month(args.month);
	const destination = nextMonth(args.month);
	const old = await ctx.db
		.query("plans")
		.withIndex("by_month", (q) =>
			q.eq("spaceId", args.spaceId).eq("month", args.month),
		)
		.unique();
	if (!old) throw new ConvexError("Save this month first.");
	const existing = await ctx.db
		.query("plans")
		.withIndex("by_month", (q) =>
			q.eq("spaceId", args.spaceId).eq("month", destination),
		)
		.unique();
	if (existing) throw new ConvexError("The next month already has a plan.");
	await ctx.db.insert("plans", {
		spaceId: args.spaceId,
		month: destination,
		expectedIncome: (await sharedForPersonal(ctx, space, destination))
			? 0
			: old.expectedIncome,
		savingsTarget: old.savingsTarget,
		limits: old.limits,
		saved: false,
		reviewed: false,
		revision: 1,
	});
}

export async function review(
	ctx: MutationCtx,
	args: MonthArgs & {
		allocations: { categoryId?: Id<"categories">; amount: number }[];
		revision: number;
	},
) {
	const { space } = await access(ctx, args.spaceId, true);
	month(args.month);
	const plan = await ctx.db
		.query("plans")
		.withIndex("by_month", (q) =>
			q.eq("spaceId", args.spaceId).eq("month", args.month),
		)
		.unique();
	if (
		!plan ||
		!isPlanSaved(plan) ||
		((await sharedForPersonal(ctx, space, args.month)) &&
			plan.expectedIncome !== 0)
	)
		throw new ConvexError(
			"Save this month’s budget before completing its review.",
		);
	assertRevision(plan.revision, args.revision);
	const result = await results(ctx, args.spaceId, args.month);
	if (!sameAllocations(plan.fundAllocations, result.fundPlan.allocations))
		throw new ConvexError(
			"Fund amounts changed. Save this month's budget before completing its review.",
		);
	const amount = args.allocations.reduce(
		(s, x) => s + money(x.amount, true),
		0,
	);
	if (amount > Math.max(0, result.unreservedSavings - plan.savingsTarget))
		throw new ConvexError(
			"Carry-forward exceeds this month’s savings above target.",
		);
	for (const x of args.allocations)
		if (
			x.categoryId &&
			(await ctx.db.get(x.categoryId))?.spaceId !== args.spaceId
		)
			throw new ConvexError("Choose categories from this budget.");
	const destinationMonth = nextMonth(args.month);
	const destination = await ctx.db
		.query("plans")
		.withIndex("by_month", (q) =>
			q.eq("spaceId", args.spaceId).eq("month", destinationMonth),
		)
		.unique();
	const previous = await ctx.db
		.query("carry")
		.withIndex("by_source", (q) =>
			q.eq("spaceId", args.spaceId).eq("sourceMonth", args.month),
		)
		.collect();
	const base = destination ?? {
		expectedIncome: plan.expectedIncome,
		savingsTarget: plan.savingsTarget,
		limits: plan.limits,
		revision: 0,
	};
	let savingsTarget = base.savingsTarget;
	const limits = new Map<Id<"categories">, number>(
		base.limits.map((x) => [x.categoryId, x.amount]),
	);
	for (const x of previous) {
		if (x.categoryId)
			limits.set(x.categoryId, (limits.get(x.categoryId) ?? 0) - x.amount);
		else savingsTarget -= x.amount;
	}
	for (const x of args.allocations) {
		if (x.categoryId)
			limits.set(x.categoryId, (limits.get(x.categoryId) ?? 0) + x.amount);
		else savingsTarget += x.amount;
	}
	if (savingsTarget < 0 || [...limits.values()].some((x) => x < 0))
		throw new ConvexError(
			"The next month’s limits were changed. Increase them before removing its reserved funding.",
		);
	const next = {
		spaceId: args.spaceId,
		month: destinationMonth,
		expectedIncome: (await sharedForPersonal(ctx, space, destinationMonth))
			? 0
			: base.expectedIncome,
		savingsTarget,
		limits: [...limits].map(([categoryId, amount]) => ({
			categoryId,
			amount,
		})),
		saved: isPlanSaved(destination),
		reviewed: false,
		revision: base.revision + 1,
	};
	if (destination)
		await ctx.db.patch(destination._id, { ...next, status: undefined });
	else await ctx.db.insert("plans", next);
	for (const old of previous) await ctx.db.delete(old._id);
	for (const x of args.allocations)
		if (x.amount > 0)
			await ctx.db.insert("carry", {
				spaceId: args.spaceId,
				sourceMonth: args.month,
				destinationMonth,
				...x,
			});
	await ctx.db.patch(plan._id, {
		reviewed: true,
		revision: plan.revision + 1,
	});
}

export async function ensure(ctx: MutationCtx, args: MonthArgs) {
	const { space } = await access(ctx, args.spaceId, true);
	month(args.month);
	const existing = await ctx.db
		.query("plans")
		.withIndex("by_month", (q) =>
			q.eq("spaceId", args.spaceId).eq("month", args.month),
		)
		.unique();
	if (existing) return;
	const previous = await ctx.db
		.query("plans")
		.withIndex("by_month", (q) =>
			q.eq("spaceId", args.spaceId).lt("month", args.month),
		)
		.order("desc")
		.first();
	if (!previous) return;
	await ctx.db.insert("plans", {
		spaceId: args.spaceId,
		month: args.month,
		expectedIncome: (await sharedForPersonal(ctx, space, args.month))
			? 0
			: previous.expectedIncome,
		savingsTarget: previous.savingsTarget,
		limits: previous.limits,
		saved: false,
		reviewed: false,
		revision: 1,
	});
}
