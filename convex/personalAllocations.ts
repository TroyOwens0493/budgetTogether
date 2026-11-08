import { ConvexError, v } from "convex/values";
import { assertRevision, money, month } from "../src/domain/budget";
import { mutation, query } from "./_generated/server";
import { access } from "./access";
import { allocations, recipients } from "./model/personalFunding";

export const list = query({
	args: { sharedId: v.id("spaces"), month: v.string() },
	handler: async (ctx, args) => {
		await access(ctx, args.sharedId);
		month(args.month);
		return (await allocations(ctx, args.sharedId, args.month)).map(
			({ privateId, name, active, amount, revision, automatic }) => ({
				privateId,
				name,
				active,
				amount,
				revision,
				automatic,
			}),
		);
	},
});

export const save = mutation({
	args: {
		sharedId: v.id("spaces"),
		privateId: v.id("spaces"),
		month: v.string(),
		amount: v.number(),
		revision: v.number(),
	},
	handler: async (ctx, args) => {
		await access(ctx, args.sharedId);
		month(args.month);
		money(args.amount, true);
		const people = await recipients(ctx, args.sharedId, args.month);
		if (!people.some((x) => x.privateId === args.privateId && x.active))
			throw new ConvexError("Choose an active member's personal budget.");
		const old = await ctx.db
			.query("personalAllocations")
			.withIndex("by_private", (q) =>
				q.eq("privateId", args.privateId).eq("month", args.month),
			)
			.filter((q) => q.eq(q.field("sharedId"), args.sharedId))
			.unique();
		assertRevision(old?.revision ?? 0, args.revision);
		if (args.amount !== (old?.amount ?? 0)) {
			for (const spaceId of [args.sharedId, args.privateId]) {
				const plan = await ctx.db
					.query("plans")
					.withIndex("by_month", (q) =>
						q.eq("spaceId", spaceId).eq("month", args.month),
					)
					.unique();
				if (plan)
					await ctx.db.patch(plan._id, {
						saved: false,
						status: undefined,
						reviewed: false,
						revision: plan.revision + 1,
					});
			}
		}
		if (old)
			await ctx.db.patch(old._id, {
				amount: args.amount,
				revision: old.revision + 1,
			});
		else
			await ctx.db.insert("personalAllocations", {
				sharedId: args.sharedId,
				privateId: args.privateId,
				month: args.month,
				amount: args.amount,
				revision: 1,
			});
	},
});
