import { v } from "convex/values";

export const investmentType = v.union(
	v.literal("stock"),
	v.literal("etf"),
	v.literal("mutualFund"),
	v.literal("bond"),
	v.literal("cd"),
	v.literal("cash"),
	v.literal("unsupported"),
);
export const fixedIncome = v.object({
	faceValue: v.optional(v.number()),
	couponRate: v.optional(v.number()),
	paymentsPerYear: v.optional(v.number()),
	nextPaymentDate: v.optional(v.string()),
	maturityDate: v.optional(v.string()),
	apy: v.optional(v.number()),
});
export const importedHolding = v.object({
	externalId: v.string(),
	name: v.string(),
	type: investmentType,
	ticker: v.optional(v.string()),
	balance: v.optional(v.number()),
	asOf: v.optional(v.string()),
	currency: v.string(),
	problem: v.optional(v.string()),
	fixedIncome: v.optional(fixedIncome),
});
