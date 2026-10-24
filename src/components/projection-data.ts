import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import {
	type FixedIncome,
	forecastHorizon,
	type ProjectionAsset,
	project,
} from "../domain/projections";

export type ProjectionData = FunctionReturnType<typeof api.projections.list>;
export type InvestmentAccount = ProjectionData["accounts"][number];
export type Holding = InvestmentAccount["holdings"][number];
export const investmentNames = {
	stock: "Stock",
	etf: "ETF",
	mutualFund: "Mutual fund",
	bond: "Bond",
	cd: "CD",
	cash: "Account cash",
	unsupported: "Unsupported holding",
};

export function effectiveFixed(holding: Holding) {
	return { ...holding.fixedIncome, ...holding.fixedIncomeOverride };
}

export function holdingReturn(holding: Holding) {
	return holding.type === "cash"
		? (holding.annualReturnOverride ?? 0)
		: holding.type === "bond"
			? 0
			: holding.type === "cd"
				? (holding.annualReturnOverride ?? effectiveFixed(holding).apy)
				: (holding.annualReturnOverride ?? holding.history?.rate);
}

export function prepareProjection(data: ProjectionData) {
	const errors: string[] = [];
	const warnings: string[] = [];
	const settings = data.settings;
	if (!settings)
		errors.push("Set your age, forecast age, and cash assumptions to start.");
	if (!data.savedPlan)
		errors.push(
			`Save a balanced monthly budget for ${data.month} to use its savings target.`,
		);
	let cash = settings?.cashBalance ?? 0;
	let allocated = 0;
	const investments: ProjectionAsset[] = [];
	let excluded = 0;
	for (const account of data.accounts) {
		if (account.projectionCashExcluded) continue;
		if (account.stale)
			warnings.push(
				`${account.name}: the last import did not complete. This forecast uses the last available data.`,
			);
		if (!account.investment) {
			if (
				account.balance === undefined ||
				account.currency !== "USD" ||
				account.balance < 0
			)
				errors.push(
					`${account.name}: a nonnegative USD cash balance is required. Sync the account or exclude it.`,
				);
			else cash += account.balance;
			continue;
		}
		if (account.linked) {
			const total = account.holdings.reduce(
				(sum, h) => sum + (h.balance ?? 0),
				0,
			);
			if (
				account.balance !== undefined &&
				Math.abs(total - account.balance) > 100
			)
				errors.push(
					`${account.name}: reported holdings do not match the account balance. Sync the account or exclude it until its data is complete.`,
				);
		}
		for (const holding of account.holdings) {
			if (holding.excluded) {
				excluded++;
				continue;
			}
			allocated += holding.monthlyContribution;
			if (holding.problem) errors.push(`${holding.name}: ${holding.problem}`);
			const rate = holdingReturn(holding);
			if (rate === undefined)
				errors.push(
					`${holding.name}: enter an annual return or load historical returns.`,
				);
			if (
				holding.balance === undefined ||
				holding.currency !== "USD" ||
				holding.balance < 0
			)
				errors.push(`${holding.name}: a nonnegative USD value is required.`);
			if (holding.history?.error && holding.annualReturnOverride === undefined)
				warnings.push(`${holding.name}: ${holding.history.error}`);
			if (
				holding.history?.fetchedAt &&
				Date.now() - holding.history.fetchedAt > 35 * 86400000 &&
				holding.annualReturnOverride === undefined
			)
				warnings.push(
					`${holding.name}: the saved historical return is old. Refresh returns when possible.`,
				);
			const fixed = effectiveFixed(holding);
			const fixedIncome: FixedIncome | undefined =
				holding.type === "bond" || holding.type === "cd"
					? {
							kind: holding.type,
							maturityDate: fixed.maturityDate ?? "",
							faceValue: fixed.faceValue,
							couponRate: fixed.couponRate,
							paymentsPerYear: fixed.paymentsPerYear,
							nextPaymentDate: fixed.nextPaymentDate,
						}
					: undefined;
			investments.push({
				id: holding._id,
				balance: holding.balance ?? 0,
				monthlyContribution: holding.monthlyContribution,
				annualReturn: rate ?? 0,
				fixedIncome,
			});
		}
	}
	if (allocated > data.savingsTarget)
		errors.push(
			"Investment contributions exceed the current monthly savings target. Reduce the contributions or update your budget.",
		);
	if (excluded)
		warnings.push(
			`${excluded} holding${excluded === 1 ? " is" : "s are"} excluded from the forecast.`,
		);
	let points: ReturnType<typeof project> = [];
	if (!errors.length && settings) {
		try {
			points = project({
				cash: {
					balance: cash,
					monthlyContribution: data.savingsTarget - allocated,
					annualReturn: settings.cashAnnualReturn,
				},
				investments,
				months: forecastHorizon(settings.currentAge, settings.targetAge),
				startsOn: data.startsOn,
			});
		} catch (error) {
			errors.push(
				error instanceof Error ? error.message : "Check the forecast inputs.",
			);
		}
	}
	return {
		errors,
		warnings,
		points,
		cash,
		allocated,
		cashMonthly: data.savingsTarget - allocated,
	};
}
