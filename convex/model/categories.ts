import { ConvexError } from "convex/values";
import { assertRevision } from "../../src/domain/budget";
import { categoryNameError } from "../../src/domain/validation";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { access, label } from "../access";

/** Standard categories for a new budget; no private categories are copied. */
export async function createDefaults(ctx: MutationCtx, spaceId: Id<"spaces">) {
	for (const [order, [name, color]] of [
		["Housing", "#9daf87"],
		["Groceries", "#90ac75"],
		["Dining out", "#d5ac65"],
		["Entertainment", "#ada9cf"],
		["Transport", "#d89774"],
		["Other", "#83aaa2"],
	].entries())
		await ctx.db.insert("categories", {
			spaceId,
			name,
			color,
			order,
			revision: 0,
		});
}

export async function list(ctx: QueryCtx, args: { spaceId: Id<"spaces"> }) {
	await access(ctx, args.spaceId);
	return ctx.db
		.query("categories")
		.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
		.collect();
}

export async function save(
	ctx: MutationCtx,
	args: {
		spaceId: Id<"spaces">;
		id?: Id<"categories">;
		name: string;
		color: string;
		revision?: number;
	},
) {
	await access(ctx, args.spaceId);
	const name = label(args.name);
	if (!/^#[\da-f]{6}$/i.test(args.color))
		throw new ConvexError("Choose a valid color.");
	const all = await ctx.db
		.query("categories")
		.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
		.collect();
	const error = categoryNameError(name, all, args.id);
	if (error) throw new ConvexError(error);
	if (args.id) {
		const existing = all.find((category) => category._id === args.id);
		if (!existing)
			throw new ConvexError(
				"This category no longer exists. It may have been deleted in another tab or by your partner.",
			);
		assertNotMerging(existing);
		assertRevision(existing.revision, args.revision ?? -1);
		await ctx.db.patch(args.id, {
			name,
			color: args.color,
			revision: existing.revision + 1,
		});
		return args.id;
	}
	return ctx.db.insert("categories", {
		spaceId: args.spaceId,
		name,
		color: args.color,
		order: all.length,
		revision: 0,
	});
}

function assertNotMerging(category: Doc<"categories">) {
	if (category.mergingInto)
		throw new ConvexError(
			"This category is being deleted. Choose a different category, or wait a moment and reload.",
		);
}

export async function validateCategory(
	ctx: MutationCtx,
	spaceId: Id<"spaces">,
	id: Id<"categories">,
	invalidMessage = "Choose categories from this budget.",
) {
	const category = await ctx.db.get(id);
	if (category?.spaceId !== spaceId) throw new ConvexError(invalidMessage);
	assertNotMerging(category);
}

// Copies can come from rows that the merge has yet to scan.
export async function resolveCategories<
	T extends { categoryId?: Id<"categories"> },
>(ctx: MutationCtx, rows: T[]): Promise<T[]> {
	const replacements = new Map<Id<"categories">, Id<"categories">>();
	for (const id of new Set(rows.map((row) => row.categoryId))) {
		if (!id) continue;
		const target = (await ctx.db.get(id))?.mergingInto;
		if (target) replacements.set(id, target);
	}
	if (!replacements.size) return rows;
	return rows.map((row) => {
		const target = row.categoryId && replacements.get(row.categoryId);
		return target ? { ...row, categoryId: target } : row;
	});
}

function sumLimits(limits: Doc<"plans">["limits"]) {
	const amounts = new Map<Id<"categories">, number>();
	for (const { categoryId, amount } of limits)
		amounts.set(categoryId, (amounts.get(categoryId) ?? 0) + amount);
	return [...amounts].map(([categoryId, amount]) => ({ categoryId, amount }));
}

export async function resolveLimits(
	ctx: MutationCtx,
	limits: Doc<"plans">["limits"],
) {
	const resolved = await resolveCategories(ctx, limits);
	return resolved === limits ? limits : sumLimits(resolved);
}

export async function remove(
	ctx: MutationCtx,
	args: {
		id: Id<"categories">;
		replacementId: Id<"categories">;
		revision: number;
	},
) {
	const category = await ctx.db.get(args.id);
	const replacement = await ctx.db.get(args.replacementId);
	if (
		!category ||
		!replacement ||
		category.spaceId !== replacement.spaceId ||
		args.id === args.replacementId
	)
		throw new ConvexError("Choose a different category in this budget.");
	await access(ctx, category.spaceId);
	assertNotMerging(category);
	assertNotMerging(replacement);
	assertRevision(category.revision, args.revision);
	const categories = await ctx.db
		.query("categories")
		.withIndex("by_space", (q) => q.eq("spaceId", category.spaceId))
		.collect();
	if (categories.some((row) => row.mergingInto === args.id))
		throw new ConvexError(
			"Wait for the other category deletion to finish, then try again.",
		);
	await ctx.db.patch(args.id, { mergingInto: args.replacementId });
	await continueReplacement(ctx, { id: args.id, phase: "plans", cursor: null });
}

type Phase = "plans" | "carry" | "transactions";
const BATCH_SIZE = 100;

export async function continueReplacement(
	ctx: MutationCtx,
	{
		id,
		phase,
		cursor,
	}: { id: Id<"categories">; phase: Phase; cursor: string | null },
): Promise<void> {
	const category = await ctx.db.get(id);
	if (!category?.mergingInto || !(await ctx.db.get(category.spaceId))) return;
	const { spaceId, mergingInto } = category;
	const options = {
		cursor,
		numItems: BATCH_SIZE,
		maximumRowsRead: BATCH_SIZE,
		maximumBytesRead: 512_000,
	};
	const advance = async (
		page: { isDone: boolean; continueCursor: string },
		next?: Phase,
	) => {
		if (page.isDone && !next) {
			await ctx.db.delete(id);
			return;
		}
		await ctx.scheduler.runAfter(
			0,
			internal.budgets.continueCategoryReplacement,
			{
				id,
				phase: page.isDone && next ? next : phase,
				cursor: page.isDone ? null : page.continueCursor,
			},
		);
	};
	const replace = <T extends { categoryId: Id<"categories"> }>(row: T): T =>
		row.categoryId === id ? { ...row, categoryId: mergingInto } : row;

	if (phase === "plans") {
		// The first page runs inline. New plans are created ahead of this
		// descending cursor and already use the replacement where needed.
		const page = await ctx.db
			.query("plans")
			.withIndex("by_space", (q) => q.eq("spaceId", spaceId))
			.order("desc")
			.paginate(options);
		for (const plan of page.page)
			await ctx.db.patch(plan._id, {
				limits: sumLimits(plan.limits.map(replace)),
				revision: plan.revision + 1,
			});
		await advance(page, "carry");
	} else if (phase === "carry") {
		const page = await ctx.db
			.query("carry")
			.withIndex("by_source", (q) => q.eq("spaceId", spaceId))
			.paginate(options);
		for (const carry of page.page)
			if (carry.categoryId === id)
				await ctx.db.patch(carry._id, { categoryId: mergingInto });
		await advance(page, "transactions");
	} else {
		// Creation time keeps edits to transaction dates from moving rows
		// across the cursor and lets new rows extend the scan.
		const page = await ctx.db
			.query("transactions")
			.withIndex("by_space", (q) => q.eq("spaceId", spaceId))
			.paginate(options);
		for (const entry of page.page)
			if (entry.splits.some((split) => split.categoryId === id))
				await ctx.db.patch(entry._id, {
					splits: entry.splits.map(replace),
					revision: entry.revision + 1,
				});
		await advance(page);
	}
}
