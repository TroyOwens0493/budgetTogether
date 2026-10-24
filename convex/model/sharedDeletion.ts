import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { privateSpace } from "../access";
import { forgetImport } from "./bankImport";

function localDate(time: number, timeZone: string) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date(time));
	const values = Object.fromEntries(
		parts.map((part) => [part.type, part.value]),
	);
	return `${values.year}-${values.month}-${values.day}`;
}

/** Remove access and funding together; keep accounts and private records intact. */
export async function remove(ctx: MutationCtx, space: Doc<"spaces">) {
	const members = await ctx.db
		.query("memberships")
		.withIndex("by_space", (q) => q.eq("spaceId", space._id))
		.collect();
	const allocations = await ctx.db
		.query("personalAllocations")
		.withIndex("by_shared", (q) => q.eq("sharedId", space._id))
		.collect();
	const contributions = await ctx.db
		.query("contributions")
		.withIndex("by_shared", (q) => q.eq("sharedId", space._id))
		.collect();
	const today = localDate(Date.now(), space.timeZone);
	for (const member of members) {
		const personal = await privateSpace(ctx, member.userId);
		const accounts = await ctx.db
			.query("accounts")
			.withIndex("by_user", (q) => q.eq("userId", member.userId))
			.collect();
		for (const account of accounts) {
			const moving = account.spaceId === space._id;
			const assignments = account.assignments ?? [
				{ spaceId: account.spaceId, startsOn: "0000-01-01" },
			];
			if (!moving && !assignments.some((a) => a.spaceId === space._id))
				continue;
			await ctx.db.patch(account._id, {
				spaceId: moving ? personal._id : account.spaceId,
				// A null interval prevents bank sync from restoring deleted history.
				assignments: [
					...assignments.map((a) => ({
						...a,
						spaceId: a.spaceId === space._id ? null : a.spaceId,
					})),
					...(moving ? [{ spaceId: personal._id, startsOn: today }] : []),
				],
				revision: account.revision + 1,
			});
		}
		// Removing household funding changes the validity of these personal plans.
		const start = localDate(member.joinedAt, space.timeZone).slice(0, 7);
		const end = member.active
			? "9999-12"
			: localDate(member.leftAt ?? 0, space.timeZone).slice(0, 7);
		const fundingMonths = new Set(
			[...allocations, ...contributions]
				.filter((row) => row.privateId === personal._id)
				.map((row) => row.month),
		);
		const plans = await ctx.db
			.query("plans")
			.withIndex("by_month", (q) => q.eq("spaceId", personal._id))
			.collect();
		for (const plan of plans)
			if (
				(plan.month >= start && plan.month <= end) ||
				fundingMonths.has(plan.month)
			)
				await ctx.db.patch(plan._id, {
					saved: false,
					status: undefined,
					reviewed: false,
					revision: plan.revision + 1,
				});
		const reads = await ctx.db
			.query("alertReads")
			.withIndex("by_user", (q) => q.eq("userId", member.userId))
			.collect();
		for (const read of reads)
			if (read.key.startsWith(`${space._id}:`)) await ctx.db.delete(read._id);
		await ctx.db.delete(member._id);
	}
	// These records also affect private totals, so delete them in the same commit.
	for (const row of [...allocations, ...contributions])
		await ctx.db.delete(row._id);
	const invitations = await ctx.db
		.query("invitations")
		.withIndex("by_space", (q) => q.eq("spaceId", space._id))
		.collect();
	for (const invitation of invitations) await ctx.db.delete(invitation._id);
	await ctx.db.delete(space._id);
	await purge(ctx, { spaceId: space._id });
}

/** Bound transaction-history deletion so large budgets finish in durable batches. */
export async function purge(
	ctx: MutationCtx,
	{ spaceId }: { spaceId: Id<"spaces"> },
) {
	if (await ctx.db.get(spaceId)) return;
	const queries = [
		ctx.db
			.query("transactions")
			.withIndex("by_space_date", (q) => q.eq("spaceId", spaceId)),
		ctx.db
			.query("plans")
			.withIndex("by_month", (q) => q.eq("spaceId", spaceId)),
		ctx.db
			.query("categories")
			.withIndex("by_space", (q) => q.eq("spaceId", spaceId)),
		ctx.db
			.query("funds")
			.withIndex("by_space", (q) => q.eq("spaceId", spaceId)),
		ctx.db
			.query("carry")
			.withIndex("by_source", (q) => q.eq("spaceId", spaceId)),
		ctx.db
			.query("recurring")
			.withIndex("by_space", (q) => q.eq("spaceId", spaceId)),
		ctx.db
			.query("projectionSettings")
			.withIndex("by_space", (q) => q.eq("spaceId", spaceId)),
	];
	let remaining = 100;
	for (const query of queries) {
		const rows = await query.take(remaining);
		for (const row of rows) {
			if ("source" in row) await forgetImport(ctx, row);
			await ctx.db.delete(row._id);
		}
		remaining -= rows.length;
		if (remaining === 0) {
			await ctx.scheduler.runAfter(0, internal.sharing.purge, { spaceId });
			return;
		}
	}
}
