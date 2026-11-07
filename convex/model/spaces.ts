import { ConvexError } from "convex/values";
import { timeZoneError } from "../../src/domain/validation";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { label, user } from "../access";
import { createDefaults } from "./categories";

export async function setup(
	ctx: MutationCtx,
	args: { name: string; timeZone: string },
) {
	const current = await user(ctx);
	const error = timeZoneError(args.timeZone);
	if (error) throw new ConvexError(error);
	const existing = await ctx.db
		.query("profiles")
		.withIndex("by_user", (q) => q.eq("userId", current._id))
		.unique();
	if (existing) {
		await ctx.db.patch(existing._id, {
			name: label(args.name),
			timeZone: args.timeZone,
		});
		return;
	}
	await ctx.db.insert("profiles", {
		userId: current._id,
		name: label(args.name),
		email: current.email.toLowerCase(),
		timeZone: args.timeZone,
	});
	const spaceId = await ctx.db.insert("spaces", {
		name: "My budget",
		type: "private",
		ownerId: current._id,
		timeZone: args.timeZone,
	});
	await ctx.db.insert("memberships", {
		spaceId,
		userId: current._id,
		active: true,
		joinedAt: Date.now(),
	});
	await createDefaults(ctx, spaceId);
}

export async function home(ctx: QueryCtx) {
	const current = await user(ctx);
	const profile = await ctx.db
		.query("profiles")
		.withIndex("by_user", (q) => q.eq("userId", current._id))
		.unique();
	const memberships = await ctx.db
		.query("memberships")
		.withIndex("by_user", (q) => q.eq("userId", current._id))
		.collect();
	const spaces = await Promise.all(
		memberships
			.filter((m) => m.active)
			.map(async (m) => {
				const space = (await ctx.db.get(m.spaceId))!;
				return {
					...space,
					name: space.type === "shared" ? "Shared" : space.name,
					active: m.active,
				};
			}),
	);
	return {
		profile,
		spaces,
		user: { name: current.name, email: current.email, id: current._id },
	};
}
