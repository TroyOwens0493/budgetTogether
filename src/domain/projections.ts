import { money } from "./budget";

export type ProjectionAsset = {
	id: string;
	balance: number;
	monthlyContribution: number;
	annualReturn: number;
	fixedIncome?: FixedIncome;
};

export type FixedIncome = {
	kind: "bond" | "cd";
	maturityDate: string;
	faceValue?: number;
	couponRate?: number;
	paymentsPerYear?: number;
	nextPaymentDate?: string;
};

export function calendarDate(value: string): string {
	dateTime(value);
	return value;
}

export function addMonths(value: string, months: number): string {
	const date = new Date(dateTime(value));
	const day = date.getUTCDate();
	date.setUTCDate(1);
	date.setUTCMonth(date.getUTCMonth() + months);
	const last = new Date(date.getTime());
	last.setUTCMonth(last.getUTCMonth() + 1);
	last.setUTCDate(0);
	date.setUTCDate(Math.min(day, last.getUTCDate()));
	return date.toISOString().slice(0, 10);
}

export function forecastHorizon(currentAge: number, targetAge: number) {
	if (
		!Number.isInteger(currentAge) ||
		!Number.isInteger(targetAge) ||
		currentAge < 0 ||
		targetAge > 120 ||
		targetAge <= currentAge ||
		targetAge - currentAge > 100
	)
		throw new Error(
			"Enter whole ages from 0 to 120, with a future age at most 100 years ahead.",
		);
	return (targetAge - currentAge) * 12;
}

export function validateFixedIncome(value: FixedIncome, startsOn: string) {
	calendarDate(value.maturityDate);
	if (value.maturityDate <= calendarDate(startsOn))
		throw new Error("Update this matured holding before making a forecast.");
	if (value.kind === "cd")
		return { ...value, faceValue: 0, couponRate: 0, paymentsPerYear: 12 };
	if (value.faceValue === undefined || value.faceValue <= 0)
		throw new Error("Enter the bond's total face value.");
	money(value.faceValue, true);
	if (
		value.couponRate === undefined ||
		!Number.isFinite(value.couponRate) ||
		value.couponRate < 0 ||
		value.couponRate > 100
	)
		throw new Error("Enter a bond coupon rate from 0% to 100%.");
	if (value.couponRate === 0)
		return {
			...value,
			faceValue: value.faceValue,
			couponRate: 0,
			paymentsPerYear: 12,
			nextPaymentDate: undefined,
		};
	if (
		![1, 2, 4, 12].includes(value.paymentsPerYear ?? 0) ||
		!value.nextPaymentDate
	)
		throw new Error(
			"Enter the bond's payment frequency and next payment date.",
		);
	calendarDate(value.nextPaymentDate);
	if (
		value.nextPaymentDate <= startsOn ||
		value.nextPaymentDate > value.maturityDate
	)
		throw new Error(
			"The next coupon date must be after today and no later than maturity.",
		);
	return {
		...value,
		faceValue: value.faceValue,
		couponRate: value.couponRate,
		paymentsPerYear: value.paymentsPerYear ?? 12,
	};
}

export type ProjectionPoint = {
	month: number;
	cash: number;
	investments: number;
	total: number;
	contributions: number;
	growth: number;
	assets: Record<string, number>;
};

export function annualReturn(value: number): number {
	if (!Number.isFinite(value) || value <= -100 || value > 1000)
		throw new Error("Enter an annual return above -100% and at most 1,000%.");
	return value;
}

/**
 * Rates are effective annual percentages. Contributions arrive at month end.
 * Keep fractional cents while compounding; round only the displayed points.
 * Cash and investment contributions are separate inputs so callers can apply
 * their funding rule without changing the compound-growth calculation.
 */
