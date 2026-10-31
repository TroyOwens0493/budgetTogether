import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import * as model from "./model/projections";
import { fixedIncome, investmentType } from "./projectionTypes";

export const list = query({
	args: { spaceId: v.id("spaces") },
	handler: (ctx, args) => model.list(ctx, args.spaceId),
});
export const saveSettings = mutation({
	args: {
		spaceId: v.id("spaces"),
		currentAge: v.number(),
		targetAge: v.number(),
		cashBalance: v.number(),
		cashAnnualReturn: v.number(),
		revision: v.number(),
	},
	handler: model.saveSettings,
});
export const saveHolding = mutation({
	args: {
		id: v.optional(v.id("holdings")),
		accountId: v.optional(v.id("accounts")),
		spaceId: v.id("spaces"),
		accountName: v.string(),
		accountType: v.string(),
		name: v.string(),
		type: investmentType,
		ticker: v.string(),
		balance: v.number(),
		annualReturnOverride: v.optional(v.number()),
		monthlyContribution: v.number(),
		excluded: v.boolean(),
		fixedIncome: v.optional(fixedIncome),
		revision: v.number(),
	},
	handler: model.saveHolding,
});
export const removeHolding = mutation({
	args: { id: v.id("holdings"), revision: v.number() },
	handler: (ctx, args) => model.removeHolding(ctx, args.id, args.revision),
});
export const includeAccount = mutation({
	args: { id: v.id("accounts"), excluded: v.boolean(), revision: v.number() },
	handler: (ctx, args) =>
		model.includeCash(ctx, args.id, args.excluded, args.revision),
});
