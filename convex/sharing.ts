import { ConvexError, v } from "convex/values";
import { partnerEmailError } from "../src/domain/validation";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	action,
	internalAction,
	internalMutation,
	mutation,
	query,
} from "./_generated/server";
import { access, privateSpace, user } from "./access";
import { sendEmail } from "./email";
import { hash } from "./plaidClient";

async function activeShared(ctx: Parameters<typeof user>[0], userId: string) {
	const rows = await ctx.db
		.query("memberships")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();
	for (const m of rows)
		if (m.active && (await ctx.db.get(m.spaceId))?.type === "shared")
			return m.spaceId;
	return null;
}
export const create = mutation({
	args: {},
	handler: async (ctx) => {
		const current = await user(ctx);
		if (await activeShared(ctx, current._id))
			throw new ConvexError("You already have an active shared budget.");
		const profile = await ctx.db
			.query("profiles")
			.withIndex("by_user", (q) => q.eq("userId", current._id))
			.unique();
		if (!profile) throw new ConvexError("Complete account setup first.");
		const spaceId = await ctx.db.insert("spaces", {
			name: "Shared",
			type: "shared",
			ownerId: current._id,
			timeZone: profile.timeZone,
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
				order,
				color: "#90ac75",
				revision: 0,
			});
		return spaceId;
	},
});
export const status = query({
	args: { spaceId: v.id("spaces") },
	handler: async (ctx, args) => {
		const { membership } = await access(ctx, args.spaceId);
		const cutoff = membership.active
			? Number.MAX_SAFE_INTEGER
			: (membership.leftAt ?? 0);
		const members = await ctx.db
			.query("memberships")
			.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
			.collect();
		const profiles = await Promise.all(
			members
				.filter((x) => x._creationTime <= cutoff)
				.map(async (m) => {
					const profile = await ctx.db
						.query("profiles")
						.withIndex("by_user", (q) => q.eq("userId", m.userId))
						.unique();
					return { name: profile?.name ?? "Member", active: m.active };
				}),
		);
		const invitations = await ctx.db
			.query("invitations")
			.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
			.collect();
		return {
			members: profiles,
			invitations: invitations
				.filter((x) => x._creationTime <= cutoff)
				.map((x) => ({
					_id: x._id,
					email: x.email,
					status: x.status,
					delivery: x.delivery,
					expiresAt: x.expiresAt,
				})),
		};
	},
});
export const invite = action({
	args: { spaceId: v.id("spaces"), email: v.string() },
	handler: async (ctx, args): Promise<void> => {
		const token = [...crypto.getRandomValues(new Uint8Array(32))]
			.map((x) => x.toString(16).padStart(2, "0"))
			.join("");
		const id = await ctx.runMutation(internal.sharing.storeInvite, {
			...args,
			tokenHash: await hash(token),
		});
		await ctx.scheduler.runAfter(0, internal.sharing.deliver, { id, token });
	},
});
export const storeInvite = internalMutation({
	args: { spaceId: v.id("spaces"), email: v.string(), tokenHash: v.string() },
	handler: async (ctx, args) => {
		const { current, space } = await access(ctx, args.spaceId, true);
		if (space.type !== "shared")
			throw new ConvexError("Invite a partner from a shared budget.");
		const email = args.email.trim().toLowerCase();
		const error = partnerEmailError(email, current.email);
		if (error) throw new ConvexError(error);
		const members = await ctx.db
			.query("memberships")
			.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
			.collect();
		if (members.filter((x) => x.active).length >= 2)
			throw new ConvexError("This shared budget already has two members.");
		for (const old of await ctx.db
			.query("invitations")
			.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
			.collect())
			if (old.status === "pending")
				await ctx.db.patch(old._id, { status: "revoked" });
		return ctx.db.insert("invitations", {
			spaceId: args.spaceId,
			inviterId: current._id,
			email,
			tokenHash: args.tokenHash,
			expiresAt: Date.now() + 7 * 86400000,
			status: "pending",
			delivery: "queued",
		});
	},
});
export const deliver = internalAction({
	args: { id: v.id("invitations"), token: v.string() },
	handler: async (ctx, args): Promise<void> => {
		await ctx.runMutation(internal.sharing.delivery, {
			id: args.id,
			token: args.token,
		});
	},
});
// Email IO must happen in an action, separate from the database mutation.
export const delivery = internalMutation({
	args: { id: v.id("invitations"), token: v.string() },
	handler: async (ctx, args) => {
		const invite = await ctx.db.get(args.id);
		if (!invite || invite.status !== "pending") return;
		await ctx.scheduler.runAfter(0, internal.sharing.send, {
			id: args.id,
			email: invite.email,
			token: args.token,
		});
	},
});
export const send = internalAction({
	args: { id: v.id("invitations"), email: v.string(), token: v.string() },
	handler: async (ctx, args): Promise<void> => {
		try {
			await sendEmail(
				args.email,
				"Join a shared budget on Budget Together",
				`You have been invited to share a budget. Sign in with this email address, then accept the invitation:\n${process.env.SITE_URL}/?invite=${args.token}\nThis link expires in 7 days.`,
				String(args.id),
			);
			await ctx.runMutation(internal.sharing.markDelivery, {
				id: args.id,
				status: "sent",
			});
		} catch {
			await ctx.runMutation(internal.sharing.markDelivery, {
				id: args.id,
				status: "failed",
			});
		}
	},
});
export const markDelivery = internalMutation({
	args: { id: v.id("invitations"), status: v.string() },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.id, { delivery: args.status });
	},
});
export const revoke = mutation({
	args: { id: v.id("invitations") },
	handler: async (ctx, args) => {
		const invite = await ctx.db.get(args.id);
		if (!invite) throw new ConvexError("Invitation not found.");
		await access(ctx, invite.spaceId, true);
		await ctx.db.patch(args.id, { status: "revoked" });
	},
});
export const accept = action({
	args: { token: v.string() },
	handler: async (ctx, args): Promise<Id<"spaces">> =>
		ctx.runMutation(internal.sharing.acceptHash, {
			tokenHash: await hash(args.token),
		}),
});
export const acceptHash = internalMutation({
	args: { tokenHash: v.string() },
	handler: async (ctx, args) => {
		const current = await user(ctx);
		const invite = await ctx.db
			.query("invitations")
			.withIndex("by_hash", (q) => q.eq("tokenHash", args.tokenHash))
			.unique();
		if (
			!invite ||
			invite.status !== "pending" ||
			invite.expiresAt < Date.now() ||
			invite.email !== current.email.toLowerCase()
		)
			throw new ConvexError(
				"This invitation is invalid, expired, or belongs to another email address.",
			);
		if (await activeShared(ctx, current._id))
			throw new ConvexError(
				"Leave your existing shared budget before joining another.",
			);
		const members = await ctx.db
			.query("memberships")
			.withIndex("by_space", (q) => q.eq("spaceId", invite.spaceId))
			.collect();
		if (members.filter((x) => x.active).length >= 2)
			throw new ConvexError("This budget is full.");
		const inviter = members.find(
			(x) => x.userId === invite.inviterId && x.active,
		);
		if (!inviter) throw new ConvexError("The inviter is no longer a member.");
		const previous = members.find((x) => x.userId === current._id);
		if (previous)
			await ctx.db.patch(previous._id, {
				active: true,
				joinedAt: Date.now(),
				leftAt: undefined,
			});
		else
			await ctx.db.insert("memberships", {
				spaceId: invite.spaceId,
				userId: current._id,
				active: true,
				joinedAt: Date.now(),
			});
		await ctx.db.patch(invite._id, { status: "accepted" });
		return invite.spaceId;
	},
});

