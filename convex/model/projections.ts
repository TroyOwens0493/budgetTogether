import { ConvexError } from "convex/values";
import { assertRevision, isPlanSaved, money } from "../../src/domain/budget";
import {
	annualReturn,
	calendarDate,
	forecastHorizon,
} from "../../src/domain/projections";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { access, label } from "../access";
import type { fixedIncome, investmentType } from "../projectionTypes";

export function today(timeZone: string) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date());
	return ["year", "month", "day"]
		.map((part) => parts.find((entry) => entry.type === part)!.value)
		.join("-");
}

export function tickerSymbol(value: string) {
	const ticker = value.trim().toUpperCase();
	if (ticker && !/^[A-Z0-9][A-Z0-9.\-:]{0,29}$/.test(ticker))
		throw new ConvexError("Enter a valid public trading symbol.");
	return ticker || undefined;
}

export async function list(ctx: QueryCtx, spaceId: Id<"spaces">) {
	const { space } = await access(ctx, spaceId, true);
	const startsOn = today(space.timeZone);
	const month = startsOn.slice(0, 7);
	const settings = await ctx.db
		.query("projectionSettings")
		.withIndex("by_space", (q) => q.eq("spaceId", spaceId))
		.unique();
	const plan = await ctx.db
		.query("plans")
		.withIndex("by_month", (q) => q.eq("spaceId", spaceId).eq("month", month))
		.unique();
	const accounts = await ctx.db
		.query("accounts")
		.withIndex("by_space", (q) => q.eq("spaceId", spaceId))
		.collect();
	const entries = await Promise.all(
		accounts
			.filter((a) => a.active)
			.map(async (account) => {
				const connection = account.connectionId
					? await ctx.db.get(account.connectionId)
					: null;
				const holdings = account.investment
					? await ctx.db
							.query("holdings")
							.withIndex("by_account", (q) => q.eq("accountId", account._id))
							.collect()
					: [];
				return {
					_id: account._id,
					name: account.name,
					type: account.type,
					investment: Boolean(account.investment),
					balance: account.balance,
					balanceAsOf: account.balanceAsOf,
					currency: account.currency,
					projectionCashExcluded:
						account.projectionCashExcluded ?? account.type === "checking",
					revision: account.revision,
					linked: Boolean(account.connectionId),
					stale: Boolean(connection && connection.status !== "connected"),
					holdings: await Promise.all(
						holdings
							.filter((h) => h.active)
							.map(async (holding) => {
								const history = holding.ticker
									? await ctx.db
											.query("returnHistory")
											.withIndex("by_ticker", (q) =>
												q.eq("ticker", holding.ticker!),
											)
											.unique()
									: null;
								return { ...holding, history };
							}),
					),
				};
			}),
	);
	return {
		settings,
		month,
		startsOn,
		savingsTarget: plan?.savingsTarget ?? 0,
		savedPlan: isPlanSaved(plan),
		accounts: entries.filter(
			(a) => a.investment || ["checking", "savings"].includes(a.type),
		),
	};
}

export async function saveSettings(
	ctx: MutationCtx,
	args: {
		spaceId: Id<"spaces">;
		currentAge: number;
		targetAge: number;
		cashBalance: number;
		cashAnnualReturn: number;
		revision: number;
	},
) {
	const { space } = await access(ctx, args.spaceId, true);
	forecastHorizon(args.currentAge, args.targetAge);
	money(args.cashBalance, true);
	annualReturn(args.cashAnnualReturn);
	if (args.cashAnnualReturn < 0)
		throw new ConvexError("Cash interest cannot be negative.");
	const old = await ctx.db
		.query("projectionSettings")
		.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
		.unique();
	assertRevision(old?.revision ?? 0, args.revision);
	const value = {
		...args,
		ageAsOf: today(space.timeZone),
		revision: args.revision + 1,
	};
	if (old) await ctx.db.patch(old._id, value);
	else await ctx.db.insert("projectionSettings", value);
}

export type HoldingInput = {
	id?: Id<"holdings">;
	accountId?: Id<"accounts">;
	spaceId: Id<"spaces">;
	accountName: string;
	accountType: string;
	name: string;
	type: typeof investmentType.type;
	ticker: string;
	balance: number;
	annualReturnOverride?: number;
	monthlyContribution: number;
	excluded: boolean;
	fixedIncome?: typeof fixedIncome.type;
	revision: number;
};

function checkFixed(value: typeof fixedIncome.type | undefined) {
	if (!value) return;
	if (value.faceValue !== undefined) money(value.faceValue, true);
	if (
		value.couponRate !== undefined &&
		(!Number.isFinite(value.couponRate) ||
			value.couponRate < 0 ||
			value.couponRate > 100)
	)
		throw new ConvexError("Enter a coupon rate from 0% to 100%.");
	if (value.apy !== undefined) annualReturn(value.apy);
	if (
		value.paymentsPerYear !== undefined &&
		![0, 1, 2, 4, 12].includes(value.paymentsPerYear)
	)
		throw new ConvexError("Select a valid coupon frequency.");
	if (value.maturityDate) calendarDate(value.maturityDate);
	if (value.nextPaymentDate) calendarDate(value.nextPaymentDate);
}

