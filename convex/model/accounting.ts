import { nextMonth, totals } from "../../src/domain/budget";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { access, readCutoff } from "../access";
import { summary as fundSummary } from "./funds";
import { recipients, sharedForPersonal } from "./personalFunding";

export async function funding(
	ctx: QueryCtx | MutationCtx,
	spaceId: Id<"spaces">,
	m: string,
) {
	const cutoff = await readCutoff(ctx, spaceId);
	let outgoing = await ctx.db
		.query("contributions")
		.withIndex("by_private", (q) => q.eq("privateId", spaceId).eq("month", m))
		.filter((q) =>
			q.lte(
				q.field("_creationTime"),
				Number.isFinite(cutoff) ? cutoff : Number.MAX_SAFE_INTEGER,
			),
		)
		.collect();
	let incoming = await ctx.db
		.query("contributions")
		.withIndex("by_shared", (q) => q.eq("sharedId", spaceId).eq("month", m))
		.filter((q) =>
			q.lte(
				q.field("_creationTime"),
				Number.isFinite(cutoff) ? cutoff : Number.MAX_SAFE_INTEGER,
			),
		)
		.collect();
	async function historicalContributions(rows: Doc<"contributions">[]) {
		const historical = [];
		for (const row of rows) {
			const personal = await ctx.db.get(row.privateId);
			if (
				!personal ||
				(await sharedForPersonal(ctx, personal, m)) !== row.sharedId
			)
				historical.push(row);
		}
		return historical;
	}
	outgoing = await historicalContributions(outgoing);
	incoming = await historicalContributions(incoming);
	const carry = await ctx.db
		.query("carry")
		.withIndex("by_destination", (q) =>
			q.eq("spaceId", spaceId).eq("destinationMonth", m),
		)
		.filter((q) =>
			q.lte(
				q.field("_creationTime"),
				Number.isFinite(cutoff) ? cutoff : Number.MAX_SAFE_INTEGER,
			),
		)
		.collect();
	async function actual(rows: Doc<"contributions">[]) {
		let value = 0;
		for (const contribution of rows)
			for (const pair of contribution.pairs) {
				const out = await ctx.db.get(pair.outId);
				const incoming = await ctx.db.get(pair.inId);
				if (
					out &&
					incoming &&
					!out.removed &&
					!incoming.removed &&
					!out.pending &&
					!incoming.pending &&
					out.kind === "transfer" &&
					incoming.kind === "transfer" &&
					out.amount === pair.amount &&
					incoming.amount === -pair.amount &&
					out.date.slice(0, 7) === m &&
					incoming.date.slice(0, 7) === m &&
					out._creationTime <= cutoff &&
					incoming._creationTime <= cutoff
				)
					value += pair.amount;
			}
		return value;
	}
	const personalIncoming = await ctx.db
		.query("personalAllocations")
		.withIndex("by_private", (q) => q.eq("privateId", spaceId).eq("month", m))
		.collect();
	const personalOutgoing = await ctx.db
		.query("personalAllocations")
		.withIndex("by_shared", (q) => q.eq("sharedId", spaceId).eq("month", m))
		.collect();
	const allocatedIn = personalIncoming
		.filter((x) => x._creationTime <= cutoff)
		.reduce((sum, x) => sum + x.amount, 0);
	const allocatedOut = personalOutgoing
		.filter((x) => x._creationTime <= cutoff)
		.reduce((sum, x) => sum + x.amount, 0);
	return {
		personalIncoming: allocatedIn,
		personalOutgoing: allocatedOut,
		outgoing: allocatedOut + outgoing.reduce((s, x) => s + x.planned, 0),
		incoming: allocatedIn + incoming.reduce((s, x) => s + x.planned, 0),
		actualOutgoing: allocatedOut + (await actual(outgoing)),
		actualIncoming: allocatedIn + (await actual(incoming)),
		carry: carry.reduce((s, x) => s + x.amount, 0),
		allocations: carry,
	};
}

export async function results(
	ctx: QueryCtx | MutationCtx,
	spaceId: Id<"spaces">,
	m: string,
) {
	const cutoff = await readCutoff(ctx, spaceId);
	const entries = await ctx.db
		.query("transactions")
		.withIndex("by_space_date", (q) =>
			q
				.eq("spaceId", spaceId)
				.gte("date", `${m}-01`)
				.lt("date", `${nextMonth(m)}-01`),
		)
		.filter((q) =>
			q.lte(
				q.field("_creationTime"),
				Number.isFinite(cutoff) ? cutoff : Number.MAX_SAFE_INTEGER,
			),
		)
		.collect();
	const funds = await funding(ctx, spaceId, m);
	const { space } = await access(ctx, spaceId);
	const fundedBy = await sharedForPersonal(ctx, space, m);
	let counted = entries;
	let householdIncome = 0;
	if (fundedBy) {
		const people = await recipients(ctx, fundedBy, m);
		const personalCutoff =
			people.find((x) => x.privateId === spaceId)?.cutoff ?? Infinity;
		counted = entries.filter(
			(x) => x.kind !== "income" || x._creationTime > personalCutoff,
		);
	}
	if (space.type === "shared") {
		for (const person of await recipients(ctx, spaceId, m, cutoff)) {
			const privateEntries = await ctx.db
				.query("transactions")
				.withIndex("by_space_date", (q) =>
					q
						.eq("spaceId", person.privateId)
						.gte("date", `${m}-01`)
						.lt("date", `${nextMonth(m)}-01`),
				)
				.collect();
			householdIncome += totals(
				privateEntries.filter(
					(x) => x.kind === "income" && x._creationTime <= person.cutoff,
				),
			).income;
		}
	}
	const result = totals(counted, funds.actualIncoming, funds.actualOutgoing);
	const fundPlan = await fundSummary(ctx, { spaceId, month: m });
	const categories = { ...result.categories };
	let fundSpending = 0;
	for (const entry of counted) {
		if (entry.removed || entry.pending || entry.kind !== "purchase") continue;
		for (const split of entry.splits) {
			if (!split.fundId) continue;
			fundSpending += split.amount;
			categories[split.categoryId] =
				(categories[split.categoryId] ?? 0) - split.amount;
		}
	}
	return {
		...result,
		categories,
		spendingCategories: result.categories,
		fundPlan,
		fundSpending,
		unreservedSavings:
			result.savings + householdIncome - fundPlan.reservedChange,
		income: result.income + householdIncome,
		savings: result.savings + householdIncome,
		fundedBy,
		funds,
		entries,
	};
}
