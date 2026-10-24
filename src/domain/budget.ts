/** Money is stored as integer US cents. Plaid amounts are positive for outflows. */
export function cents(value: string): number {
	if (!/^-?\d+(\.\d{1,2})?$/.test(value.trim()))
		throw new Error("Enter an amount with at most two decimal places.");
	const [whole, fraction = ""] = value.trim().replace("-", "").split(".");
	return money(
		(value.trim().startsWith("-") ? -1 : 1) *
			(Number(whole) * 100 + Number(fraction.padEnd(2, "0"))),
	);
}
export function money(value: number, nonnegative = false): number {
	if (!Number.isSafeInteger(value) || (nonnegative && value < 0))
		throw new Error("Amounts must be whole cents and cannot be negative here.");
	return value;
}
export function month(value: string): string {
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
		throw new Error("Use a valid month in YYYY-MM format.");
	return value;
}
export function nextMonth(value: string): string {
	const [year, m] = month(value).split("-").map(Number);
	return `${m === 12 ? year + 1 : year}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
}
export type Plan = {
	expectedIncome: number;
	savingsTarget: number;
	limits: { categoryId: string; amount: number }[];
};
export function isPlanSaved(
	plan: { saved?: boolean; status?: "draft" | "active" } | null,
): boolean {
	// Read existing records until they are next saved with the new field.
	return plan?.saved ?? plan?.status === "active";
}
export function planBalance(
	plan: Plan,
	incoming = 0,
	outgoing = 0,
	carry = 0,
	fundAmount = 0,
): number {
	for (const value of [
		plan.expectedIncome,
		plan.savingsTarget,
		incoming,
		outgoing,
		carry,
		fundAmount,
		...plan.limits.map((x) => x.amount),
	])
		money(value, true);
	if (new Set(plan.limits.map((x) => x.categoryId)).size !== plan.limits.length)
		throw new Error("Each category can have only one limit.");
	return money(
		plan.expectedIncome +
			incoming +
			carry -
			outgoing -
			plan.savingsTarget -
			fundAmount -
			plan.limits.reduce((sum, x) => sum + x.amount, 0),
	);
}
export type Entry = {
	amount: number;
	kind: "purchase" | "income" | "transfer";
	pending: boolean;
	removed?: boolean;
	splits: { categoryId: string; amount: number; fundId?: string }[];
};
export function validateSplits(amount: number, splits: Entry["splits"]): void {
	money(amount);
	if (
		!splits.length ||
		splits.some(
			(x) =>
				!x.categoryId ||
				!Number.isSafeInteger(x.amount) ||
				(amount < 0 ? x.amount > 0 : x.amount < 0),
		) ||
		splits.reduce((sum, x) => sum + x.amount, 0) !== amount
	)
		throw new Error(
			"Split amounts must have the same sign and total the transaction amount.",
		);
}
export function totals(entries: Entry[], incoming = 0, outgoing = 0) {
	let income = 0;
	let spending = 0;
	let pending = 0;
	const categories: Record<string, number> = {};
	for (const entry of entries) {
		if (entry.removed || entry.kind === "transfer") continue;
		if (entry.pending) {
			if (entry.kind === "purchase") pending += entry.amount;
			continue;
		}
		if (entry.kind === "income") income -= entry.amount;
		else {
			spending += entry.amount;
			for (const split of entry.splits)
				categories[split.categoryId] =
					(categories[split.categoryId] ?? 0) + split.amount;
		}
	}
	return {
		income,
		spending,
		pending,
		categories,
		incoming,
		outgoing,
		savings: income + incoming - outgoing - spending,
	};
}
export function leftovers(
	actualSavings: number,
	target: number,
	reserved = 0,
): number {
	return Math.max(0, actualSavings - target) - reserved;
}
export function assertRevision(actual: number, expected: number): void {
	if (actual !== expected)
		throw new Error(
			"This record changed. Reload its current values before saving.",
		);
}
export function recurring(
	entries: {
		description: string;
		date: string;
		amount: number;
		pending: boolean;
		kind: string;
		removed?: boolean;
	}[],
) {
	const groups = new Map<string, typeof entries>();
	for (const entry of entries)
		if (
			!entry.pending &&
			!entry.removed &&
			entry.kind === "purchase" &&
			entry.amount > 0
		) {
			const key = entry.description.toLowerCase().trim();
			groups.set(key, [...(groups.get(key) ?? []), entry]);
		}
	return [...groups.entries()].flatMap(([merchant, rows]) => {
		rows.sort((a, b) => a.date.localeCompare(b.date));
		if (rows.length < 3) return [];
		const last = rows.slice(-3);
		const gaps = last
			.slice(1)
			.map(
				(row, i) =>
					(Date.parse(row.date) - Date.parse(last[i].date)) / 86400000,
			);
		const average = Math.round(last.reduce((sum, x) => sum + x.amount, 0) / 3);
		if (
			gaps.some((gap) => gap < 25 || gap > 35) ||
			last.some(
				(x) => Math.abs(x.amount - average) > Math.max(100, average * 0.15),
			)
		)
			return [];
		const date = new Date(`${last[2].date}T12:00:00Z`);
		date.setUTCMonth(date.getUTCMonth() + 1);
		return [
			{ merchant, amount: average, date: date.toISOString().slice(0, 10) },
		];
	});
}
