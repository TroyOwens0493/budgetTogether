import { v } from "convex/values";

export const txValidator = v.object({
	transaction_id: v.string(),
	account_id: v.string(),
	pending_transaction_id: v.optional(v.union(v.string(), v.null())),
	name: v.string(),
	merchant_name: v.optional(v.union(v.string(), v.null())),
	amount: v.number(),
	date: v.string(),
	pending: v.boolean(),
	personal_finance_category: v.optional(
		v.union(v.object({ primary: v.string(), detailed: v.string() }), v.null()),
	),
});
export const removedValidator = v.object({
	transaction_id: v.string(),
	account_id: v.string(),
});
export const SYNC_BATCH_SIZE = 100;
