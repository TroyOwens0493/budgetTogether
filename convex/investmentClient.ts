import { money } from "../src/domain/budget";
import { historicalReturn } from "../src/domain/projections";
import type { PlaidAccount } from "./plaidClient";
import type { importedHolding } from "./projectionTypes";

export type HoldingsResponse = {
	accounts: PlaidAccount[];
	holdings: {
		account_id: string;
		security_id: string;
		institution_value: number | null;
		institution_price_as_of?: string | null;
		quantity: number;
		iso_currency_code?: string | null;
		unofficial_currency_code?: string | null;
	}[];
	securities: {
		security_id: string;
		name?: string | null;
		ticker_symbol?: string | null;
		type?: string | null;
		subtype?: string | null;
		is_cash_equivalent?: boolean | null;
		fixed_income?: {
			maturity_date?: string | null;
			face_value?: number | null;
			yield_rate?: { percentage: number; type?: string | null } | null;
		} | null;
	}[];
};

export function normalizeHoldings(data: HoldingsResponse) {
	return data.accounts
		.filter((account) => account.type === "investment")
		.map((account) => {
			const holdings: (typeof importedHolding.type)[] = data.holdings
				.filter((holding) => holding.account_id === account.account_id)
				.map((holding) => {
					const security = data.securities.find(
						(item) => item.security_id === holding.security_id,
					);
					const type =
						security?.type === "equity"
							? "stock"
							: security?.type === "etf"
								? "etf"
								: security?.type === "mutual fund"
									? "mutualFund"
									: security?.type === "fixed income"
										? /\bcd\b|certificate of deposit/i.test(
												security.subtype ?? "",
											)
											? "cd"
											: "bond"
										: security?.type === "cash"
											? "cash"
											: "unsupported";
					const currency =
						holding.iso_currency_code ??
						holding.unofficial_currency_code ??
						"unknown";
					const value = holding.institution_value;
					const problem =
						currency !== "USD"
							? "Only USD holdings can be forecast."
							: value === null || !Number.isFinite(value)
								? "The provider did not supply a holding value."
								: value < 0 || holding.quantity < 0
									? "Short positions cannot be forecast."
									: type === "unsupported"
										? "This investment type is outside this forecast's scope."
										: undefined;
					const fixed = security?.fixed_income;
					return {
						externalId: holding.security_id,
						name: security?.name ?? "Unnamed holding",
						type,
						ticker: security?.ticker_symbol?.trim().toUpperCase() || undefined,
						balance:
							value !== null && Number.isFinite(value)
								? money(Math.round(value * 100))
								: undefined,
						asOf: holding.institution_price_as_of ?? undefined,
						currency,
						problem,
						fixedIncome: fixed
							? {
									maturityDate: fixed.maturity_date ?? undefined,
									faceValue:
										fixed.face_value != null
											? money(
													Math.round(fixed.face_value * holding.quantity * 100),
													true,
												)
											: undefined,
									couponRate:
										fixed.yield_rate?.type === "coupon"
											? fixed.yield_rate.percentage
											: undefined,
								}
							: undefined,
					};
				});
			return { account, holdings };
		});
}

export async function fetchHistoricalReturn(ticker: string) {
	const key = process.env.ALPHA_VANTAGE_API_KEY;
	if (!key)
		throw new Error(
			"Historical returns are unavailable until the market-data service is configured. Enter your own annual return.",
		);
	const url = new URL("https://www.alphavantage.co/query");
	url.search = new URLSearchParams({
		function: "TIME_SERIES_MONTHLY_ADJUSTED",
		symbol: ticker,
		apikey: key,
	}).toString();
	const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
	if (!response.ok)
		throw new Error(
			"The historical-price service is unavailable. Try again later.",
		);
	const body = await response.json();
	const series = body["Monthly Adjusted Time Series"];
	if (!series || typeof series !== "object" || Array.isArray(series))
		throw new Error(
			body.Information || body.Note
				? "The historical-price service reached its limit or requires a different data plan. Enter a return or try again later."
				: "No adjusted price history was found for this symbol. Check its symbol or enter a return.",
		);
	// Never expose the provider's raw errors: they may contain request details.
	return historicalReturn(
		Object.entries(series).map(([date, row]) => ({
			date,
			adjustedClose: Number(
				(row as Record<string, unknown>)["5. adjusted close"],
			),
		})),
		10,
		new Date().toISOString().slice(0, 10),
	);
}
