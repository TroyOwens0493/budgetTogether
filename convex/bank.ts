import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	query,
} from "./_generated/server";
import { type DbCtx, privateSpace, user } from "./access";
import { removedValidator, SYNC_BATCH_SIZE, txValidator } from "./bankTypes";
import { applyChanges, applyRemovals } from "./model/bankImport";
import { updateCashBalances } from "./model/investmentImport";
import {
	decrypt,
	accountBalance,
	encrypt,
	type PlaidAccount,
	PlaidError,
	type PlaidTransaction,
	plaid,
	selectAccount,
	type SyncPage,
} from "./plaidClient";
import { bankAccount as accountValidator } from "./schema";
export const identity = internalQuery({
	args: {},
	handler: async (ctx) => {
		const current = await user(ctx);
		const space = await privateSpace(ctx, current._id);
		return { userId: current._id, spaceId: space._id };
	},
});
export const connection = internalQuery({
	args: { id: v.id("connections"), userId: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const connection = await ctx.db.get(args.id);
		if (!connection || (args.userId && connection.userId !== args.userId))
			throw new ConvexError("Connection not found.");
		return connection;
	},
});
export const link = action({
	args: {
		connectionId: v.optional(v.id("connections")),
		investments: v.optional(v.boolean()),
	},
	handler: async (ctx, args): Promise<string> => {
		const owner = await ctx.runQuery(internal.bank.identity, {});
		const body: Record<string, unknown> = {
			client_name: "Budget Together",
			country_codes: ["US"],
			language: "en",
			user: { client_user_id: owner.userId },
			account_filters: {
				depository: { account_subtypes: ["checking", "savings"] },
				credit: { account_subtypes: ["credit card"] },
			},
			webhook: `${process.env.CONVEX_SITE_URL}/bank-events`,
		};
		if (process.env.PLAID_REDIRECT_URI)
			body.redirect_uri = process.env.PLAID_REDIRECT_URI;
		if (args.connectionId) {
			const c = await ctx.runQuery(internal.bank.connection, {
				id: args.connectionId,
				userId: owner.userId,
			});
			if (c.status === "disconnected")
				throw new ConvexError("Connect this bank again to resume imports.");
			body.access_token = await decrypt(c.accessToken);
			if (c.product === "investments") delete body.account_filters;
		} else {
			body.products = [args.investments ? "investments" : "transactions"];
			if (args.investments) delete body.account_filters;
			else body.transactions = { days_requested: 180 };
		}
		const result = await plaid<{ link_token: string }>(
			"/link/token/create",
			body,
		);
		return result.link_token;
	},
});
export const exchange = action({
	args: { publicToken: v.string(), investments: v.optional(v.boolean()) },
	handler: async (ctx, args): Promise<Id<"connections">> => {
		const owner = await ctx.runQuery(internal.bank.identity, {});
		const token = await plaid<{ access_token: string; item_id: string }>(
			"/item/public_token/exchange",
			{ public_token: args.publicToken },
		);
		try {
			const [accounts, item] = await Promise.all([
				plaid<{ accounts: PlaidAccount[] }>("/accounts/get", {
					access_token: token.access_token,
				}),
				plaid<{ item: { institution_id: string } }>("/item/get", {
					access_token: token.access_token,
				}),
			]);
			const institution = await plaid<{ institution: { name: string } }>(
				"/institutions/get_by_id",
				{ institution_id: item.item.institution_id, country_codes: ["US"] },
			);
			const id = await ctx.runMutation(internal.bank.store, {
				...owner,
				itemId: token.item_id,
				accessToken: await encrypt(token.access_token),
				institution: institution.institution.name,
				institutionId: item.item.institution_id,
				product: args.investments ? "investments" : undefined,
				accounts: accounts.accounts.map(selectAccount),
			});
			await ctx.scheduler.runAfter(0, internal.bank.syncInternal, { id });
			return id;
		} catch (error) {
			await plaid("/item/remove", { access_token: token.access_token }).catch(
				() => undefined,
			);
			throw error;
		}
	},
});
export const store = internalMutation({
	args: {
		userId: v.string(),
		spaceId: v.id("spaces"),
		itemId: v.string(),
		accessToken: v.string(),
		institution: v.string(),
		institutionId: v.string(),
		product: v.optional(v.literal("investments")),
		accounts: v.array(accountValidator),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("connections")
			.withIndex("by_item", (q) => q.eq("itemId", args.itemId))
			.unique();
		if (existing) throw new ConvexError("This bank connection already exists.");
		const supported = args.accounts.filter((a) =>
			args.product === "investments"
				? a.type === "investment"
				: ["checking", "savings", "credit card"].includes(a.subtype ?? ""),
		);
		if (!supported.length)
			throw new ConvexError(
				args.product === "investments"
					? "Select an investment account."
					: "Select a checking, savings, or credit card account.",
			);
		for (const a of supported)
			if (a.persistent_account_id) {
				const duplicate = await ctx.db
					.query("accounts")
					.withIndex("by_persistent", (q) =>
						q.eq("persistentId", a.persistent_account_id!),
					)
					.first();
				if (duplicate)
					throw new ConvexError(
						"An account is already connected. Reconnect its existing connection instead.",
					);
			}
		const needsReview = (
			await Promise.all(
				supported.map((a) =>
					possibleDuplicate(ctx, args.userId, args.institutionId, a),
				),
			)
		).some(Boolean);
		const id = await ctx.db.insert("connections", {
			userId: args.userId,
			itemId: args.itemId,
			accessToken: args.accessToken,
			institution: args.institution,
			institutionId: args.institutionId,
			product: args.product,
			status: needsReview ? "review" : "syncing",
			pendingAccounts: needsReview ? supported : undefined,
		});
		for (const a of needsReview ? [] : supported)
			await ctx.db.insert("accounts", {
				userId: args.userId,
				spaceId: args.spaceId,
				connectionId: id,
				externalId: a.account_id,
				...(a.persistent_account_id
					? { persistentId: a.persistent_account_id }
					: {}),
				name: a.name,
				type: a.subtype ?? a.type,
				investment: args.product === "investments" ? true : undefined,
				balance: accountBalance(a),
				currency:
					a.balances?.iso_currency_code ??
					a.balances?.unofficial_currency_code ??
					"unknown",
				balanceAsOf: a.balances ? Date.now() : undefined,
				mask: a.mask ?? "",
				active: true,
				revision: 0,
			});
		return id;
	},
});

