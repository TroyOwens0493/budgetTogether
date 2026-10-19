import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { removedValidator, txValidator } from "./bankTypes";
export const split = v.object({
	categoryId: v.id("categories"),
	amount: v.number(),
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
		assignments: v.optional(
			v.array(v.object({ spaceId: v.id("spaces"), startsOn: v.string() })),
		),
	})
		.index("by_space", ["spaceId"])
		.index("by_user", ["userId"])
		.index("by_external", ["connectionId", "externalId"])
		.index("by_persistent", ["persistentId"]),
	categories: defineTable({
		spaceId: v.id("spaces"),
		name: v.string(),
		color: v.string(),
		order: v.number(),
		revision: v.number(),
	})
		.index("by_space", ["spaceId"])
		.index("by_space_name", ["spaceId", "name"]),
	plans: defineTable({
		spaceId: v.id("spaces"),
		month: v.string(),
		expectedIncome: v.number(),
		savingsTarget: v.number(),
		limits: v.array(split),
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
		note: v.string(),
		splits: v.array(split),
		removed: v.boolean(),
		revision: v.number(),
		edited: v.boolean(),
		reconciledWith: v.optional(v.id("transactions")),
	})
		.index("by_space_date", ["spaceId", "date"])
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
