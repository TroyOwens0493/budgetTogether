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

export class HistoricalDataError extends Error {}

export function tiingoSymbol(value: string) {
	const symbol = value.trim().toUpperCase().replaceAll(".", "-");
	if (!/^[A-Z0-9][A-Z0-9-]{0,29}$/.test(symbol))
		throw new HistoricalDataError(
			"Check this investment's trading symbol before loading Tiingo history.",
		);
	return symbol;
}

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
										? "This investment type is unsupported."
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
	const key = process.env.TIINGO_API_TOKEN?.trim();
	if (!key)
		throw new HistoricalDataError(
			"Historical returns need a Tiingo API token. Set up Tiingo or enter your own annual return.",
		);
	const asOf = new Date().toISOString().slice(0, 10);
	const from = new Date(`${asOf}T00:00:00Z`);
	from.setUTCFullYear(from.getUTCFullYear() - 10);
	// Include a buffer before the anniversary so the CAGR can use a real
	// month-end observation at least ten years before the latest sample.
	from.setUTCMonth(from.getUTCMonth() - 2);
	const url = new URL(
		`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(tiingoSymbol(ticker))}/prices`,
	);
	url.search = new URLSearchParams({
		startDate: from.toISOString().slice(0, 10),
		endDate: asOf,
		resampleFreq: "monthly",
		format: "json",
	}).toString();
	const response = await fetch(url, {
		headers: { Authorization: `Token ${key}`, Accept: "application/json" },
		signal: AbortSignal.timeout(20000),
	});
	if (response.status === 401 || response.status === 403)
		throw new HistoricalDataError(
			"Tiingo could not authorize this history request. Check the API token and data access, or enter a return.",
		);
	if (response.status === 429)
		throw new HistoricalDataError(
			"Tiingo's request limit was reached. Try again later or enter a return.",
		);
	if (response.status === 404)
		throw new HistoricalDataError(
			"Tiingo has no price history for this symbol. Check its symbol or enter a return.",
		);
	if (!response.ok)
		throw new HistoricalDataError(
			"Tiingo's historical-price service is unavailable. Try again later.",
		);
	let series: unknown;
	try {
		series = await response.json();
	} catch {
		throw new HistoricalDataError(
			"Tiingo returned invalid price history. Try again later or enter a return.",
		);
	}
	if (!Array.isArray(series) || !series.length)
		throw new HistoricalDataError(
			"Tiingo has no adjusted price history for this symbol. Check its symbol or enter a return.",
		);
	// Use only adjusted closing prices. Raw closes omit distributions and can
	// give a false return across stock splits. Never expose raw provider errors.
	try {
		return historicalReturn(
			series.map((row: unknown) => {
				if (
					!row ||
					typeof row !== "object" ||
					!("date" in row) ||
					typeof row.date !== "string" ||
					!("adjClose" in row) ||
					typeof row.adjClose !== "number"
				)
					throw new Error(
						"Tiingo did not supply valid adjusted prices. Enter a return or try again later.",
					);
				return { date: row.date.slice(0, 10), adjustedClose: row.adjClose };
			}),
			10,
			asOf,
		);
	} catch (error) {
		throw new HistoricalDataError(
			error instanceof Error
				? error.message
				: "Historical return calculation failed.",
		);
	}
}
