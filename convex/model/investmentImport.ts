import { money } from "../../src/domain/budget";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { importedHolding } from "../projectionTypes";
import type { bankAccount } from "../schema";

export async function updateCashBalances(
	ctx: MutationCtx,
	connectionId: Id<"connections">,
	accounts: (typeof bankAccount.type)[],
) {
	for (const imported of accounts) {
		if (!imported.balances) continue;
		const account = await ctx.db
			.query("accounts")
			.withIndex("by_external", (q) =>
				q
					.eq("connectionId", connectionId)
					.eq("externalId", imported.account_id),
			)
			.unique();
		if (!account || account.investment) continue;
		const balance =
			imported.balances.current == null
				? undefined
				: money(Math.round(imported.balances.current * 100));
		const currency =
			imported.balances.iso_currency_code ??
			imported.balances.unofficial_currency_code ??
			"unknown";
		await ctx.db.patch(account._id, {
			balance,
			currency,
			balanceAsOf: Date.now(),
			revision:
				account.revision +
				(balance !== account.balance || currency !== account.currency ? 1 : 0),
		});
	}
}

export async function applyHoldings(
	ctx: MutationCtx,
	args: {
		connectionId: Id<"connections">;
		syncAt: number;
		accountId: Id<"accounts">;
		balance?: number;
		currency: string;
		holdings: (typeof importedHolding.type)[];
	},
) {
	const connection = await ctx.db.get(args.connectionId);
	const account = await ctx.db.get(args.accountId);
	if (
		!connection ||
		["disconnected", "review", "discarding"].includes(connection.status) ||
		connection.investmentSyncAt !== args.syncAt
	)
		return;
	if (
		!account ||
		account.connectionId !== connection._id ||
		!account.investment
	)
		throw new Error("Investment account does not belong to this connection.");
	if (args.holdings.length > 500)
		throw new Error("This account exceeds the 500-holding import limit.");
	if (
		new Set(args.holdings.map((holding) => holding.externalId)).size !==
		args.holdings.length
	)
		throw new Error("Duplicate securities in the investment response.");
	if (args.balance !== undefined) money(args.balance);
	const previous = await ctx.db
		.query("holdings")
		.withIndex("by_account", (q) => q.eq("accountId", account._id))
		.collect();
	const seen = new Set<string>();
	for (const imported of args.holdings) {
		if (imported.balance !== undefined) money(imported.balance);
		seen.add(imported.externalId);
		const old = previous.find(
			(holding) => holding.externalId === imported.externalId,
		);
		const data = {
			...imported,
			accountId: account._id,
			active: true,
			monthlyContribution: old?.monthlyContribution ?? 0,
			excluded: old?.excluded ?? imported.type === "unsupported",
			revision: (old?.revision ?? 0) + 1,
		};
		if (old) await ctx.db.patch(old._id, data);
		else await ctx.db.insert("holdings", data);
		if (
			imported.ticker &&
			["stock", "etf", "mutualFund"].includes(imported.type)
		)
			await ctx.scheduler.runAfter(0, internal.investments.fetchReturn, {
				ticker: imported.ticker,
			});
	}
	for (const old of previous)
		if (old.active && old.externalId && !seen.has(old.externalId))
			await ctx.db.patch(old._id, {
				active: false,
				revision: old.revision + 1,
			});
	await ctx.db.patch(account._id, {
		balance: args.balance,
		currency: args.currency,
		balanceAsOf: args.syncAt,
		revision: account.revision + 1,
	});
}
