import { ConvexError } from "convex/values";
import { assertRevision } from "../../src/domain/budget";
import { categoryNameError } from "../../src/domain/validation";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { access, label, readCutoff } from "../access";

export async function list(ctx: QueryCtx, args: { spaceId: Id<"spaces"> }) {
	await access(ctx, args.spaceId);
	const cutoff = await readCutoff(ctx, args.spaceId);
	return ctx.db
		.query("categories")
		.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
		.filter((q) =>
			q.lte(
				q.field("_creationTime"),
				Number.isFinite(cutoff) ? cutoff : Number.MAX_SAFE_INTEGER,
			),
		)
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
	await access(ctx, args.spaceId, true);
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
		const existing = await ctx.db.get(args.id);
		if (!existing || existing.spaceId !== args.spaceId)
			throw new ConvexError("Category not found.");
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
	await access(ctx, category.spaceId, true);
	assertRevision(category.revision, args.revision);
	const transactions = await ctx.db
		.query("transactions")
		.withIndex("by_space_date", (q) => q.eq("spaceId", category.spaceId))
		.collect();
	for (const entry of transactions)
		if (entry.splits.some((x) => x.categoryId === args.id))
			await ctx.db.patch(entry._id, {
				splits: entry.splits.map((x) => ({
					...x,
					categoryId:
						x.categoryId === args.id ? args.replacementId : x.categoryId,
				})),
				revision: entry.revision + 1,
			});
	const plans = await ctx.db
		.query("plans")
		.withIndex("by_month", (q) => q.eq("spaceId", category.spaceId))
		.collect();
	for (const plan of plans) {
		const amounts = new Map<Id<"categories">, number>();
		for (const x of plan.limits) {
			const id = x.categoryId === args.id ? args.replacementId : x.categoryId;
			amounts.set(id, (amounts.get(id) ?? 0) + x.amount);
		}
		await ctx.db.patch(plan._id, {
			limits: [...amounts].map(([categoryId, amount]) => ({
				categoryId,
				amount,
			})),
			revision: plan.revision + 1,
		});
	}
	const carries = await ctx.db
		.query("carry")
		.withIndex("by_source", (q) => q.eq("spaceId", category.spaceId))
		.collect();
	for (const carry of carries)
		if (carry.categoryId === args.id)
			await ctx.db.patch(carry._id, { categoryId: args.replacementId });
	await ctx.db.delete(args.id);
}