// Compare within the user's current partnership. Never return a partner's private account data.
async function possibleDuplicate(
	ctx: DbCtx,
	userId: string,
	institutionId: string,
	account: typeof accountValidator.type,
) {
	if (account.persistent_account_id || !account.mask || !institutionId)
		return false;
	const owners = new Set([userId]);
	const memberships = await ctx.db
		.query("memberships")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();
	for (const m of memberships) {
		const space = await ctx.db.get(m.spaceId);
		if (!m.active || space?.type !== "shared") continue;
		for (const partner of await ctx.db
			.query("memberships")
			.withIndex("by_space", (q) => q.eq("spaceId", m.spaceId))
			.collect())
			if (partner.active) owners.add(partner.userId);
	}
	for (const owner of owners) {
		for (const existing of await ctx.db
			.query("accounts")
			.withIndex("by_user", (q) => q.eq("userId", owner))
			.collect()) {
			if (
				!existing.connectionId ||
				existing.type !== (account.subtype ?? account.type) ||
				existing.mask !== account.mask
			)
				continue;
			const connection = await ctx.db.get(existing.connectionId);
			if (connection?.institutionId === institutionId) return true;
		}
	}
	return false;
}
export const review = query({
	args: { id: v.id("connections") },
	handler: async (ctx, { id }) => {
		const current = await user(ctx);
		const c = await ctx.db.get(id);
		if (!c || c.userId !== current._id)
			throw new ConvexError("Connection not found.");
		if (c.status !== "review") return null;
		return Promise.all(
			(c.pendingAccounts ?? []).map(async (a) => ({
				accountId: a.account_id,
				name: a.name,
				type: a.subtype,
				mask: a.mask,
				possibleDuplicate: await possibleDuplicate(
					ctx,
					current._id,
					c.institutionId,
					a,
				),
			})),
		);
	},
});
export const confirmAccounts = mutation({
	args: {
		id: v.id("connections"),
		decisions: v.array(
			v.object({ accountId: v.string(), sameAccount: v.boolean() }),
		),
	},
	handler: async (ctx, args) => {
		const current = await user(ctx);
		const c = await ctx.db.get(args.id);
		if (!c || c.userId !== current._id || c.status !== "review")
			throw new ConvexError("This connection is not awaiting review.");
		const space = await privateSpace(ctx, current._id);
		let added = 0;
		for (const a of c.pendingAccounts ?? []) {
			const duplicate = await possibleDuplicate(
				ctx,
				current._id,
				c.institutionId,
				a,
			);
			const decision = args.decisions.find((d) => d.accountId === a.account_id);
			if (duplicate && !decision)
				throw new ConvexError(
					"Identify each possible duplicate before importing. Reload the account review if needed.",
				);
			if (decision?.sameAccount) continue;
			// Persistent identifiers remain authoritative, including when another link completes during review.
			if (
				a.persistent_account_id &&
				(await ctx.db
					.query("accounts")
					.withIndex("by_persistent", (q) =>
						q.eq("persistentId", a.persistent_account_id!),
					)
					.first())
			)
				throw new ConvexError(
					"An account is already connected. Reconnect its existing connection instead.",
				);
			await ctx.db.insert("accounts", {
				userId: current._id,
				spaceId: space._id,
				connectionId: c._id,
				externalId: a.account_id,
				...(a.persistent_account_id
					? { persistentId: a.persistent_account_id }
					: {}),
				name: a.name,
				type: a.subtype ?? a.type,
				investment: c.product === "investments" ? true : undefined,
				balance: accountBalance(a),
				currency:
					a.balances?.iso_currency_code ??
					a.balances?.unofficial_currency_code ??
					"unknown",
				balanceAsOf: a.balances ? Date.now() : undefined,
				mask: a.mask ?? "",
				active: true,
				revision: 0,
			});
			added++;
		}
		await ctx.db.patch(c._id, {
			status: added ? "syncing" : "discarding",
			pendingAccounts: undefined,
		});
		await ctx.scheduler.runAfter(
			0,
			added ? internal.bank.syncInternal : internal.bank.discard,
			{ id: c._id },
		);
	},
});
export const discard = internalAction({
	args: { id: v.id("connections") },
	handler: async (ctx, args): Promise<void> => {
		const c = await ctx.runQuery(internal.bank.connection, args);
		if (c.status !== "discarding") return;
		await plaid("/item/remove", { access_token: await decrypt(c.accessToken) });
		await ctx.runMutation(internal.bank.stop, args);
	},
});
export const sync = action({
	args: { id: v.id("connections") },
	handler: async (ctx, args): Promise<void> => {
		const owner = await ctx.runQuery(internal.bank.identity, {});
		await ctx.runQuery(internal.bank.connection, {
			id: args.id,
			userId: owner.userId,
		});
		await ctx.runAction(internal.bank.syncInternal, args);
		const refreshed = await ctx.runQuery(internal.bank.connection, {
			id: args.id,
			userId: owner.userId,
		});
		if (refreshed.status === "stale" || refreshed.status === "reconnect")
			throw new ConvexError(
				"Bank sync failed. Your imported history is retained. Check the connection status.",
			);
	},
});
const syncBlocked = (status: string) =>
	["disconnected", "review", "discarding"].includes(status);

