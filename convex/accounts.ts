import { ConvexError, v } from "convex/values";
import { assertRevision } from "../src/domain/budget";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { access, label, user } from "./access";
export const list = query({
	args: { spaceId: v.id("spaces") },
	handler: async (ctx, args) => {
		const { current, space } = await access(ctx, args.spaceId);
		const accounts = await ctx.db
			.query("accounts")
			.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
			.collect();
		// Only an account owner can move it into a budget they belong to. Include
		// former members for historical labels, and require an actual transaction.
		const owners =
			space.type === "private"
				? [space.ownerId]
				: (
						await ctx.db
							.query("memberships")
							.withIndex("by_space", (q) => q.eq("spaceId", space._id))
							.collect()
					).map((member) => member.userId);
		const historical = [];
		for (const owner of new Set(owners)) {
			const owned = await ctx.db
				.query("accounts")
				.withIndex("by_user", (q) => q.eq("userId", owner))
				.collect();
			for (const account of owned) {
				if (account.spaceId === space._id) continue;
				const first = await ctx.db
					.query("transactions")
					.withIndex("by_space_account_date", (q) =>
						q.eq("spaceId", space._id).eq("accountId", account._id),
					)
					.first();
				if (first) historical.push({ account, first });
			}
		}
		historical.sort(
			(a, b) =>
				a.first.date.localeCompare(b.first.date) ||
				a.first._creationTime - b.first._creationTime,
		);
		accounts.push(...historical.map(({ account }) => account));
		return accounts.map((a) => ({
			_id: a._id,
			name: a.name,
			type: a.type,
			mask: a.mask,
			active: a.active && a.spaceId === args.spaceId,
			revision: a.revision,
			canMove: a.userId === current._id && a.spaceId === args.spaceId,
		}));
	},
});
export const connections = query({
	args: {},
	handler: async (ctx) => {
		const current = await user(ctx);
		const rows = await ctx.db
			.query("connections")
			.withIndex("by_user", (q) => q.eq("userId", current._id))
			.collect();
		return rows.map((x) => ({
			_id: x._id,
			institution: x.institution,
			status: x.status,
			lastSync: x.lastSync,
			error: x.error,
		}));
	},
});
export const rename = mutation({
	args: { id: v.id("accounts"), name: v.string(), revision: v.number() },
	handler: async (ctx, args) => {
		const account = await ctx.db.get(args.id);
		if (!account) throw new ConvexError("Account not found.");
		await access(ctx, account.spaceId);
		assertRevision(account.revision, args.revision);
		await ctx.db.patch(args.id, {
			name: label(args.name),
			revision: account.revision + 1,
		});
	},
});

export const move = mutation({
	args: {
		id: v.id("accounts"),
		destinationId: v.id("spaces"),
		revision: v.number(),
	},
	handler: async (ctx, args) => {
		const current = await user(ctx);
		const account = await ctx.db.get(args.id);
		if (!account || account.userId !== current._id)
			throw new ConvexError("Only the connecting user can move this account.");
		await access(ctx, account.spaceId);
		await access(ctx, args.destinationId);
		assertRevision(account.revision, args.revision);
		if (account.spaceId === args.destinationId)
			throw new ConvexError("This account is already in that budget.");
		await ctx.db.patch(account._id, {
			...(await assignmentChange(ctx, account, args.destinationId)),
			revision: account.revision + 1,
		});
		// Existing transaction assignments stay unchanged, including all private history.
	},
});

// Build the assignment patch before writing so a combined save is atomic.
async function assignmentChange(
	ctx: MutationCtx,
	account: Doc<"accounts">,
	destinationId: Id<"spaces">,
) {
	const { space: destination } = await access(ctx, destinationId);
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: destination.timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date());
	const date = `${parts.find((x) => x.type === "year")!.value}-${parts.find((x) => x.type === "month")!.value}-${parts.find((x) => x.type === "day")!.value}`;
	const assignments = account.assignments ?? [
		{ spaceId: account.spaceId, startsOn: "0000-01-01" },
	];
	return {
		spaceId: destinationId,
		assignments: [...assignments, { spaceId: destinationId, startsOn: date }],
	};
}

export const saveOptions = mutation({
	args: {
		id: v.id("accounts"),
		name: v.string(),
		destinationId: v.optional(v.id("spaces")),
		revision: v.number(),
	},
	handler: async (ctx, args) => {
		const account = await ctx.db.get(args.id);
		if (!account) throw new ConvexError("Account not found.");
		await access(ctx, account.spaceId);
		assertRevision(account.revision, args.revision);
		const name = label(args.name);
		let assignment: Partial<Pick<Doc<"accounts">, "spaceId" | "assignments">> =
			{};
		if (args.destinationId && args.destinationId !== account.spaceId) {
			const current = await user(ctx);
			if (account.userId !== current._id)
				throw new ConvexError(
					"Only the connecting user can move this account.",
				);
			assignment = await assignmentChange(ctx, account, args.destinationId);
		}
		await ctx.db.patch(account._id, {
			...assignment,
			name,
			revision: account.revision + 1,
		});
	},
});