export function project({
	cash,
	investments,
	months,
	startsOn,
}: {
	cash: Omit<ProjectionAsset, "id">;
	investments: ProjectionAsset[];
	months: number;
	startsOn?: string;
}): ProjectionPoint[] {
	if (!Number.isInteger(months) || months < 1 || months > 1200)
		throw new Error("Choose a forecast between 1 and 1,200 months.");
	if (
		investments.some((asset) => !asset.id || asset.id === "__proto__") ||
		new Set(investments.map((asset) => asset.id)).size !== investments.length
	)
		throw new Error("Each investment must have a unique identifier.");
	const inputs = [cash, ...investments];
	for (const asset of inputs) {
		money(asset.balance, true);
		money(asset.monthlyContribution, true);
		annualReturn(asset.annualReturn);
		if ("fixedIncome" in asset && asset.fixedIncome) {
			if (!startsOn)
				throw new Error("A forecast start date is required for bonds and CDs.");
			validateFixedIncome(asset.fixedIncome, startsOn);
			if (asset.monthlyContribution !== 0)
				throw new Error(
					"Add a new holding for additional bond or CD purchases.",
				);
		}
	}
	const factors = inputs.map(
		(asset) => (1 + asset.annualReturn / 100) ** (1 / 12),
	);
	const balances = inputs.map((asset) => asset.balance);
	const starting = money(balances.reduce((sum, balance) => sum + balance, 0));
	const monthly = money(
		inputs.reduce((sum, asset) => sum + asset.monthlyContribution, 0),
	);
	const points: ProjectionPoint[] = [];
	const fixedTerms = investments.map((asset) =>
		asset.fixedIncome
			? validateFixedIncome(asset.fixedIncome, startsOn ?? "")
			: undefined,
	);
	const couponDates = fixedTerms.map((fixed) => fixed?.nextPaymentDate);
	const couponCounts = investments.map(() => 0);
	for (let month = 0; month <= months; month++) {
		if (month > 0) {
			balances[0] = balances[0] * factors[0] + cash.monthlyContribution;
			for (let index = 1; index < balances.length; index++) {
				const asset = investments[index - 1];
				const fixed = fixedTerms[index - 1];
				if (!fixed) {
					balances[index] =
						balances[index] * factors[index] + asset.monthlyContribution;
					continue;
				}
				const date = addMonths(startsOn ?? "", month);
				const previous = addMonths(startsOn ?? "", month - 1);
				if (fixed.maturityDate <= previous) continue;
				if (fixed.kind === "cd") {
					const fraction = Math.min(
						1,
						(dateTime(fixed.maturityDate) - dateTime(previous)) /
							(dateTime(date) - dateTime(previous)),
					);
					balances[index] *= factors[index] ** fraction;
				} else {
					let coupon = couponDates[index - 1];
					while (coupon && coupon <= date && coupon <= fixed.maturityDate) {
						balances[0] +=
							(fixed.faceValue * fixed.couponRate) /
							100 /
							fixed.paymentsPerYear;
						couponCounts[index - 1]++;
						coupon = addMonths(
							fixed.nextPaymentDate ?? "",
							(couponCounts[index - 1] * 12) / fixed.paymentsPerYear,
						);
					}
					couponDates[index - 1] = coupon;
				}
				if (fixed.maturityDate <= date) {
					balances[0] +=
						fixed.kind === "bond" ? fixed.faceValue : balances[index];
					balances[index] = 0;
				}
			}
		}
		const rounded = balances.map((balance) => money(Math.round(balance), true));
		const investmentTotal = money(
			rounded.slice(1).reduce((sum, balance) => sum + balance, 0),
		);
		const total = money(rounded[0] + investmentTotal);
		const contributions = money(monthly * month);
		points.push({
			month,
			cash: rounded[0],
			investments: investmentTotal,
			total,
			contributions,
			growth: money(total - starting - contributions),
			assets: Object.fromEntries(
				investments.map((asset, index) => [asset.id, rounded[index + 1]]),
			),
		});
	}
	return points;
}

export type HistoricalPrice = { date: string; adjustedClose: number };

function dateTime(value: string): number {
	const time = Date.parse(`${value}T00:00:00Z`);
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
		!Number.isFinite(time) ||
		new Date(time).toISOString().slice(0, 10) !== value
	)
		throw new Error("Historical prices must have valid calendar dates.");
	return time;
}

/** Annualized compound growth, using prices adjusted for splits and dividends. */
export function historicalReturn(
	prices: HistoricalPrice[],
	years: number,
	asOf: string,
) {
	if (!Number.isInteger(years) || years < 1 || years > 100)
		throw new Error("Choose a historical period between 1 and 100 years.");
	const endLimit = dateTime(asOf);
	const sorted = prices
		.map((point) => {
			const time = dateTime(point.date);
			if (!Number.isFinite(point.adjustedClose) || point.adjustedClose <= 0)
				throw new Error("Historical adjusted prices must be positive.");
			return { ...point, time };
		})
		.filter((point) => point.time <= endLimit)
		.sort((a, b) => a.time - b.time);
	if (new Set(sorted.map((point) => point.date)).size !== sorted.length)
		throw new Error("Historical prices contain duplicate dates.");
	const end = sorted.at(-1);
	if (!end) throw new Error("No historical prices are available.");
	const cutoff = new Date(end.time);
	cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
	// Select a real observation on or before the requested anniversary. When
	// history is shorter, use the earliest available date and report it exactly.
	const start =
		sorted.filter((point) => point.time <= cutoff.getTime()).at(-1) ??
		sorted[0];
	const elapsedYears = (end.time - start.time) / (365.2425 * 86400000);
	if (end.time - start.time < 365 * 86400000)
		throw new Error("At least one year of historical prices is required.");
	const rate = annualReturn(
		((end.adjustedClose / start.adjustedClose) ** (1 / elapsedYears) - 1) * 100,
	);
	return {
		rate,
		startDate: start.date,
		endDate: end.date,
		years: elapsedYears,
	};
}