export async function saveHolding(ctx: MutationCtx, args: HoldingInput) {
	await access(ctx, args.spaceId, true);
	money(args.balance);
	money(args.monthlyContribution, true);
	if (args.annualReturnOverride !== undefined)
		annualReturn(args.annualReturnOverride);
	checkFixed(args.fixedIncome);
	if (["bond", "cd"].includes(args.type) && args.monthlyContribution !== 0)
		throw new ConvexError("Add a new holding for a new bond or CD purchase.");
	const old = args.id ? await ctx.db.get(args.id) : null;
	if (args.id && !old) throw new ConvexError("Holding not found.");
	let accountId = old?.accountId ?? args.accountId;
	let account = accountId ? await ctx.db.get(accountId) : null;
	if (
		accountId &&
		(!account ||
			account.spaceId !== args.spaceId ||
			!account.investment ||
			!account.active)
	)
		throw new ConvexError("Investment account not found in this budget.");
	if (!accountId) {
		if (
			!["brokerage", "401k", "ira", "roth ira", "other retirement"].includes(
				args.accountType,
			)
		)
			throw new ConvexError("Select a supported account type.");
		accountId = await ctx.db.insert("accounts", {
			userId: (await access(ctx, args.spaceId, true)).current._id,
			spaceId: args.spaceId,
			name: label(args.accountName),
			type: args.accountType,
			investment: true,
			mask: "",
			active: true,
			revision: 0,
		});
		account = await ctx.db.get(accountId);
	}
	assertRevision(old?.revision ?? 0, args.revision);
	const linked = Boolean(account?.connectionId);
	if (!linked) money(args.balance, true);
	if (
		["cd", "cash"].includes(args.type) &&
		(args.annualReturnOverride ?? 0) < 0
	)
		throw new ConvexError("Cash interest and CD yields cannot be negative.");
	if (linked && !old)
		throw new ConvexError(
			"Add manual holdings to a manual account to avoid duplicate imports.",
		);
	if (
		linked &&
		old &&
		((old.balance !== undefined && args.balance !== old.balance) ||
			args.name !== old.name ||
			args.type !== old.type ||
			tickerSymbol(args.ticker) !== old.ticker)
	)
		throw new ConvexError(
			"Linked values come from the provider. Edit only forecast assumptions.",
		);
	const type = linked ? old!.type : args.type;
	if (type === "unsupported" && !args.excluded)
		throw new ConvexError("This holding type cannot be included.");
	const contribution =
		args.excluded || account?.projectionCashExcluded
			? 0
			: args.monthlyContribution;
	const priorContribution = old && !old.excluded ? old.monthlyContribution : 0;
	if (contribution > priorContribution) {
		const data = await list(ctx, args.spaceId);
		const total = data.accounts
			.filter((a) => !a.projectionCashExcluded)
			.flatMap((a) => a.holdings)
			.filter((h) => !h.excluded && h._id !== old?._id)
			.reduce((sum, h) => sum + h.monthlyContribution, contribution);
		if (total > data.savingsTarget)
			throw new ConvexError(
				"Investment contributions cannot exceed this month's savings target.",
			);
	}
	const value = {
		accountId: accountId!,
		name: linked ? old!.name : label(args.name),
		type,
		ticker: linked ? old!.ticker : tickerSymbol(args.ticker),
		balance: linked ? old!.balance : args.balance,
		currency: linked ? old!.currency : "USD",
		asOf: linked
			? old!.asOf
			: today((await access(ctx, args.spaceId)).space.timeZone),
		annualReturnOverride: args.annualReturnOverride,
		monthlyContribution: args.monthlyContribution,
		excluded: args.excluded,
		fixedIncomeOverride: args.fixedIncome,
		active: true,
		revision: args.revision + 1,
	};
	if (old) await ctx.db.patch(old._id, value);
	else await ctx.db.insert("holdings", value);
	if (
		value.ticker &&
		args.annualReturnOverride === undefined &&
		["stock", "etf", "mutualFund"].includes(type)
	)
		await ctx.scheduler.runAfter(0, internal.investments.fetchReturn, {
			ticker: value.ticker,
		});
}

export async function removeHolding(
	ctx: MutationCtx,
	id: Id<"holdings">,
	revision: number,
) {
	const holding = await ctx.db.get(id);
	const account = holding ? await ctx.db.get(holding.accountId) : null;
	if (!holding || !account) throw new ConvexError("Holding not found.");
	await access(ctx, account.spaceId, true);
	if (account.connectionId)
		throw new ConvexError(
			"Exclude imported holdings instead of deleting them.",
		);
	assertRevision(holding.revision, revision);
	await ctx.db.delete(id);
}

export async function includeCash(
	ctx: MutationCtx,
	id: Id<"accounts">,
	excluded: boolean,
	revision: number,
) {
	const account = await ctx.db.get(id);
	if (
		!account ||
		(!account.investment && !["checking", "savings"].includes(account.type))
	)
		throw new ConvexError("Forecast account not found.");
	await access(ctx, account.spaceId, true);
	assertRevision(account.revision, revision);
	await ctx.db.patch(id, {
		projectionCashExcluded: excluded,
		revision: revision + 1,
	});
}
