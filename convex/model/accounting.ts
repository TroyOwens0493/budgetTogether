import { nextMonth, totals } from "../../src/domain/budget";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { access } from "../access";
import { summary as fundSummary } from "./funds";
import {
	allocations as personalAllocations,
	recipients,
	sharedForPersonal,
} from "./personalFunding";

export async function funding(
	ctx: QueryCtx | MutationCtx,
	spaceId: Id<"spaces">,
	m: string,
) {
	await access(ctx, spaceId);
	let outgoing = await ctx.db
		.query("contributions")
		.withIndex("by_private", (q) => q.eq("privateId", spaceId).eq("month", m))
		.collect();
	let incoming = await ctx.db
		.query("contributions")
		.withIndex("by_shared", (q) => q.eq("sharedId", spaceId).eq("month", m))
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
					incoming.date.slice(0, 7) === m
				)
					value += pair.amount;
			}
		return value;
	}
	const space = await ctx.db.get(spaceId);
	const sharedId = space ? await sharedForPersonal(ctx, space, m) : null;
	const personalIncoming = sharedId
		? await personalAllocations(ctx, sharedId, m)
		: [];
	const ownAllocation = personalIncoming.find((x) => x.privateId === spaceId);
	const personalOutgoing =
		space?.type === "shared" ? await personalAllocations(ctx, spaceId, m) : [];
	const allocatedIn = ownAllocation?.amount ?? 0;
	const allocatedOut = personalOutgoing.reduce((sum, x) => sum + x.amount, 0);
	return {
		personalIncoming: allocatedIn,
		automaticPersonalFunding: Boolean(ownAllocation?.automatic),
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
	const { space } = await access(ctx, spaceId);
	const entries = await ctx.db
		.query("transactions")
		.withIndex("by_space_date", (q) =>
			q
				.eq("spaceId", spaceId)
				.gte("date", `${m}-01`)
				.lt("date", `${nextMonth(m)}-01`),
		)
		.collect();
	const funds = await funding(ctx, spaceId, m);
	const fundedBy = await sharedForPersonal(ctx, space, m);
	let counted = entries;
	let householdIncome = 0;
	if (fundedBy) counted = entries.filter((x) => x.kind !== "income");
	if (space.type === "shared") {
		for (const person of await recipients(ctx, spaceId, m)) {
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
				privateEntries.filter((x) => x.kind === "income"),
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
