import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { classifyTransaction, JevError } from "./jevClient";
import * as model from "./model/transactionClassification";
import { kind } from "./schema";

const job = {
	id: v.id("transactions"),
	revision: v.number(),
	attempt: v.number(),
	leaseUntil: v.number(),
};
export const claim = internalMutation({
	args: { id: v.id("transactions") },
	handler: model.claim,
});
export const complete = internalMutation({
	args: {
		...job,
		categoriesKey: v.string(),
		result: v.object({
			kind,
			categoryId: v.optional(v.id("categories")),
			kindConfidence: v.number(),
			categoryConfidence: v.number(),
			model: v.string(),
		}),
	},
	handler: model.complete,
});
export const failed = internalMutation({
	args: { ...job, error: v.string() },
	handler: model.failed,
});
export const poll = internalMutation({ args: {}, handler: model.poll });
export const classify = internalAction({
	args: { id: v.id("transactions") },
	handler: async (ctx, args): Promise<void> => {
		const state = await ctx.runMutation(internal.classification.claim, args);
		if (!state) return;
		const { input, categoriesKey, ...job } = state;
		try {
			const { categoryId, ...result } = await classifyTransaction(input);
			await ctx.runMutation(internal.classification.complete, {
				...job,
				categoriesKey,
				result: {
					...result,
					...(categoryId ? { categoryId: categoryId as Id<"categories"> } : {}),
				},
			});
		} catch (error) {
			await ctx.runMutation(internal.classification.failed, {
				...job,
				error:
					error instanceof JevError ? error.code : "JEV_CLASSIFICATION_FAILED",
			});
		}
	},
});
