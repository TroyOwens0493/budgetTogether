import type { Doc, Id } from "../_generated/dataModel";
import type { DbCtx } from "../access";

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
