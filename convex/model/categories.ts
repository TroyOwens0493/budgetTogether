import { ConvexError } from "convex/values";
import { assertRevision } from "../../src/domain/budget";
import { categoryNameError } from "../../src/domain/validation";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { access, type DbCtx, label } from "../access";

type Replacement = Doc<"spaces">["categoryReplacement"];
const BATCH_SIZE = 100;

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
	const { space } = await access(ctx, args.spaceId);
	return activeCategories(ctx, space);
}

export async function activeCategories(ctx: DbCtx, space: Doc<"spaces">) {
	const rows = await ctx.db
		.query("categories")
		.withIndex("by_space", (q) => q.eq("spaceId", space._id))
		.collect();
	return rows.filter(
		(row) => row._id !== space.categoryReplacement?.categoryId,
	);
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
	const { space } = await access(ctx, args.spaceId);
	const name = label(args.name);
	if (!/^#[\da-f]{6}$/i.test(args.color))
		throw new ConvexError("Choose a valid color.");
	const all = await activeCategories(ctx, space);
	const error = categoryNameError(name, all, args.id);
	if (error) throw new ConvexError(error);
	if (args.id) {
		const existing = all.find((row) => row._id === args.id);
		if (!existing) throw new ConvexError("Category not found.");
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

export async function remove(
	ctx: MutationCtx,
	args: {
		id: Id<"categories">;
		replacementId: Id<"categories">;
		revision: number;
	},
): Promise<void> {
	const category = await ctx.db.get(args.id);
	const replacement = await ctx.db.get(args.replacementId);
	if (
		!category ||
		!replacement ||
		category.spaceId !== replacement.spaceId ||
		args.id === args.replacementId
	)
		throw new ConvexError("Choose a different category in this budget.");
	const { space } = await access(ctx, category.spaceId);
	if (space.categoryReplacement)
		throw new ConvexError("A category replacement is already in progress.");
	assertRevision(category.revision, args.revision);
	await ctx.db.patch(space._id, {
		categoryReplacement: {
			categoryId: args.id,
			replacementId: args.replacementId,
		},
	});
	const id = await ctx.db.insert("categoryReplacements", {
		spaceId: space._id,
		phase: "transactions",
		cursor: null,
		step: 0,
	});
	await continueReplacement(ctx, { id, step: 0 });
}

// Keep cursor writes separate from the budget document so they do not
// invalidate every query that checks access to the budget.
export async function continueReplacement(
	ctx: MutationCtx,
	{ id, step }: { id: Id<"categoryReplacements">; step: number },
): Promise<void> {
	const job = await ctx.db.get(id);
	if (!job || job.step !== step) return;
	const space = await ctx.db.get(job.spaceId);
	const replacement = space?.categoryReplacement;
	if (!space || !replacement) {
		await ctx.db.delete(id);
		return;
	}
	const options = {
		cursor: job.cursor,
		numItems: BATCH_SIZE,
		maximumRowsRead: BATCH_SIZE,
		maximumBytesRead: 512_000,
	};
	const advance = async (
		page: { isDone: boolean; continueCursor: string },
		next?: Doc<"categoryReplacements">["phase"],
	) => {
		if (page.isDone && !next) {
			await ctx.db.delete(replacement.categoryId);
			await ctx.db.patch(space._id, { categoryReplacement: undefined });
			await ctx.db.delete(id);
			return;
		}
		await ctx.db.patch(id, {
			phase: page.isDone && next ? next : job.phase,
			cursor: page.isDone ? null : page.continueCursor,
			step: step + 1,
		});
		await ctx.scheduler.runAfter(
			0,
			internal.budgets.continueCategoryReplacement,
			{
				id,
				step: step + 1,
			},
		);
	};
	if (job.phase === "transactions") {
		// Dates can change during a bank sync or manual edit. The index walks
		// immutable creation times, so those edits cannot move a row past the cursor.
		const page = await ctx.db
			.query("transactions")
			.withIndex("by_space", (q) =>
				q.eq("spaceId", space._id).lte("_creationTime", job._creationTime),
			)
			.paginate(options);
		for (const row of page.page) {
			const splits = replaceSplits(row.splits, replacement);
			if (splits !== row.splits)
				await ctx.db.patch(row._id, { splits, revision: row.revision + 1 });
		}
		await advance(page, "plans");
	} else if (job.phase === "plans") {
		const page = await ctx.db
			.query("plans")
			.withIndex("by_month", (q) => q.eq("spaceId", space._id))
			.paginate(options);
		// The old operation bumped every existing plan, even if its limits
		// did not change. Plans created since the replacement already use active IDs.
		for (const row of page.page)
			if (row._creationTime <= job._creationTime)
				await ctx.db.patch(row._id, {
					limits: replaceLimits(row.limits, replacement),
					revision: row.revision + 1,
				});
		await advance(page, "carry");
	} else {
		const page = await ctx.db
			.query("carry")
			.withIndex("by_source", (q) => q.eq("spaceId", space._id))
			.paginate(options);
		for (const row of page.page)
			if (row.categoryId === replacement.categoryId)
				await ctx.db.patch(row._id, { categoryId: replacement.replacementId });
		await advance(page);
	}
}

export function replaceSplits(
	splits: Doc<"transactions">["splits"],
	replacement: Replacement,
) {
	if (
		!replacement ||
		!splits.some((row) => row.categoryId === replacement.categoryId)
	)
		return splits;
	return splits.map((row) =>
		row.categoryId === replacement.categoryId
			? { ...row, categoryId: replacement.replacementId }
			: row,
	);
}

export function replaceLimits(
	limits: Doc<"plans">["limits"],
	replacement: Replacement,
) {
	if (!replacement) return limits;
	const amounts = new Map<Id<"categories">, number>();
	for (const row of limits) {
		const id =
			row.categoryId === replacement.categoryId
				? replacement.replacementId
				: row.categoryId;
		amounts.set(id, (amounts.get(id) ?? 0) + row.amount);
	}
	return [...amounts].map(([categoryId, amount]) => ({ categoryId, amount }));
}

export function replaceCarry(row: Doc<"carry">, replacement: Replacement) {
	return replacement && row.categoryId === replacement.categoryId
		? { ...row, categoryId: replacement.replacementId }
		: row;
}
