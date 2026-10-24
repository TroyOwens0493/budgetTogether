import { ConvexError } from "convex/values";
import {
	recurring as detectRecurring,
	leftovers,
	month,
} from "../../src/domain/budget";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { access, readCutoff } from "../access";
import { results } from "./accounting";

export async function recurring(
	ctx: QueryCtx,
	args: { spaceId: Id<"spaces"> },
) {
	const cutoff = await readCutoff(ctx, args.spaceId);
	const entries = await ctx.db
		.query("transactions")
		.withIndex("by_space_date", (q) => q.eq("spaceId", args.spaceId))
		.collect();
	const states = await ctx.db
		.query("recurring")
		.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
		.collect();
	return detectRecurring(entries.filter((x) => x._creationTime <= cutoff)).map(
		(x) => ({
			...x,
			status:
				states.find((s) => s.merchant === x.merchant)?.status ?? "suggested",
		}),
	);
}

export async function setRecurring(
	ctx: MutationCtx,
	args: {
		spaceId: Id<"spaces">;
		merchant: string;
		status: Doc<"recurring">["status"];
	},
) {
	await access(ctx, args.spaceId, true);
	const rows = await ctx.db
		.query("recurring")
		.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
		.collect();
	const old = rows.find((x) => x.merchant === args.merchant);
	if (old) await ctx.db.patch(old._id, { status: args.status });
	else await ctx.db.insert("recurring", args);
}

export async function alerts(
	ctx: QueryCtx,
	args: { spaceId: Id<"spaces">; month: string },
) {
	const { current } = await access(ctx, args.spaceId);
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
	const reads = await ctx.db
		.query("alertReads")
		.withIndex("by_user", (q) => q.eq("userId", current._id))
		.collect();
	const items = [];
	for (const x of plan?.limits ?? []) {
		const spent = result.categories[x.categoryId] ?? 0;
		if (spent > x.amount || (x.amount > 0 && spent >= x.amount * 0.8)) {
			const severity = spent > x.amount ? "over" : "near";
			const key = `${args.spaceId}:${args.month}:${x.categoryId}:${severity}`;
			const category = await ctx.db.get(x.categoryId);
			items.push({
				key,
				severity,
				text: `${category?.name ?? "Category"}: ${severity === "over" ? "over budget" : "80% or more used"}`,
				read: reads.some((x) => x.key === key),
			});
		}
	}
	const reserved = await ctx.db
		.query("carry")
		.withIndex("by_source", (q) =>
			q.eq("spaceId", args.spaceId).eq("sourceMonth", args.month),
		)
		.collect();
	if (
		leftovers(
			result.unreservedSavings,
			plan?.savingsTarget ?? 0,
			reserved.reduce((s, x) => s + x.amount, 0),
		) < 0
	)
		items.push({
			key: `${args.spaceId}:${args.month}:carry`,
			severity: "invalid" as const,
			text: "Corrected transactions made carry-forward invalid.",
			read: false,
		});
	return items;
}

export async function readAlert(
	ctx: MutationCtx,
	args: { spaceId: Id<"spaces">; key: string },
) {
	const { current } = await access(ctx, args.spaceId);
	if (!args.key.startsWith(`${args.spaceId}:`))
		throw new ConvexError("Invalid alert.");
	const rows = await ctx.db
		.query("alertReads")
		.withIndex("by_user", (q) => q.eq("userId", current._id))
		.collect();
	if (!rows.some((x) => x.key === args.key))
		await ctx.db.insert("alertReads", { userId: current._id, key: args.key });
}
