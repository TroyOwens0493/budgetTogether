import { ConvexError, v } from "convex/values";
import { assertRevision, money, month } from "../src/domain/budget";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { access, type DbCtx } from "./access";
import { sharedForPersonal } from "./model/personalFunding";

// Use the same month and membership rules for controls and direct API calls.
async function contributionAccess(
	ctx: DbCtx,
	privateId: Id<"spaces">,
	sharedId: Id<"spaces">,
	m: string,
	write = false,
) {
	const { space, membership: personalMembership } = await access(
		ctx,
		privateId,
		write,
	);
	const { space: shared, membership } = await access(ctx, sharedId, write);
	month(m);
	if (space.type !== "private" || shared.type !== "shared")
		throw new ConvexError("Select a private and shared budget.");
	const fundedByShared = Boolean(await sharedForPersonal(ctx, space, m));
	return {
		fundedByShared,
		canEdit: personalMembership.active && membership.active && !fundedByShared,
		cutoff: membership.active ? Infinity : (membership.leftAt ?? 0),
	};
}

export const list = query({
	args: {
		privateId: v.id("spaces"),
		sharedId: v.id("spaces"),
		month: v.string(),
	},
	handler: async (ctx, args) => {
		const { canEdit, cutoff } = await contributionAccess(
			ctx,
			args.privateId,
			args.sharedId,
			args.month,
		);
		let contribution = await ctx.db
			.query("contributions")
			.withIndex("by_private", (q) =>
				q.eq("privateId", args.privateId).eq("month", args.month),
			)
			.filter((q) => q.eq(q.field("sharedId"), args.sharedId))
			.unique();
		if (contribution && contribution._creationTime > cutoff)
			contribution = null;
		if (contribution && Number.isFinite(cutoff)) {
			const pairs = [];
			for (const pair of contribution.pairs) {
				const outgoing = await ctx.db.get(pair.outId);
				const incoming = await ctx.db.get(pair.inId);
				if (
					outgoing &&
					incoming &&
					outgoing._creationTime <= cutoff &&
					incoming._creationTime <= cutoff
				)
					pairs.push(pair);
			}
			contribution = { ...contribution, pairs };
		}
		if (!canEdit) return { contribution, suggestions: [], canEdit };
		const personal = await ctx.db
			.query("transactions")
			.withIndex("by_space_date", (q) => q.eq("spaceId", args.privateId))
			.collect();
		const sharedEntries = await ctx.db
			.query("transactions")
			.withIndex("by_space_date", (q) => q.eq("spaceId", args.sharedId))
			.collect();
		const all = [
			...(await ctx.db
				.query("contributions")
				.withIndex("by_shared", (q) =>
					q.eq("sharedId", args.sharedId).eq("month", args.month),
				)
				.collect()),
		];
		const used = new Set(
			all.flatMap((x) => x.pairs.flatMap((p) => [p.outId, p.inId])),
		);
		const suggestions = personal
			.filter(
				(x) =>
					!x.removed &&
					!x.pending &&
					x.amount > 0 &&
					x.date.startsWith(args.month) &&
					!used.has(x._id) &&
					(x.kind === "transfer" || x.suggestedKind === "transfer"),
			)
			.flatMap((out) =>
				sharedEntries
					.filter(
						(entry) =>
							!entry.removed &&
							!entry.pending &&
							!used.has(entry._id) &&
							entry.amount === -out.amount &&
							entry.date.startsWith(args.month) &&
							Math.abs(Date.parse(entry.date) - Date.parse(out.date)) <=
								3 * 86400000,
					)
					.map((incoming) => ({
						outId: out._id,
						inId: incoming._id,
						outDescription: out.description,
						inDescription: incoming.description,
						date: out.date,
						amount: out.amount,
					})),
			);
		return { contribution, suggestions, canEdit };
	},
});
export const savePlanned = mutation({
	args: {
		privateId: v.id("spaces"),
		sharedId: v.id("spaces"),
		month: v.string(),
		planned: v.number(),
		revision: v.number(),
	},
	handler: async (ctx, args) => {
		const { fundedByShared } = await contributionAccess(
			ctx,
			args.privateId,
			args.sharedId,
			args.month,
			true,
		);
		money(args.planned, true);
		if (fundedByShared)
			throw new ConvexError(
				"Assign personal funding from the shared monthly budget.",
			);
		const old = await ctx.db
			.query("contributions")
			.withIndex("by_private", (q) =>
				q.eq("privateId", args.privateId).eq("month", args.month),
			)
			.filter((q) => q.eq(q.field("sharedId"), args.sharedId))
			.unique();
		assertRevision(old?.revision ?? 0, args.revision);
		if (args.planned !== (old?.planned ?? 0))
			for (const id of [args.privateId, args.sharedId]) {
				const plan = await ctx.db
					.query("plans")
					.withIndex("by_month", (q) =>
						q.eq("spaceId", id).eq("month", args.month),
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
		if (old)
			await ctx.db.patch(old._id, {
				planned: args.planned,
				revision: old.revision + 1,
			});
		else
			await ctx.db.insert("contributions", {
				privateId: args.privateId,
				sharedId: args.sharedId,
				month: args.month,
				planned: args.planned,
				pairs: [],
				revision: 1,
			});
	},
});
export const confirm = mutation({
	args: {
		privateId: v.id("spaces"),
		sharedId: v.id("spaces"),
		outId: v.id("transactions"),
		inId: v.id("transactions"),
	},
	handler: async (ctx, args) => {
		const { space } = await access(ctx, args.privateId, true);
		const { space: shared } = await access(ctx, args.sharedId, true);
		if (space.type !== "private" || shared.type !== "shared")
			throw new ConvexError("Select a private and shared budget.");
		const outgoing = await ctx.db.get(args.outId);
		const incoming = await ctx.db.get(args.inId);
		if (
			!outgoing ||
			!incoming ||
			outgoing.spaceId !== args.privateId ||
			incoming.spaceId !== args.sharedId ||
			outgoing.pending ||
			incoming.pending ||
			outgoing.removed ||
			incoming.removed ||
			outgoing.amount <= 0 ||
			outgoing.amount !== -incoming.amount ||
			outgoing.date.slice(0, 7) !== incoming.date.slice(0, 7)
		)
			throw new ConvexError(
				"Choose posted entries in the same month with equal and opposite amounts.",
			);
		const m = outgoing.date.slice(0, 7);
		if (await sharedForPersonal(ctx, space, m))
			throw new ConvexError(
				"Personal funding is a budget allocation. Bank transfers do not change it.",
			);
		const rows = await ctx.db
			.query("contributions")
			.withIndex("by_shared", (q) =>
				q.eq("sharedId", args.sharedId).eq("month", m),
			)
			.collect();
		if (
			rows.some((x) =>
				x.pairs.some((p) => p.outId === args.outId || p.inId === args.inId),
			)
		)
			throw new ConvexError("An entry is already matched to a contribution.");
		const old = rows.find((x) => x.privateId === args.privateId);
		const pair = {
			outId: args.outId,
			inId: args.inId,
			amount: outgoing.amount,
		};
		if (old)
			await ctx.db.patch(old._id, {
				pairs: [...old.pairs, pair],
				revision: old.revision + 1,
			});
		else
			await ctx.db.insert("contributions", {
				privateId: args.privateId,
				sharedId: args.sharedId,
				month: m,
				planned: 0,
				pairs: [pair],
				revision: 1,
			});
		for (const entry of [outgoing, incoming])
			await ctx.db.patch(entry._id, {
				kind: "transfer",
				splits: [],
				edited: true,
				revision: entry.revision + 1,
			});
	},
});
export const unmatch = mutation({
	args: {
		id: v.id("contributions"),
		outId: v.id("transactions"),
		revision: v.number(),
	},
	handler: async (ctx, args) => {
		const c = await ctx.db.get(args.id);
		if (!c) throw new ConvexError("Contribution not found.");
		const { fundedByShared } = await contributionAccess(
			ctx,
			c.privateId,
			c.sharedId,
			c.month,
			true,
		);
		if (fundedByShared)
			throw new ConvexError(
				"Historical contributions are read-only for shared-funded months.",
			);
		assertRevision(c.revision, args.revision);
		await ctx.db.patch(c._id, {
			pairs: c.pairs.filter((x) => x.outId !== args.outId),
			revision: c.revision + 1,
		});
	},
});
