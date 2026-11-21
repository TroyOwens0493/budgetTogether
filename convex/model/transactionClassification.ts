import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { type Classification, JEV_REVIEW_CONFIDENCE } from "../jevClient";

const LEASE_MS = 60_000;
export async function queue(ctx: MutationCtx, id: Id<"transactions">) {
	await ctx.db.patch(id, {
		classificationStatus: "pending",
		classificationRetryAt: 0,
		classificationAttempts: 0,
		classificationError: undefined,
	});
	await ctx.scheduler.runAfter(0, internal.classification.classify, { id });
}
async function categoriesFor(ctx: MutationCtx, spaceId: Id<"spaces">) {
	const rows = await ctx.db
		.query("categories")
		.withIndex("by_space", (q) => q.eq("spaceId", spaceId))
		.take(255);
	return rows
		.map((row) => ({ id: String(row._id), name: row.name }))
		.sort((a, b) => a.id.localeCompare(b.id));
}
function eligible(row: Doc<"transactions"> | null): boolean {
	return !!row && row.source === "plaid" && !row.edited && !row.removed;
}
export async function claim(
	ctx: MutationCtx,
	{ id }: { id: Id<"transactions"> },
) {
	const row = await ctx.db.get(id);
	if (!row || !eligible(row)) {
		if (row?.classificationStatus === "pending")
			await ctx.db.patch(id, {
				classificationStatus: row.edited ? "manual" : "skipped",
				classificationRetryAt: undefined,
			});
		return null;
	}
	if (
		row.classificationStatus !== "pending" ||
		(row.classificationRetryAt ?? 0) > Date.now()
	)
		return null;
	const account = await ctx.db.get(row.accountId);
	if (!account) return null;
	const categories = await categoriesFor(ctx, row.spaceId);
	const attempt = (row.classificationAttempts ?? 0) + 1;
	const leaseUntil = Date.now() + LEASE_MS;
	await ctx.db.patch(id, {
		classificationAttempts: attempt,
		classificationRetryAt: leaseUntil,
	});
	// Recover a terminated action. A completed or rescheduled job makes this a no-op.
	await ctx.scheduler.runAfter(LEASE_MS, internal.classification.classify, {
		id,
	});
	return {
		id,
		revision: row.revision,
		attempt,
		leaseUntil,
		categoriesKey: JSON.stringify(categories),
		input: {
			description: row.bankDescription ?? row.description,
			...(row.bankMerchant ? { merchant: row.bankMerchant } : {}),
			amount: row.amount,
			date: row.date,
			pending: row.pending,
			accountType: account.type,
			categories,
		},
	};
}
export type Job = NonNullable<Awaited<ReturnType<typeof claim>>>;
async function current(
	ctx: MutationCtx,
	job: Pick<Job, "id" | "revision" | "attempt" | "leaseUntil">,
) {
	const row = await ctx.db.get(job.id);
	return row &&
		eligible(row) &&
		row.revision === job.revision &&
		row.classificationStatus === "pending" &&
		row.classificationAttempts === job.attempt &&
		row.classificationRetryAt === job.leaseUntil
		? row
		: null;
}
export async function complete(
	ctx: MutationCtx,
	args: Pick<
		Job,
		"id" | "revision" | "attempt" | "leaseUntil" | "categoriesKey"
	> & { result: Classification },
) {
	const row = await current(ctx, args);
	if (!row) return;
	if (
		JSON.stringify(await categoriesFor(ctx, row.spaceId)) !== args.categoriesKey
	) {
		await queue(ctx, row._id);
		return;
	}
	const { result } = args;
	const category = result.categoryId
		? await ctx.db.get(result.categoryId as Id<"categories">)
		: null;
	if (result.categoryId && category?.spaceId !== row.spaceId)
		throw new Error(
			"Classification category must belong to the transaction budget.",
		);
	const needsReview =
		result.kindConfidence < JEV_REVIEW_CONFIDENCE ||
		(result.kind === "purchase" &&
			(!category || result.categoryConfidence < JEV_REVIEW_CONFIDENCE));
	await ctx.db.patch(row._id, {
		kind: result.kind,
		suggestedKind: result.kind,
		splits:
			result.kind === "purchase" && category
				? [{ categoryId: category._id, amount: row.amount }]
				: [],
		classificationStatus: needsReview ? "review" : "classified",
		classificationRetryAt: undefined,
		classificationError: undefined,
		classification: {
			model: result.model,
			kindConfidence: result.kindConfidence,
			categoryConfidence: result.categoryConfidence,
			classifiedAt: Date.now(),
		},
		revision: row.revision + 1,
	});
}
export async function failed(
	ctx: MutationCtx,
	args: Pick<Job, "id" | "revision" | "attempt" | "leaseUntil"> & {
		error: string;
	},
) {
	if (!(await current(ctx, args))) return;
	const delay = Math.min(
		6 * 60 * 60_000,
		30_000 * 2 ** Math.min(args.attempt - 1, 10),
	);
	await ctx.db.patch(args.id, {
		classificationError: args.error,
		classificationRetryAt: Date.now() + delay,
	});
	await ctx.scheduler.runAfter(delay, internal.classification.classify, {
		id: args.id,
	});
}
// The index lets each pass discover old imports and due retries without a full scan.
// No cursor is needed: assigning a status removes a legacy row from the next pass.
export async function poll(ctx: MutationCtx) {
	const legacy = await ctx.db
		.query("transactions")
		.withIndex("by_classification", (q) =>
			q.eq("source", "plaid").eq("classificationStatus", undefined),
		)
		.take(50);
	for (const row of legacy) {
		if (eligible(row)) await queue(ctx, row._id);
		else
			await ctx.db.patch(row._id, {
				classificationStatus: row.edited ? "manual" : "skipped",
			});
	}
	if (legacy.length === 50)
		await ctx.scheduler.runAfter(1_000, internal.classification.poll, {});
	const due = await ctx.db
		.query("transactions")
		.withIndex("by_classification", (q) =>
			q
				.eq("source", "plaid")
				.eq("classificationStatus", "pending")
				.lte("classificationRetryAt", Date.now()),
		)
		.take(50);
	for (const row of due)
		await ctx.scheduler.runAfter(0, internal.classification.classify, {
			id: row._id,
		});
}