// Resume a durable run. A delayed watchdog recovers an action that stops before
// its next mutation. Old watchdogs cannot start a new run after completion.
export const beginSync = internalMutation({
	args: { id: v.id("connections"), runId: v.optional(v.id("bankSyncRuns")) },
	handler: async (
		ctx,
		args,
	): Promise<{ run: Doc<"bankSyncRuns">; accessToken: string } | null> => {
		const c = await ctx.db.get(args.id);
		if (
			!c ||
			syncBlocked(c.status) ||
			(args.runId && c.syncRunId !== args.runId)
		)
			return null;
		let run = c.syncRunId ? await ctx.db.get(c.syncRunId) : null;
		if (run && run.startCursor !== c.cursor) {
			await ctx.scheduler.runAfter(0, internal.bank.cleanupSync, {
				runId: run._id,
			});
			run = null;
			await ctx.db.patch(c._id, { syncRunId: undefined });
			if (args.runId) return null;
		}
		if (run?.paused && args.runId) return null;
		if (!run) {
			const runId = await ctx.db.insert("bankSyncRuns", {
				connectionId: c._id,
				startCursor: c.cursor,
				cursor: c.cursor,
				pages: 0,
				position: 0,
				phase: "fetching",
				restarts: 0,
			});
			run = await ctx.db.get(runId);
			if (!run) throw new ConvexError("Bank sync run is missing.");
			await ctx.db.patch(c._id, { syncRunId: runId });
		}
		if (run.paused) await ctx.db.patch(run._id, { paused: false });
		await ctx.db.patch(c._id, { status: "syncing", error: undefined });
		if (!run.watchdogAt || run.watchdogAt <= Date.now()) {
			await ctx.db.patch(run._id, { watchdogAt: Date.now() + 60_000 });
			await ctx.scheduler.runAfter(60_000, internal.bank.syncInternal, {
				id: c._id,
				runId: run._id,
			});
		}
		return { run, accessToken: c.accessToken };
	},
});

