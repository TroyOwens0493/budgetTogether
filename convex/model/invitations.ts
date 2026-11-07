import { ConvexError } from "convex/values";
import { partnerEmailError } from "../../src/domain/validation";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { type DbCtx, privateSpace, user } from "../access";
import { createDefaults } from "./categories";

const lifetime = 7 * 86400000;

export async function activeShared(ctx: DbCtx, userId: string) {
	const rows = await ctx.db
		.query("memberships")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();
	for (const member of rows)
		if (member.active && (await ctx.db.get(member.spaceId))?.type === "shared")
			return member.spaceId;
	return null;
}

function pending(ctx: DbCtx, inviterId: string) {
	return ctx.db
		.query("invitations")
		.withIndex("by_inviter", (q) =>
			q.eq("inviterId", inviterId).eq("status", "pending"),
		);
}

export async function outgoing(ctx: DbCtx) {
	const current = await user(ctx);
	const invite = await pending(ctx, current._id).order("desc").first();
	return invite
		? {
				_id: invite._id,
				email: invite.email,
				expiresAt: invite.expiresAt,
				delivery: invite.delivery,
			}
		: null;
}

/** Store the invite and its email job in one transaction. No budget exists yet. */
export async function queue(
	ctx: MutationCtx,
	args: {
		email?: string;
		id?: Id<"invitations">;
		token: string;
		tokenHash: string;
	},
) {
	const current = await user(ctx);
	await privateSpace(ctx, current._id);
	if (await activeShared(ctx, current._id))
		throw new ConvexError("You already have a shared budget.");
	const old = args.id ? await ctx.db.get(args.id) : null;
	if (
		args.id &&
		(!old || old.inviterId !== current._id || old.status !== "pending")
	)
		throw new ConvexError("This invitation can no longer be resent.");
	const email = (old?.email ?? args.email ?? "").trim().toLowerCase();
	const error = partnerEmailError(email, current.email);
	if (error) throw new ConvexError(error);
	const now = Date.now();
	const previous = await pending(ctx, current._id).collect();
	if (previous.some((row) => row._id !== old?._id && row.expiresAt > now))
		throw new ConvexError(
			"Cancel your pending invitation before inviting someone else.",
		);
	for (const row of previous)
		if (row._id !== old?._id)
			await ctx.db.patch(row._id, { status: "revoked" });
	const value = {
		tokenHash: args.tokenHash,
		expiresAt: now + lifetime,
		delivery: "queued",
	};
	const id = old
		? old._id
		: await ctx.db.insert("invitations", {
				...value,
				inviterId: current._id,
				email,
				status: "pending",
			});
	if (old) await ctx.db.patch(id, value);
	await ctx.scheduler.runAfter(0, internal.sharing.send, {
		id,
		token: args.token,
	});
	return id;
}

export async function revoke(ctx: MutationCtx, id: Id<"invitations">) {
	const current = await user(ctx);
	const invite = await ctx.db.get(id);
	if (!invite || invite.inviterId !== current._id)
		throw new ConvexError("Invitation not found.");
	if (invite.status !== "pending")
		throw new ConvexError("This invitation is no longer pending.");
	await ctx.db.patch(id, { status: "revoked" });
}

async function byHash(ctx: DbCtx, tokenHash: string) {
	return ctx.db
		.query("invitations")
		.withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
		.unique();
}

export type Review =
	| { state: "unavailable" | "wrong-email" | "accepted" }
	| { state: "blocked" }
	| { state: "ready"; inviterName: string; expiresAt: number };

export async function review(ctx: DbCtx, tokenHash: string): Promise<Review> {
	const current = await user(ctx);
	const invite = await byHash(ctx, tokenHash);
	if (!invite || invite.status === "revoked" || invite.expiresAt <= Date.now())
		return { state: "unavailable" };
	if (invite.email !== current.email.trim().toLowerCase())
		return { state: "wrong-email" };
	if (invite.status === "accepted") return { state: "accepted" };
	if (await activeShared(ctx, current._id)) return { state: "blocked" };
	if (await activeShared(ctx, invite.inviterId))
		return { state: "unavailable" };
	const inviter = await ctx.db
		.query("profiles")
		.withIndex("by_user", (q) => q.eq("userId", invite.inviterId))
		.unique();
	if (!inviter) return { state: "unavailable" };
	return {
		state: "ready",
		inviterName: inviter.name,
		expiresAt: invite.expiresAt,
	};
}

/** Both memberships, acceptance, and the new budget commit together. */
export async function accept(ctx: MutationCtx, tokenHash: string) {
	const current = await user(ctx);
	const invite = await byHash(ctx, tokenHash);
	if (
		!invite ||
		invite.status !== "pending" ||
		invite.expiresAt <= Date.now() ||
		invite.email !== current.email.trim().toLowerCase() ||
		invite.inviterId === current._id
	)
		throw new ConvexError(
			"This invitation is invalid, expired, or belongs to another email address.",
		);
	if (await activeShared(ctx, current._id))
		throw new ConvexError(
			"Leave your existing shared budget before accepting this invitation. Leaving deletes that budget for both people.",
		);
	if (await activeShared(ctx, invite.inviterId))
		throw new ConvexError(
			"This invitation is no longer available. Ask the sender for a new invitation.",
		);
	await privateSpace(ctx, current._id);
	await privateSpace(ctx, invite.inviterId);
	const inviter = await ctx.db
		.query("profiles")
		.withIndex("by_user", (q) => q.eq("userId", invite.inviterId))
		.unique();
	if (!inviter)
		throw new ConvexError("The sender's account is no longer available.");
	const spaceId = await ctx.db.insert("spaces", {
		name: "Shared",
		type: "shared",
		ownerId: invite.inviterId,
		timeZone: inviter.timeZone,
	});
	for (const userId of [invite.inviterId, current._id])
		await ctx.db.insert("memberships", {
			spaceId,
			userId,
			active: true,
			joinedAt: Date.now(),
		});
	await createDefaults(ctx, spaceId);
	await ctx.db.patch(invite._id, { status: "accepted", spaceId });
	for (const outgoing of await pending(ctx, current._id).collect())
		await ctx.db.patch(outgoing._id, { status: "revoked" });
	return spaceId;
}

/** A late worker must not send a cancelled or replaced invitation. */
export async function delivery(
	ctx: DbCtx,
	id: Id<"invitations">,
	tokenHash: string,
) {
	const invite = await ctx.db.get(id);
	if (
		!invite ||
		invite.status !== "pending" ||
		invite.expiresAt <= Date.now() ||
		invite.tokenHash !== tokenHash ||
		(await activeShared(ctx, invite.inviterId))
	)
		return null;
	const inviter = await ctx.db
		.query("profiles")
		.withIndex("by_user", (q) => q.eq("userId", invite.inviterId))
		.unique();
	return inviter ? { email: invite.email, inviterName: inviter.name } : null;
}

export async function markDelivery(
	ctx: MutationCtx,
	args: { id: Id<"invitations">; tokenHash: string; status: "sent" | "failed" },
) {
	const invite: Doc<"invitations"> | null = await ctx.db.get(args.id);
	if (invite?.status === "pending" && invite.tokenHash === args.tokenHash)
		await ctx.db.patch(invite._id, { delivery: args.status });
}
