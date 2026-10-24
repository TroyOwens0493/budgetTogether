import { money, month } from "./budget";

export type FundSchedule = {
	effectiveMonth: string;
	name: string;
	targetAmount: number;
	targetMonth?: string;
	intervalMonths?: number;
	monthlyAmount?: number;
	createdAt: number;
};
export type Fund = {
	_id: string;
	startMonth: string;
	openingBalance: number;
	revision: number;
	schedules: FundSchedule[];
};
export type FundContribution = {
	fundId: string;
	month: string;
	amount: number;
};
export type FundPayment = { fundId: string; month: string; amount: number };

function monthNumber(value: string) {
	const [year, m] = month(value).split("-").map(Number);
	if (year < 1) throw new Error("Choose a month between 0001-01 and 9999-12.");
	return year * 12 + m - 1;
}
function fromMonthNumber(value: number): string {
	if (value < 12 || value >= 120000)
		throw new Error("The next payment falls outside the supported dates.");
	return `${String(Math.floor(value / 12)).padStart(4, "0")}-${String((value % 12) + 1).padStart(2, "0")}`;
}

export function validateFundSchedule(
	schedule: FundSchedule,
	startMonth: string,
) {
	monthNumber(startMonth);
	monthNumber(schedule.effectiveMonth);
	if (schedule.effectiveMonth < startMonth)
		throw new Error("Changes cannot start before the fund's start month.");
	if (!schedule.name.trim() || schedule.name.trim().length > 100)
		throw new Error("Enter a fund name with 1 to 100 characters.");
	if (money(schedule.targetAmount, true) === 0)
		throw new Error("The target amount must be greater than zero.");
	if (schedule.targetMonth) {
		monthNumber(schedule.targetMonth);
		if (schedule.targetMonth < schedule.effectiveMonth)
			throw new Error("The target month cannot be before the change month.");
	}
	if (schedule.intervalMonths !== undefined) {
		if (
			!Number.isInteger(schedule.intervalMonths) ||
			schedule.intervalMonths < 2 ||
			schedule.intervalMonths > 120 ||
			!schedule.targetMonth ||
			schedule.monthlyAmount !== undefined
		)
			throw new Error(
				"Choose a next payment month and an interval of 2 to 120 months.",
			);
	} else if (!schedule.targetMonth) {
		if (money(schedule.monthlyAmount ?? 0, true) === 0)
			throw new Error("Choose a target month or a positive monthly amount.");
	} else if (schedule.monthlyAmount !== undefined)
		throw new Error("Choose either a target month or a monthly amount.");
}

/** Dates include the target month. Saved allocations, rather than assumed
 * deposits, determine catch-up amounts. A paid one-time goal stays complete. */
export function fundForMonth(
	fund: Fund,
	selectedMonth: string,
	contributions: FundContribution[],
	payments: FundPayment[],
) {
	const selected = monthNumber(selectedMonth);
	// Keep the last edit for each effective month. Earlier edits stay stored
	// so a former partner's read cutoff can still select the old values.
	const byMonth = new Map<string, FundSchedule>();
	for (const row of fund.schedules)
		if (row.effectiveMonth <= selectedMonth)
			byMonth.set(row.effectiveMonth, row);
	const history = [...byMonth.values()].sort((a, b) =>
		a.effectiveMonth.localeCompare(b.effectiveMonth),
	);
	const schedule = history.at(-1);
	if (!schedule || selectedMonth < fund.startMonth) return null;
	const credits = contributions.filter((row) => row.fundId === fund._id);
	const debits = payments.filter((row) => row.fundId === fund._id);
	const sum = (rows: { amount: number }[]) =>
		money(rows.reduce((total, row) => money(total + row.amount), 0));
	const priorCredits = sum(credits.filter((row) => row.month < selectedMonth));
	const currentCredits = sum(
		credits.filter((row) => row.month === selectedMonth),
	);
	const spent = sum(debits.filter((row) => row.month <= selectedMonth));
	const credited = money(fund.openingBalance + priorCredits);
	const balanceBeforeMonth = money(
		credited - sum(debits.filter((row) => row.month < selectedMonth)),
	);
	let targetMonth = schedule.targetMonth;
	let requiredTotal = schedule.targetAmount;
	if (schedule.intervalMonths && targetMonth) {
		const first = monthNumber(targetMonth);
		const cycle = Math.max(
			0,
			Math.ceil((selected - first) / schedule.intervalMonths),
		);
		targetMonth = fromMonthNumber(first + cycle * schedule.intervalMonths);
		// Each cycle needs a new payment amount, even if an earlier bill has
		// not posted yet. Funds for that earlier bill remain reserved.
		let earlierPayments = 0;
		for (let i = 0; i < history.length - 1; i++) {
			const prior = history[i];
			if (!prior.intervalMonths || !prior.targetMonth) continue;
			const firstDue = monthNumber(prior.targetMonth);
			const end = monthNumber(history[i + 1].effectiveMonth);
			const count = Math.max(
				0,
				Math.ceil((end - firstDue) / prior.intervalMonths),
			);
			earlierPayments = money(earlierPayments + count * prior.targetAmount);
		}
		const cycleStart =
			cycle === 0
				? schedule.effectiveMonth
				: fromMonthNumber(first + (cycle - 1) * schedule.intervalMonths + 1);
		const spentBeforeCycle = sum(
			debits.filter((row) => row.month < cycleStart),
		);
		requiredTotal = money(
			Math.max(
				earlierPayments + cycle * schedule.targetAmount,
				spentBeforeCycle,
			) + schedule.targetAmount,
		);
	}
	const remaining = Math.max(0, money(requiredTotal - credited));
	const monthsLeft = targetMonth
		? Math.max(1, monthNumber(targetMonth) - selected + 1)
		: null;
	const required =
		monthsLeft === null
			? Math.min(remaining, schedule.monthlyAmount ?? 0)
			: Math.ceil(remaining / monthsLeft);
	return {
		...schedule,
		_id: fund._id,
		revision: fund.revision,
		startMonth: fund.startMonth,
		openingBalance: fund.openingBalance,
		targetMonth,
		required: money(required, true),
		contributed: currentCredits,
		balanceBeforeMonth,
		balance: money(credited + currentCredits - spent),
		remaining,
		complete: !schedule.intervalMonths && remaining <= currentCredits,
	};
}
