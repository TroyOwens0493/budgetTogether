import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { access } from "./access";
import { sendEmail } from "./email";
import * as invitations from "./model/invitations";
import * as sharedDeletion from "./model/sharedDeletion";
import { hash } from "./plaidClient";

export const status = query({
	args: { spaceId: v.id("spaces") },
	handler: async (ctx, args) => {
		await access(ctx, args.spaceId);
		const members = await ctx.db
			.query("memberships")
			.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
			.collect();
		const profiles = await Promise.all(
			members.map(async (m) => {
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
			invitations: invitations.map((x) => ({
				_id: x._id,
				email: x.email,
				status: x.status,
				delivery: x.delivery,
				expiresAt: x.expiresAt,
			})),
		};
	},
});
function inviteToken() {
	return [...crypto.getRandomValues(new Uint8Array(32))]
		.map((x) => x.toString(16).padStart(2, "0"))
		.join("");
}

function requireEmailSetup() {
	if (
		!process.env.RESEND_API_KEY ||
		!process.env.RESEND_FROM ||
		!process.env.SITE_URL
	)
		throw new ConvexError(
			"Invitation emails are not configured yet. Please try again later.",
		);
}

export const outgoing = query({
	args: {},
	handler: invitations.outgoing,
});

export const invite = action({
	args: { email: v.string() },
	handler: async (ctx, args): Promise<void> => {
		requireEmailSetup();
		const token = inviteToken();
		await ctx.runMutation(internal.sharing.storeInvite, {
			...args,
			token,
			tokenHash: await hash(token),
		});
	},
});

export const resend = action({
	args: { id: v.id("invitations") },
	handler: async (ctx, args): Promise<void> => {
		requireEmailSetup();
		const token = inviteToken();
		await ctx.runMutation(internal.sharing.storeInvite, {
			...args,
			token,
			tokenHash: await hash(token),
		});
	},
});

export const storeInvite = internalMutation({
	args: {
		email: v.optional(v.string()),
		id: v.optional(v.id("invitations")),
		token: v.string(),
		tokenHash: v.string(),
	},
	handler: invitations.queue,
});

export const revoke = mutation({
	args: { id: v.id("invitations") },
	handler: (ctx, args) => invitations.revoke(ctx, args.id),
});

export const preview = action({
	args: { token: v.string() },
	handler: async (ctx, args): Promise<invitations.Review> =>
		ctx.runQuery(internal.sharing.reviewHash, {
			tokenHash: await hash(args.token),
		}),
});

export const reviewHash = internalQuery({
	args: { tokenHash: v.string() },
	handler: (ctx, args) => invitations.review(ctx, args.tokenHash),
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
	handler: (ctx, args) => invitations.accept(ctx, args.tokenHash),
});

export const delivery = internalQuery({
	args: { id: v.id("invitations"), tokenHash: v.string() },
	handler: (ctx, args) => invitations.delivery(ctx, args.id, args.tokenHash),
});

export const send = internalAction({
	args: { id: v.id("invitations"), token: v.string() },
	handler: async (ctx, args): Promise<void> => {
		const tokenHash = await hash(args.token);
		const delivery = await ctx.runQuery(internal.sharing.delivery, {
			id: args.id,
			tokenHash,
		});
		if (!delivery) return;
		let status: "sent" | "failed" = "failed";
		try {
			requireEmailSetup();
			const url = new URL("/", process.env.SITE_URL);
			url.searchParams.set("invite", args.token);
			await sendEmail(
				delivery.email,
				`${delivery.inviterName} invited you to Budget Together`,
				`${delivery.inviterName} invited you to create a shared budget on Budget Together.\n\nOpen this link, then sign in or create an account with ${delivery.email}:\n${url.href}\n\nReview and accept the invitation to create your shared budget. Your private budgets stay separate, and you choose which accounts to move.\n\nThis invitation expires in 7 days. If you did not expect it, you can ignore this email.`,
				`invite-${args.id}-${tokenHash}`,
			);
			status = "sent";
		} catch {
			// The sender can retry through Resend without creating a budget or losing the invite.
		}
		await ctx.runMutation(internal.sharing.markDelivery, {
			id: args.id,
			tokenHash,
			status,
		});
	},
});

export const markDelivery = internalMutation({
	args: {
		id: v.id("invitations"),
		tokenHash: v.string(),
		status: v.union(v.literal("sent"), v.literal("failed")),
	},
	handler: invitations.markDelivery,
});

export const leave = mutation({
	args: { spaceId: v.id("spaces") },
	handler: async (ctx, args) => {
		const { space } = await access(ctx, args.spaceId);
		if (space.type !== "shared")
			throw new ConvexError("You can leave only a shared budget.");
		await sharedDeletion.remove(ctx, space);
	},
});

export const purge = internalMutation({
	args: { spaceId: v.id("spaces") },
	handler: sharedDeletion.purge,
});
