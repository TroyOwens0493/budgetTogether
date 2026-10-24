import { ConvexError } from "convex/values";
import { labelError } from "../src/domain/validation";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";
export type DbCtx = QueryCtx | MutationCtx;
export async function user(ctx: DbCtx) {
	const current = await authComponent.getAuthUser(ctx);
	if (!current) throw new ConvexError("Sign in to continue.");
	return current;
}
export async function access(ctx: DbCtx, spaceId: Id<"spaces">, write = false) {
	const current = await user(ctx);
	const space = await ctx.db.get(spaceId);
	if (!space) throw new ConvexError("Budget not found.");
	const membership = await ctx.db
		.query("memberships")
		.withIndex("by_user", (q) => q.eq("userId", current._id))
		.filter((q) => q.eq(q.field("spaceId"), spaceId))
		.first();
	if (!membership || (write && !membership.active))
		throw new ConvexError("You do not have access to this budget.");
	return { current, space, membership };
}
export async function privateSpace(ctx: DbCtx, userId: string) {
	const memberships = await ctx.db
		.query("memberships")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();
	for (const m of memberships) {
		const s = await ctx.db.get(m.spaceId);
		if (m.active && s?.type === "private") return s;
	}
	throw new ConvexError("Complete account setup first.");
}
export function label(value: string, maximum = 100): string {
	const result = value.trim();
	const error = labelError(value, maximum);
	if (error) throw new ConvexError(error);
	return result;
}

export async function readCutoff(
	ctx: DbCtx,
	spaceId: Id<"spaces">,
): Promise<number> {
	const { membership } = await access(ctx, spaceId);
	return membership.active ? Infinity : (membership.leftAt ?? 0);
}
