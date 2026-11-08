import { ConvexError } from "convex/values";
import {
	money,
	nextMonth,
	personalFundingRequired,
} from "../../src/domain/budget";
import { fundingSignature } from "../../src/domain/personal-funding-draft";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { DbCtx } from "../access";
import { internalSummary } from "./funds";

function calendarMonth(time: number, timeZone: string) {
	const parts = new Intl.DateTimeFormat("en", {
		timeZone,
		year: "numeric",
		month: "2-digit",
	}).formatToParts(new Date(time));
	const values = Object.fromEntries(
		parts.map((part) => [part.type, part.value]),
	);
	return `${values.year}-${values.month}`;
}

/** Monthly funding starts in the month a person joins; earlier results stay intact. */
export async function sharedForPersonal(
	ctx: DbCtx,
	space: Doc<"spaces">,
	month: string,
) {
	if (space.type !== "private") return null;
	const memberships = await ctx.db
		.query("memberships")
		.withIndex("by_user", (q) => q.eq("userId", space.ownerId))
		.collect();
	for (const membership of memberships) {
		const shared = await ctx.db.get(membership.spaceId);
		if (
			!membership.active ||
			shared?.type !== "shared" ||
			month < calendarMonth(membership.joinedAt, shared.timeZone)
		)
			continue;
		return shared._id;
	}
	return null;
}

/** Internal lookup; callers expose only names and funding amounts, never private records. */
export async function recipients(
	ctx: DbCtx,
	sharedId: Id<"spaces">,
	month: string,
) {
	const shared = await ctx.db.get(sharedId);
	if (shared?.type !== "shared") return [];
	const memberships = await ctx.db
		.query("memberships")
		.withIndex("by_space", (q) => q.eq("spaceId", sharedId))
		.collect();
	const result = [];
	for (const membership of memberships) {
		if (
			!membership.active ||
			month < calendarMonth(membership.joinedAt, shared.timeZone)
		)
			continue;
		const spaces = await ctx.db
			.query("memberships")
			.withIndex("by_user", (q) => q.eq("userId", membership.userId))
			.collect();
		for (const own of spaces) {
			const personal = await ctx.db.get(own.spaceId);
			if (
				personal?.type !== "private" ||
				personal.ownerId !== membership.userId
			)
				continue;
			const profile = await ctx.db
				.query("profiles")
				.withIndex("by_user", (q) => q.eq("userId", membership.userId))
				.unique();
			result.push({
				privateId: personal._id,
				name: profile?.name ?? "Partner",
				active: membership.active,
			});
			break;
		}
	}
	return result;
}

/** Expose only each total to the household; private plan details stay internal. */
export async function allocations(
	ctx: DbCtx,
	sharedId: Id<"spaces">,
	month: string,
) {
	const people = await recipients(ctx, sharedId, month);
	const rows = await ctx.db
		.query("personalAllocations")
		.withIndex("by_shared", (q) =>
			q.eq("sharedId", sharedId).eq("month", month),
		)
		.collect();
	return Promise.all(
		people.map(async (person) => {
			const row = rows.find((x) => x.privateId === person.privateId);
			if (row)
				return {
					...person,
					amount: row.amount,
					revision: row.revision,
					automatic: false,
				};
			const plan = await ctx.db
				.query("plans")
				.withIndex("by_month", (q) =>
					q.eq("spaceId", person.privateId).lt("month", nextMonth(month)),
				)
				.order("desc")
				.first();
			const carry = await ctx.db
				.query("carry")
				.withIndex("by_destination", (q) =>
					q.eq("spaceId", person.privateId).eq("destinationMonth", month),
				)
				.collect();
			const funds = await internalSummary(ctx, {
				spaceId: person.privateId,
				month,
			});
			return {
				...person,
				amount: personalFundingRequired(
					plan,
					funds.total,
					carry.reduce((sum, x) => sum + x.amount, 0),
				),
				revision: 0,
				automatic: true,
			};
		}),
	);
}

/** Runs inside the budget mutation, so amounts and the balanced plan commit together. */
export async function saveWithPlan(
	ctx: MutationCtx,
	sharedId: Id<"spaces">,
	month: string,
	draft: {
		signature: string;
		changes: { privateId: Id<"spaces">; amount: number }[];
	},
) {
	const people = await allocations(ctx, sharedId, month);
	if (fundingSignature(people) !== draft.signature)
		throw new ConvexError(
			"Personal funding changed. Load the current plan before saving.",
		);
	const seen = new Set<string>();
	for (const change of draft.changes) {
		money(change.amount, true);
		const person = people.find(
			(x) => x.privateId === change.privateId && x.active,
		);
		if (!person || seen.has(change.privateId))
			throw new ConvexError(
				"Choose each active member's personal budget once.",
			);
		seen.add(change.privateId);
		if (change.amount === person.amount) continue;
		const old = await ctx.db
			.query("personalAllocations")
			.withIndex("by_private", (q) =>
				q.eq("privateId", change.privateId).eq("month", month),
			)
			.filter((q) => q.eq(q.field("sharedId"), sharedId))
			.unique();
		if (old)
			await ctx.db.patch(old._id, {
				amount: change.amount,
				revision: old.revision + 1,
			});
		else
			await ctx.db.insert("personalAllocations", {
				sharedId,
				privateId: change.privateId,
				month,
				amount: change.amount,
				revision: 1,
			});
		const plan = await ctx.db
			.query("plans")
			.withIndex("by_month", (q) =>
				q.eq("spaceId", change.privateId).eq("month", month),
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