export const leave = mutation({
	args: { spaceId: v.id("spaces") },
	handler: async (ctx, args) => {
		const { current, space, membership } = await access(
			ctx,
			args.spaceId,
			true,
		);
		if (space.type !== "shared")
			throw new ConvexError("You can leave only a shared budget.");
		const destination = await privateSpace(ctx, current._id);
		const now = Date.now();
		const parts = new Intl.DateTimeFormat("en-CA", {
			timeZone: space.timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).formatToParts(new Date(now));
		const date = `${parts.find((x) => x.type === "year")!.value}-${parts.find((x) => x.type === "month")!.value}-${parts.find((x) => x.type === "day")!.value}`;
		for (const account of await ctx.db
			.query("accounts")
			.withIndex("by_user", (q) => q.eq("userId", current._id))
			.collect())
			if (account.spaceId === args.spaceId)
				await ctx.db.patch(account._id, {
					spaceId: destination._id,
					assignments: [
						...(account.assignments ?? [
							{ spaceId: account.spaceId, startsOn: "0000-01-01" },
						]),
						{ spaceId: destination._id, startsOn: date },
					],
					revision: account.revision + 1,
				});
		for (const invitation of await ctx.db
			.query("invitations")
			.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
			.collect())
			if (invitation.status === "pending")
				await ctx.db.patch(invitation._id, { status: "revoked" });
		await ctx.db.patch(membership._id, { active: false, leftAt: now });
	},
});