export const syncInternal = internalAction({
	args: { id: v.id("connections"), runId: v.optional(v.id("bankSyncRuns")) },
	handler: async (ctx, args): Promise<void> => {
		const connection = await ctx.runQuery(internal.bank.connection, {
			id: args.id,
		});
		if (connection.product === "investments") {
			await ctx.runAction(internal.investments.sync, { id: args.id });
			return;
		}
		const state = await ctx.runMutation(internal.bank.beginSync, args);
		if (!state) return;
		const { run } = state;
		try {
			if (run.phase === "fetching") {
				const page: SyncPage = await plaid("/transactions/sync", {
					access_token: await decrypt(state.accessToken),
					...(run.cursor ? { cursor: run.cursor } : {}),
					count: SYNC_BATCH_SIZE,
				});
				await ctx.runMutation(internal.bank.stageSync, {
					runId: run._id,
					page: run.pages,
					cursor: page.next_cursor,
					more: page.has_more,
					accounts: page.accounts.map(selectAccount),
					changed: [...page.added, ...page.modified].map(selectTransaction),
					removed: page.removed.map((x) => ({
						account_id: x.account_id,
						transaction_id: x.transaction_id,
					})),
				});
			} else {
				await ctx.runMutation(internal.bank.applySyncBatch, {
					runId: run._id,
					phase: run.phase,
					position: run.position,
				});
			}
		} catch (error) {
			await ctx.runMutation(internal.bank.syncFailure, {
				runId: run._id,
				phase: run.phase,
				position: run.position,
				pages: run.pages,
				error: error instanceof PlaidError ? error.code : "SYNC_FAILED",
			});
		}
	},
});
function selectTransaction(x: PlaidTransaction): PlaidTransaction {
	return {
		transaction_id: x.transaction_id,
		account_id: x.account_id,
		name: x.name,
		amount: x.amount,
		date: x.date,
		pending: x.pending,
		...(x.pending_transaction_id
			? { pending_transaction_id: x.pending_transaction_id }
			: {}),
		...(x.merchant_name ? { merchant_name: x.merchant_name } : {}),
	};
}
const syncPhase = v.union(
	v.literal("fetching"),
	v.literal("changes"),
	v.literal("removals"),
);
async function currentRun(ctx: MutationCtx, runId: Id<"bankSyncRuns">) {
	const run = await ctx.db.get(runId);
	const c = run ? await ctx.db.get(run.connectionId) : null;
	if (
		!run ||
		!c ||
		syncBlocked(c.status) ||
		c.syncRunId !== runId ||
		c.cursor !== run.startCursor ||
		run.paused
	)
		return null;
	return { run, connection: c };
}
function checkBatch(
	changed: PlaidTransaction[],
	removed: { account_id: string; transaction_id: string }[],
) {
	if (
		changed.length + removed.length > SYNC_BATCH_SIZE ||
		new TextEncoder().encode(JSON.stringify([changed, removed])).byteLength >
			512_000
	)
		throw new ConvexError("Bank sync batch exceeds the import limit.");
}
export const stageSync = internalMutation({
	args: {
		runId: v.id("bankSyncRuns"),
		page: v.number(),
		cursor: v.string(),
		more: v.boolean(),
		changed: v.array(txValidator),
		removed: v.array(removedValidator),
		accounts: v.optional(v.array(accountValidator)),
	},
	handler: async (ctx, args) => {
		const state = await currentRun(ctx, args.runId);
		if (
			!state ||
			state.run.phase !== "fetching" ||
			state.run.pages !== args.page
		)
			return;
		checkBatch(args.changed, args.removed);
		if (args.accounts)
			await updateCashBalances(ctx, state.connection._id, args.accounts);
		if (args.more && args.cursor === state.run.cursor)
			throw new ConvexError("Bank sync cursor did not advance.");
		await ctx.db.insert("bankSyncBatches", {
			runId: args.runId,
			page: args.page,
			changed: args.changed,
			removed: args.removed,
		});
		await ctx.db.patch(args.runId, {
			cursor: args.cursor,
			pages: args.page + 1,
			phase: args.more ? "fetching" : "changes",
		});
		await ctx.scheduler.runAfter(0, internal.bank.syncInternal, {
			id: state.connection._id,
			runId: args.runId,
		});
	},
});
export const applySyncBatch = internalMutation({
	args: { runId: v.id("bankSyncRuns"), phase: syncPhase, position: v.number() },
	handler: async (ctx, args) => {
		const state = await currentRun(ctx, args.runId);
		if (
			!state ||
			state.run.phase === "fetching" ||
			state.run.phase !== args.phase ||
			state.run.position !== args.position
		)
			return;
		const { run, connection } = state;
		const batch = await ctx.db
			.query("bankSyncBatches")
			.withIndex("by_run_page", (q) =>
				q.eq("runId", run._id).eq("page", run.position),
			)
			.unique();
		if (!batch) throw new ConvexError("Bank sync batch is missing.");
		if (run.phase === "changes")
			await applyChanges(ctx, connection._id, batch.changed);
		else {
			await applyRemovals(ctx, connection._id, batch.removed);
			await ctx.db.delete(batch._id);
		}
		if (run.position + 1 === run.pages && run.phase === "removals") {
			await ctx.db.patch(connection._id, {
				cursor: run.cursor,
				syncRunId: undefined,
				status: "connected",
				lastSync: Date.now(),
				error: undefined,
			});
			await ctx.db.delete(run._id);
			return;
		}
		await ctx.db.patch(
			run._id,
			run.position + 1 === run.pages
				? { phase: "removals", position: 0 }
				: { position: run.position + 1 },
		);
		await ctx.scheduler.runAfter(0, internal.bank.syncInternal, {
			id: connection._id,
			runId: run._id,
		});
	},
});
export const syncFailure = internalMutation({
	args: {
		runId: v.id("bankSyncRuns"),
		phase: syncPhase,
		position: v.number(),
		pages: v.number(),
		error: v.string(),
	},
	handler: async (ctx, args) => {
		const state = await currentRun(ctx, args.runId);
		if (
			!state ||
			state.run.phase !== args.phase ||
			state.run.pages !== args.pages ||
			state.run.position !== args.position
		)
			return;
		const { run, connection } = state;
		if (
			args.error === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
			run.phase === "fetching" &&
			run.restarts < 2
		) {
			const runId = await ctx.db.insert("bankSyncRuns", {
				connectionId: connection._id,
				startCursor: run.startCursor,
				cursor: run.startCursor,
				phase: "fetching",
				pages: 0,
				position: 0,
				restarts: run.restarts + 1,
			});
			await ctx.db.patch(connection._id, { syncRunId: runId });
			await ctx.scheduler.runAfter(0, internal.bank.cleanupSync, {
				runId: run._id,
			});
			await ctx.scheduler.runAfter(0, internal.bank.syncInternal, {
				id: connection._id,
				runId,
			});
		} else {
			// On exhaustion restart the fetch next time; apply failures resume in place.
			if (args.error === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") {
				await ctx.db.patch(connection._id, { syncRunId: undefined });
				await ctx.scheduler.runAfter(0, internal.bank.cleanupSync, {
					runId: run._id,
				});
			} else await ctx.db.patch(run._id, { paused: true });
			await ctx.db.patch(connection._id, {
				status: args.error === "ITEM_LOGIN_REQUIRED" ? "reconnect" : "stale",
				error: args.error,
			});
		}
	},
});
export const cleanupSync = internalMutation({
	args: { runId: v.id("bankSyncRuns") },
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) return;
		const c = await ctx.db.get(run.connectionId);
		if (
			c?.syncRunId === run._id &&
			!syncBlocked(c.status) &&
			c.cursor === run.startCursor
		)
			return;
		const batches = await ctx.db
			.query("bankSyncBatches")
			.withIndex("by_run_page", (q) => q.eq("runId", run._id))
			.take(10);
		for (const batch of batches) await ctx.db.delete(batch._id);
		if (batches.length === 10)
			await ctx.scheduler.runAfter(0, internal.bank.cleanupSync, args);
		else await ctx.db.delete(run._id);
	},
});
// Retain the internal single-batch entry point; it has the same hard limit as staging.
export const apply = internalMutation({
	args: {
		id: v.id("connections"),
		expectedCursor: v.optional(v.string()),
		cursor: v.string(),
		changed: v.array(txValidator),
		removed: v.array(removedValidator),
	},
	handler: async (ctx, args) => {
		const c = await ctx.db.get(args.id);
		if (
			!c ||
			syncBlocked(c.status) ||
			c.cursor !== args.expectedCursor ||
			c.syncRunId
		)
			return;
		checkBatch(args.changed, args.removed);
		await applyChanges(ctx, c._id, args.changed);
		await applyRemovals(ctx, c._id, args.removed);
		await ctx.db.patch(c._id, {
			cursor: args.cursor,
			status: "connected",
			lastSync: Date.now(),
			error: undefined,
		});
	},
});
export const fail = internalMutation({
	args: { id: v.id("connections"), error: v.string() },
	handler: async (ctx, args) => {
		const c = await ctx.db.get(args.id);
		if (c && !["disconnected", "review", "discarding"].includes(c.status))
			await ctx.db.patch(args.id, {
				status: args.error === "ITEM_LOGIN_REQUIRED" ? "reconnect" : "stale",
				error: args.error,
			});
	},
});
export const disconnect = action({
	args: { id: v.id("connections") },
	handler: async (ctx, args): Promise<void> => {
		const owner = await ctx.runQuery(internal.bank.identity, {});
		const c = await ctx.runQuery(internal.bank.connection, {
			id: args.id,
			userId: owner.userId,
		});
		if (c.status !== "disconnected")
			await plaid("/item/remove", {
				access_token: await decrypt(c.accessToken),
			});
		await ctx.runMutation(internal.bank.stop, args);
	},
});
export const stop = internalMutation({
	args: { id: v.id("connections") },
	handler: async (ctx, args) => {
		const c = await ctx.db.get(args.id);
		if (c?.syncRunId)
			await ctx.scheduler.runAfter(0, internal.bank.cleanupSync, {
				runId: c.syncRunId,
			});
		await ctx.db.patch(args.id, {
			syncRunId: undefined,
			status: "disconnected",
			accessToken: "",
			pendingAccounts: undefined,
			error: undefined,
		});
	},
});
export const event = internalMutation({
	args: { itemId: v.string(), error: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const c = await ctx.db
			.query("connections")
			.withIndex("by_item", (q) => q.eq("itemId", args.itemId))
			.unique();
		if (!c || ["disconnected", "review", "discarding"].includes(c.status))
			return;
		if (args.error)
			await ctx.db.patch(c._id, { status: "reconnect", error: args.error });
		else
			await ctx.scheduler.runAfter(0, internal.bank.syncInternal, {
				id: c._id,
			});
	},
});
export const poll = internalMutation({
	args: {},
	handler: async (ctx) => {
		for (const c of await ctx.db.query("connections").collect())
			if (c.status === "discarding")
				await ctx.scheduler.runAfter(0, internal.bank.discard, { id: c._id });
			else if (!["disconnected", "review"].includes(c.status))
				await ctx.scheduler.runAfter(0, internal.bank.syncInternal, {
					id: c._id,
				});
	},
});
export { txValidator };
