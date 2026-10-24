import { ConvexError } from "convex/values";
import {
	assertRevision,
	money,
	month,
	nextMonth,
} from "../../src/domain/budget";
import {
	type FundContribution,
	type FundPayment,
	type FundSchedule,
	fundForMonth,
	validateFundSchedule,
} from "../../src/domain/funds";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { access, readCutoff } from "../access";

type MonthArgs = { spaceId: Id<"spaces">; month: string };

/** The same calculation supplies the Funds tab, budget preview, and save check.
 * Future saved plans cannot fund an earlier month's goals. */
export async function summary(ctx: QueryCtx | MutationCtx, args: MonthArgs) {
	const cutoff = await readCutoff(ctx, args.spaceId);
	month(args.month);
	const all = await ctx.db
		.query("funds")
		.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
		.collect();
	const funds = all.filter(
		(row) =>
			row._creationTime <= cutoff &&
			row.startMonth <= args.month &&
			row.schedules.some((s) => s.createdAt <= cutoff),
	);
	if (!funds.length)
		return {
			items: [],
			allocations: [],
			total: 0,
			contributed: 0,
			reservedChange: 0,
			signature: "[]",
		};
	const plans = await ctx.db
		.query("plans")
		.withIndex("by_month", (q) =>
			q.eq("spaceId", args.spaceId).lt("month", nextMonth(args.month)),
		)
		.collect();
	const visibleFunds = new Set(funds.map((row) => row._id));
	const contributions: FundContribution[] = plans
		.filter((row) => row._creationTime <= cutoff)
		.flatMap((row) =>
			(row.fundAllocations ?? [])
				.filter((entry) => visibleFunds.has(entry.fundId))
				.map((entry) => ({
					...entry,
					month: row.month,
				})),
		);
	const transactions = await ctx.db
		.query("transactions")
		.withIndex("by_space_funded_date", (q) =>
			q
				.eq("spaceId", args.spaceId)
				.eq("funded", true)
				.lt("date", `${nextMonth(args.month)}-01`),
		)
		.collect();
	const payments: FundPayment[] = transactions
		.filter(
			(row) =>
				!row.removed &&
				!row.pending &&
				row.kind === "purchase" &&
				row._creationTime <= cutoff,
		)
		.flatMap((row) =>
			row.splits.flatMap((split) =>
				split.fundId
					? [
							{
								fundId: split.fundId,
								month: row.date.slice(0, 7),
								amount: split.amount,
							},
						]
					: [],
			),
		);
	const items = funds
		.flatMap((fund) => {
			const row = fundForMonth(
				{
					...fund,
					schedules: fund.schedules.filter((s) => s.createdAt <= cutoff),
				},
				args.month,
				contributions,
				payments,
			);
			return row ? [{ ...row, _id: fund._id }] : [];
		})
		.sort((a, b) => a.name.localeCompare(b.name));
	const allocations = items.map((row) => ({
		fundId: row._id,
		amount: row.required,
	}));
	return {
		items,
		allocations,
		total: money(
			items.reduce((sum, row) => sum + row.required, 0),
			true,
		),
		contributed: money(
			contributions
				.filter((row) => row.month === args.month)
				.reduce((sum, row) => sum + row.amount, 0),
			true,
		),
		// Only positive reserved balances protect money from reuse. An
		// overdrawn fund cannot release money that was never reserved.
		reservedChange: money(
			items.reduce(
				(sum, row) =>
					sum + Math.max(0, row.balance) - Math.max(0, row.balanceBeforeMonth),
				0,
			),
		),
		// Include balances before this month's credit. A repeat save has the
		// same signature; a fund edit or a change in earlier funding does not.
		signature: JSON.stringify(
			items.map((row) => [row._id, row.revision, row.required]),
		),
	};
}

export async function save(
	ctx: MutationCtx,
	args: {
		spaceId: Id<"spaces">;
		id?: Id<"funds">;
		startMonth: string;
		openingBalance: number;
		name: string;
		targetAmount: number;
		targetMonth?: string;
		intervalMonths?: number;
		monthlyAmount?: number;
		effectiveMonth: string;
		revision: number;
	},
) {
	await access(ctx, args.spaceId, true);
	money(args.openingBalance, true);
	const old = args.id ? await ctx.db.get(args.id) : null;
	if (args.id && (!old || old.spaceId !== args.spaceId))
		throw new ConvexError("Fund not found in this budget.");
	assertRevision(old?.revision ?? 0, args.revision);
	if (
		old &&
		(old.startMonth !== args.startMonth ||
			old.openingBalance !== args.openingBalance)
	)
		throw new ConvexError(
			"The start month and opening balance cannot change after a fund is created.",
		);
	if (
		old &&
		Boolean(old.schedules[0].intervalMonths) !==
			(args.intervalMonths !== undefined)
	)
		throw new ConvexError(
			"A repeating payment cannot change into a savings goal. Create a separate fund.",
		);
	const schedule: FundSchedule = {
		effectiveMonth: args.effectiveMonth,
		name: args.name.trim(),
		targetAmount: args.targetAmount,
		...(args.targetMonth ? { targetMonth: args.targetMonth } : {}),
		...(args.intervalMonths !== undefined
			? { intervalMonths: args.intervalMonths }
			: {}),
		...(args.monthlyAmount !== undefined
			? { monthlyAmount: args.monthlyAmount }
			: {}),
		createdAt: Date.now(),
	};
	validateFundSchedule(schedule, args.startMonth);
	if (!old && args.effectiveMonth !== args.startMonth)
		throw new ConvexError(
			"A new fund must start in its first contribution month.",
		);
	const schedules = [...(old?.schedules ?? []), schedule];
	if (old) {
		await ctx.db.patch(old._id, { schedules, revision: old.revision + 1 });
		return old._id;
	}
	return ctx.db.insert("funds", {
		spaceId: args.spaceId,
		startMonth: args.startMonth,
		openingBalance: args.openingBalance,
		schedules,
		revision: 1,
	});
}

export function sameAllocations(
	a: Doc<"plans">["fundAllocations"],
	b: Doc<"plans">["fundAllocations"],
) {
	const amounts = new Map(
		(a ?? []).filter((x) => x.amount !== 0).map((x) => [x.fundId, x.amount]),
	);
	const next = (b ?? []).filter((x) => x.amount !== 0);
	return (
		amounts.size === next.length &&
		next.every((x) => amounts.get(x.fundId) === x.amount)
	);
}

export async function validatePayments(
	ctx: MutationCtx,
	spaceId: Id<"spaces">,
	date: string,
	splits: Doc<"transactions">["splits"],
) {
	for (const fundId of new Set(
		splits.flatMap((row) => (row.fundId ? [row.fundId] : [])),
	)) {
		const fund = await ctx.db.get(fundId);
		if (!fund || fund.spaceId !== spaceId)
			throw new ConvexError("Choose a fund from this budget.");
		if (date.slice(0, 7) < fund.startMonth)
			throw new ConvexError(
				"The payment cannot be before the fund's start month.",
			);
	}
}
