import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
} from "./_generated/server";
import {
	fetchHistoricalReturn,
	HistoricalDataError,
	type HoldingsResponse,
	normalizeHoldings,
	tiingoSymbol,
} from "./investmentClient";
import { applyHoldings } from "./model/investmentImport";
import { list, tickerSymbol } from "./model/projections";
import { decrypt, PlaidError, plaid } from "./plaidClient";
import { importedHolding } from "./projectionTypes";

export const begin = internalMutation({
	args: { id: v.id("connections") },
	handler: async (ctx, args) => {
		const c = await ctx.db.get(args.id);
		if (
			!c ||
			c.product !== "investments" ||
			["disconnected", "review", "discarding"].includes(c.status)
		)
			return null;
		if (
			c.status === "syncing" &&
			c.investmentSyncAt &&
			Date.now() - c.investmentSyncAt < 60000
		)
			return null;
		const syncAt = Date.now();
		await ctx.db.patch(c._id, { investmentSyncAt: syncAt, status: "syncing" });
		const accounts = await ctx.db
			.query("accounts")
			.withIndex("by_user", (q) => q.eq("userId", c.userId))
			.collect();
		return {
			accessToken: c.accessToken,
			syncAt,
			accounts: accounts.flatMap((a) =>
				a.connectionId === c._id && a.investment && a.active && a.externalId
					? [{ id: a._id, externalId: a.externalId }]
					: [],
			),
		};
	},
});
export const store = internalMutation({
	args: {
		connectionId: v.id("connections"),
		syncAt: v.number(),
		accountId: v.id("accounts"),
		balance: v.optional(v.number()),
		currency: v.string(),
		holdings: v.array(importedHolding),
	},
	handler: applyHoldings,
});
export const finish = internalMutation({
	args: {
		id: v.id("connections"),
		syncAt: v.number(),
		error: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const c = await ctx.db.get(args.id);
		if (
			!c ||
			c.investmentSyncAt !== args.syncAt ||
			["disconnected", "review", "discarding"].includes(c.status)
		)
			return;
		await ctx.db.patch(
			c._id,
			args.error
				? {
						status:
							args.error === "ITEM_LOGIN_REQUIRED" ? "reconnect" : "stale",
						error: args.error,
					}
				: { status: "connected", error: undefined, lastSync: args.syncAt },
		);
	},
});
export const sync = internalAction({
	args: { id: v.id("connections") },
	handler: async (ctx, args): Promise<void> => {
		const state = await ctx.runMutation(internal.investments.begin, args);
		if (!state) return;
		try {
			if (!state.accounts.length)
				throw new Error("No investment accounts selected.");
			const data = await plaid<HoldingsResponse>("/investments/holdings/get", {
				access_token: await decrypt(state.accessToken),
				options: { account_ids: state.accounts.map((a) => a.externalId) },
			});
			const normalized = normalizeHoldings(data);
			if (
				state.accounts.some(
					(a) =>
						!normalized.some(
							(item) => item.account.account_id === a.externalId,
						),
				)
			)
				throw new Error(
					"A selected investment account is missing from the provider response.",
				);
			if (normalized.some((item) => item.holdings.length > 500))
				throw new Error("This account exceeds the 500-holding import limit.");
			for (const item of normalized) {
				const account = state.accounts.find(
					(a) => a.externalId === item.account.account_id,
				);
				if (!account) continue;
				await ctx.runMutation(internal.investments.store, {
					connectionId: args.id,
					syncAt: state.syncAt,
					accountId: account.id,
					balance:
						item.account.balances?.current == null
							? undefined
							: Math.round(item.account.balances.current * 100),
					currency: item.account.balances?.iso_currency_code ?? "unknown",
					holdings: item.holdings,
				});
			}
			await ctx.runMutation(internal.investments.finish, {
				...args,
				syncAt: state.syncAt,
			});
		} catch (error) {
			await ctx.runMutation(internal.investments.finish, {
				...args,
				syncAt: state.syncAt,
				error:
					error instanceof PlaidError ? error.code : "INVESTMENT_SYNC_FAILED",
			});
		}
	},
});

