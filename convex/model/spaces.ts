import { ConvexError } from "convex/values";
import { timeZoneError } from "../../src/domain/validation";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { label, user } from "../access";

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
	for (const [order, name] of [
		"Housing",
		"Groceries",
		"Dining out",
		"Entertainment",
		"Transport",
		"Other",
	].entries())
		await ctx.db.insert("categories", {
			spaceId,
			name,
			color: ["#9daf87", "#90ac75", "#d5ac65", "#ada9cf", "#d89774", "#83aaa2"][
				order
			],
			order,
			revision: 0,
		});
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
		memberships.map(async (m) => {
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
