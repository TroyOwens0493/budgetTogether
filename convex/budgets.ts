import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import * as categoriesModel from "./model/categories";
import * as fundsModel from "./model/funds";
import * as insightsModel from "./model/insights";
import * as plansModel from "./model/plans";
import * as reportingModel from "./model/reporting";
import * as spacesModel from "./model/spaces";
import * as transactionsModel from "./model/transactions";
import { kind, split } from "./schema";

export { results } from "./model/accounting";
export type Transaction = Doc<"transactions">;

export const setup = mutation({
	args: { name: v.string(), timeZone: v.string() },
	handler: spacesModel.setup,
});

export const home = query({
	args: {},
	handler: spacesModel.home,
});

export const categories = query({
	args: { spaceId: v.id("spaces") },
	handler: categoriesModel.list,
});

export const saveCategory = mutation({
	args: {
		spaceId: v.id("spaces"),
		id: v.optional(v.id("categories")),
		name: v.string(),
		color: v.string(),
		revision: v.optional(v.number()),
	},
	handler: categoriesModel.save,
});

export const deleteCategory = mutation({
	args: {
		id: v.id("categories"),
		replacementId: v.id("categories"),
		revision: v.number(),
	},
	handler: categoriesModel.remove,
});

export const dashboard = query({
	args: { spaceId: v.id("spaces"), month: v.string() },
	handler: reportingModel.dashboard,
});

export const savePlan = mutation({
	args: {
		spaceId: v.id("spaces"),
		month: v.string(),
		expectedIncome: v.number(),
		savingsTarget: v.number(),
		limits: v.array(split),
		revision: v.number(),
		fundSignature: v.optional(v.string()),
	},
	handler: plansModel.save,
});

export const funds = query({
	args: { spaceId: v.id("spaces"), month: v.string() },
	handler: fundsModel.summary,
});

export const saveFund = mutation({
	args: {
		spaceId: v.id("spaces"),
		id: v.optional(v.id("funds")),
		startMonth: v.string(),
		openingBalance: v.number(),
		name: v.string(),
		targetAmount: v.number(),
		targetMonth: v.optional(v.string()),
		intervalMonths: v.optional(v.number()),
		monthlyAmount: v.optional(v.number()),
		effectiveMonth: v.string(),
		revision: v.number(),
	},
	handler: fundsModel.save,
});

export const repeatPlan = mutation({
	args: { spaceId: v.id("spaces"), month: v.string() },
	handler: plansModel.repeat,
});

export const transactions = query({
	args: {
		spaceId: v.id("spaces"),
		month: v.string(),
		search: v.optional(v.string()),
		categoryId: v.optional(v.id("categories")),
		accountId: v.optional(v.id("accounts")),
		cursor: v.optional(v.string()),
		limit: v.optional(v.number()),
	},
	handler: transactionsModel.list,
});

export const saveTransaction = mutation({
	args: {
		spaceId: v.id("spaces"),
		id: v.optional(v.id("transactions")),
		accountId: v.id("accounts"),
		description: v.string(),
		amount: v.number(),
		date: v.string(),
		kind,
		pending: v.boolean(),
		note: v.string(),
		splits: v.array(split),
		revision: v.number(),
	},
	handler: transactionsModel.save,
});

export const deleteTransaction = mutation({
	args: { id: v.id("transactions"), revision: v.number() },
	handler: transactionsModel.remove,
});

export const reconcile = mutation({
	args: {
		manualId: v.id("transactions"),
		importId: v.id("transactions"),
		revision: v.number(),
	},
	handler: transactionsModel.reconcile,
});

export const review = mutation({
	args: {
		spaceId: v.id("spaces"),
		month: v.string(),
		allocations: v.array(
			v.object({
				categoryId: v.optional(v.id("categories")),
				amount: v.number(),
			}),
		),
		revision: v.number(),
	},
	handler: plansModel.review,
});

export const reports = query({
	args: { spaceId: v.id("spaces"), from: v.string(), to: v.string() },
	handler: reportingModel.list,
});

export const recurring = query({
	args: { spaceId: v.id("spaces") },
	handler: insightsModel.recurring,
});

export const setRecurring = mutation({
	args: {
		spaceId: v.id("spaces"),
		merchant: v.string(),
		status: v.union(v.literal("confirmed"), v.literal("dismissed")),
	},
	handler: insightsModel.setRecurring,
});

export const alerts = query({
	args: { spaceId: v.id("spaces"), month: v.string() },
	handler: insightsModel.alerts,
});

export const readAlert = mutation({
	args: { spaceId: v.id("spaces"), key: v.string() },
	handler: insightsModel.readAlert,
});

export const ensureMonth = mutation({
	args: { spaceId: v.id("spaces"), month: v.string() },
	handler: plansModel.ensure,
});