export const reserveReturn = internalMutation({
	args: { ticker: v.string() },
	handler: async (ctx, args) => {
		const ticker = tickerSymbol(args.ticker);
		if (!ticker) return null;
		const old = await ctx.db
			.query("returnHistory")
			.withIndex("by_ticker", (q) => q.eq("ticker", ticker))
			.unique();
		const now = Date.now();
		if (
			old?.source === "Tiingo" &&
			!old.error &&
			old.fetchedAt &&
			now - old.fetchedAt < 30 * 86400000
		)
			return null;
		if (
			old?.requestSource === "Tiingo" &&
			old?.requestedAt &&
			now - old.requestedAt < 60000
		)
			return null;
		const date = "tiingo";
		const budget = await ctx.db
			.query("returnBudget")
			.withIndex("by_date", (q) => q.eq("date", date))
			.unique();
		const requests = (budget?.requests ?? []).filter(
			(time) => time > now - 86400000,
		);
		const symbols = (budget?.symbols ?? []).filter(
			(entry) => entry.requestedAt > now - 30 * 86400000,
		);
		let symbol: string;
		try {
			symbol = tiingoSymbol(ticker);
		} catch {
			const error =
				"Check this investment's trading symbol before loading Tiingo history.";
			if (old) await ctx.db.patch(old._id, { error });
			else await ctx.db.insert("returnHistory", { ticker, error });
			return null;
		}
		const knownSymbol = symbols.find((entry) => entry.ticker === symbol);
		const error =
			requests.filter((time) => time > now - 3600000).length >= 50
				? "Tiingo's hourly history limit was reached. Try again after an hour or enter a return."
				: requests.length >= 1000
					? "Tiingo's daily history limit was reached. Try again tomorrow or enter a return."
					: !knownSymbol && symbols.length >= 500
						? "Tiingo's limit of 500 different symbols per month was reached. Try again later or enter a return."
						: undefined;
		if (error) {
			if (old) await ctx.db.patch(old._id, { error });
			else await ctx.db.insert("returnHistory", { ticker, error });
			return null;
		}
		requests.push(now);
		if (knownSymbol) knownSymbol.requestedAt = now;
		else symbols.push({ ticker: symbol, requestedAt: now });
		const usage = { date, count: requests.length, requests, symbols };
		if (budget) await ctx.db.patch(budget._id, usage);
		else await ctx.db.insert("returnBudget", usage);
		const id: Id<"returnHistory"> =
			old?._id ?? (await ctx.db.insert("returnHistory", { ticker }));
		await ctx.db.patch(id, {
			requestedAt: now,
			requestSource: "Tiingo",
			error: undefined,
		});
		return { id, requestedAt: now };
	},
});
export const storeReturn = internalMutation({
	args: {
		id: v.id("returnHistory"),
		requestedAt: v.number(),
		rate: v.optional(v.number()),
		startDate: v.optional(v.string()),
		endDate: v.optional(v.string()),
		error: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const old = await ctx.db.get(args.id);
		if (
			!old ||
			old.requestSource !== "Tiingo" ||
			old.requestedAt !== args.requestedAt
		)
			return;
		if (args.error) await ctx.db.patch(old._id, { error: args.error });
		else
			await ctx.db.patch(old._id, {
				source: "Tiingo",
				rate: args.rate,
				startDate: args.startDate,
				endDate: args.endDate,
				fetchedAt: Date.now(),
				error: undefined,
			});
	},
});
export const fetchReturn = internalAction({
	args: { ticker: v.string() },
	handler: async (ctx, args): Promise<void> => {
		const reservation = await ctx.runMutation(
			internal.investments.reserveReturn,
			args,
		);
		if (!reservation) return;
		try {
			const result = await fetchHistoricalReturn(args.ticker);
			await ctx.runMutation(internal.investments.storeReturn, {
				...reservation,
				rate: result.rate,
				startDate: result.startDate,
				endDate: result.endDate,
			});
		} catch (error) {
			await ctx.runMutation(internal.investments.storeReturn, {
				...reservation,
				error:
					error instanceof HistoricalDataError
						? error.message
						: "Historical return lookup failed. Enter a return or try again later.",
			});
		}
	},
});
export const refreshReturns = action({
	args: { spaceId: v.id("spaces") },
	handler: async (ctx, args): Promise<void> => {
		const data = await ctx.runQuery(
			internal.investments.authorizedTickers,
			args,
		);
		if (!data.length)
			throw new ConvexError(
				"Add a stock or fund with a public trading symbol first.",
			);
		for (const ticker of data)
			await ctx.runAction(internal.investments.fetchReturn, { ticker });
	},
});
export const authorizedTickers = internalQuery({
	args: { spaceId: v.id("spaces") },
	handler: async (ctx, args): Promise<string[]> => {
		const data = await list(ctx, args.spaceId);
		return [
			...new Set(
				data.accounts.flatMap((account) =>
					account.holdings.flatMap((holding) =>
						["stock", "etf", "mutualFund"].includes(holding.type) &&
						holding.ticker
							? [holding.ticker]
							: [],
					),
				),
			),
		];
	},
});
