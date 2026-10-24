import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { removedValidator, txValidator } from "./bankTypes";
import { fixedIncome, investmentType } from "./projectionTypes";
export const split = v.object({
	categoryId: v.id("categories"),
	amount: v.number(),
	fundId: v.optional(v.id("funds")),
});
export const fundSchedule = v.object({
	effectiveMonth: v.string(),
	name: v.string(),
	targetAmount: v.number(),
	targetMonth: v.optional(v.string()),
	intervalMonths: v.optional(v.number()),
	monthlyAmount: v.optional(v.number()),
	createdAt: v.number(),
});
export const kind = v.union(
	v.literal("purchase"),
	v.literal("income"),
	v.literal("transfer"),
);
export const bankAccount = v.object({
	account_id: v.string(),
	name: v.string(),
	type: v.string(),
	subtype: v.union(v.string(), v.null()),
	mask: v.union(v.string(), v.null()),
	persistent_account_id: v.optional(v.union(v.string(), v.null())),
	balances: v.optional(
		v.object({
			current: v.union(v.number(), v.null()),
			iso_currency_code: v.optional(v.union(v.string(), v.null())),
			unofficial_currency_code: v.optional(v.union(v.string(), v.null())),
		}),
	),
});
export default defineSchema({
	// Keep starter tables so an existing development deployment can migrate safely.
	products: defineTable({
		title: v.string(),
		imageId: v.string(),
		price: v.number(),
	}),
	todos: defineTable({ text: v.string(), completed: v.boolean() }),
	profiles: defineTable({
		userId: v.string(),
		name: v.string(),
		email: v.string(),
		timeZone: v.string(),
	}).index("by_user", ["userId"]),
	spaces: defineTable({
		name: v.string(),
		type: v.union(v.literal("private"), v.literal("shared")),
		ownerId: v.string(),
		timeZone: v.string(),
	}),
	memberships: defineTable({
		spaceId: v.id("spaces"),
		userId: v.string(),
		active: v.boolean(),
		joinedAt: v.number(),
		leftAt: v.optional(v.number()),
	})
		.index("by_user", ["userId"])
		.index("by_space", ["spaceId"]),
	invitations: defineTable({
		spaceId: v.id("spaces"),
		inviterId: v.string(),
		email: v.string(),
		tokenHash: v.string(),
		expiresAt: v.number(),
		status: v.union(
			v.literal("pending"),
			v.literal("accepted"),
			v.literal("revoked"),
		),
		delivery: v.string(),
	})
		.index("by_hash", ["tokenHash"])
		.index("by_space", ["spaceId"]),
	connections: defineTable({
		userId: v.string(),
		itemId: v.string(),
		institution: v.string(),
		institutionId: v.string(),
		accessToken: v.string(),
		product: v.optional(v.literal("investments")),
		investmentSyncAt: v.optional(v.number()),
		cursor: v.optional(v.string()),
		syncRunId: v.optional(v.id("bankSyncRuns")),
		pendingAccounts: v.optional(v.array(bankAccount)),
		status: v.string(),
		lastSync: v.optional(v.number()),
		error: v.optional(v.string()),
	})
		.index("by_user", ["userId"])
		.index("by_item", ["itemId"]),
	bankSyncRuns: defineTable({
		connectionId: v.id("connections"),
		startCursor: v.optional(v.string()),
		cursor: v.optional(v.string()),
		pages: v.number(),
		position: v.number(),
		phase: v.union(
			v.literal("fetching"),
			v.literal("changes"),
			v.literal("removals"),
		),
		restarts: v.number(),
		paused: v.optional(v.boolean()),
		watchdogAt: v.optional(v.number()),
	}),
	bankSyncBatches: defineTable({
		runId: v.id("bankSyncRuns"),
		page: v.number(),
		changed: v.array(txValidator),
		removed: v.array(removedValidator),
	}).index("by_run_page", ["runId", "page"]),
	accounts: defineTable({
		userId: v.string(),
		connectionId: v.optional(v.id("connections")),
		externalId: v.optional(v.string()),
		persistentId: v.optional(v.string()),
		spaceId: v.id("spaces"),
		name: v.string(),
		type: v.string(),
		mask: v.string(),
		active: v.boolean(),
		revision: v.number(),
		investment: v.optional(v.boolean()),
		balance: v.optional(v.number()),
		balanceAsOf: v.optional(v.number()),
		currency: v.optional(v.string()),
		projectionCashExcluded: v.optional(v.boolean()),
		assignments: v.optional(
			v.array(
				v.object({
					spaceId: v.union(v.id("spaces"), v.null()),
					startsOn: v.string(),
				}),
			),
		),
	})
		.index("by_space", ["spaceId"])
		.index("by_user", ["userId"])
		.index("by_external", ["connectionId", "externalId"])
		.index("by_persistent", ["persistentId"]),
	// Bank identifiers only: prevent sync from recreating permanently deleted entries.
	ignoredBankTransactions: defineTable({
		accountId: v.id("accounts"),
		externalId: v.string(),
	}).index("by_external", ["accountId", "externalId"]),
	projectionSettings: defineTable({
		spaceId: v.id("spaces"),
		currentAge: v.number(),
		targetAge: v.number(),
		ageAsOf: v.string(),
		cashBalance: v.number(),
		cashAnnualReturn: v.number(),
		revision: v.number(),
	}).index("by_space", ["spaceId"]),
	holdings: defineTable({
		accountId: v.id("accounts"),
		externalId: v.optional(v.string()),
		name: v.string(),
		type: investmentType,
		ticker: v.optional(v.string()),
		balance: v.optional(v.number()),
		asOf: v.optional(v.string()),
		currency: v.string(),
		problem: v.optional(v.string()),
		fixedIncome: v.optional(fixedIncome),
		fixedIncomeOverride: v.optional(fixedIncome),
		annualReturnOverride: v.optional(v.number()),
		monthlyContribution: v.number(),
		excluded: v.boolean(),
		active: v.boolean(),
		revision: v.number(),
	})
		.index("by_account", ["accountId"])
		.index("by_external", ["accountId", "externalId"]),
	returnHistory: defineTable({
		ticker: v.string(),
		rate: v.optional(v.number()),
		startDate: v.optional(v.string()),
		endDate: v.optional(v.string()),
		fetchedAt: v.optional(v.number()),
		requestedAt: v.optional(v.number()),
		error: v.optional(v.string()),
	}).index("by_ticker", ["ticker"]),
	returnBudget: defineTable({ date: v.string(), count: v.number() }).index(
		"by_date",
		["date"],
	),
	categories: defineTable({
		spaceId: v.id("spaces"),
		name: v.string(),
		color: v.string(),
		order: v.number(),
		revision: v.number(),
	})
		.index("by_space", ["spaceId"])
		.index("by_space_name", ["spaceId", "name"]),
	funds: defineTable({
		spaceId: v.id("spaces"),
		startMonth: v.string(),
		openingBalance: v.number(),
		schedules: v.array(fundSchedule),
		revision: v.number(),
	}).index("by_space", ["spaceId"]),
	plans: defineTable({
		spaceId: v.id("spaces"),
		month: v.string(),
		expectedIncome: v.number(),
		savingsTarget: v.number(),
		limits: v.array(split),
		fundAllocations: v.optional(
			v.array(
				v.object({
					fundId: v.id("funds"),
					amount: v.number(),
				}),
			),
		),
		saved: v.optional(v.boolean()),
		// Keep existing records valid while they move to the saved field.
		status: v.optional(v.union(v.literal("draft"), v.literal("active"))),
		reviewed: v.boolean(),
		revision: v.number(),
	}).index("by_month", ["spaceId", "month"]),
	transactions: defineTable({
		accountId: v.id("accounts"),
		spaceId: v.id("spaces"),
		externalId: v.optional(v.string()),
		pendingExternalId: v.optional(v.string()),
		source: v.union(v.literal("manual"), v.literal("plaid")),
		description: v.string(),
		amount: v.number(),
		date: v.string(),
		pending: v.boolean(),
		kind,
		suggestedKind: v.optional(kind),
		bankDescription: v.optional(v.string()),
		bankMerchant: v.optional(v.string()),
		classificationStatus: v.optional(
			v.union(
				v.literal("pending"),
				v.literal("classified"),
				v.literal("review"),
				v.literal("manual"),
				v.literal("skipped"),
			),
		),
		classificationAttempts: v.optional(v.number()),
		classificationRetryAt: v.optional(v.number()),
		classificationError: v.optional(v.string()),
		classification: v.optional(
			v.object({
				model: v.string(),
				kindConfidence: v.number(),
				categoryConfidence: v.number(),
				classifiedAt: v.number(),
			}),
		),
		note: v.string(),
		splits: v.array(split),
		funded: v.optional(v.boolean()),
		removed: v.boolean(),
		revision: v.number(),
		edited: v.boolean(),
		reconciledWith: v.optional(v.id("transactions")),
	})
		.index("by_space_date", ["spaceId", "date"])
		.index("by_space_funded_date", ["spaceId", "funded", "date"])
		.index("by_classification", [
			"source",
			"classificationStatus",
			"classificationRetryAt",
		])
		.index("by_pending_external", ["accountId", "pendingExternalId"])
		.index("by_external", ["accountId", "externalId"]),
	personalAllocations: defineTable({
		privateId: v.id("spaces"),
		sharedId: v.id("spaces"),
		month: v.string(),
		amount: v.number(),
		revision: v.number(),
	})
		.index("by_private", ["privateId", "month"])
		.index("by_shared", ["sharedId", "month"]),
	contributions: defineTable({
		privateId: v.id("spaces"),
		sharedId: v.id("spaces"),
		month: v.string(),
		planned: v.number(),
		pairs: v.array(
			v.object({
				outId: v.id("transactions"),
				inId: v.id("transactions"),
				amount: v.number(),
			}),
		),
		revision: v.number(),
	})
		.index("by_private", ["privateId", "month"])
		.index("by_shared", ["sharedId", "month"]),
	carry: defineTable({
		spaceId: v.id("spaces"),
		sourceMonth: v.string(),
		destinationMonth: v.string(),
		categoryId: v.optional(v.id("categories")),
		amount: v.number(),
	})
		.index("by_source", ["spaceId", "sourceMonth"])
		.index("by_destination", ["spaceId", "destinationMonth"]),
	recurring: defineTable({
		spaceId: v.id("spaces"),
		merchant: v.string(),
		status: v.union(v.literal("confirmed"), v.literal("dismissed")),
	}).index("by_space", ["spaceId"]),
	alertReads: defineTable({ userId: v.string(), key: v.string() }).index(
		"by_user",
		["userId"],
	),
});
