import { cents, type Entry, validateSplits } from "./budget";

export function parseTransactionAmounts(
	kind: Entry["kind"],
	value: string,
	splits: { categoryId: string; amount: string; fundId?: string }[],
):
	| { data: { amount: number; splits: Entry["splits"] }; error: null }
	| { data: null; error: string } {
	try {
		const amount = cents(value);
		const allocations =
			kind === "purchase"
				? splits.map((split) => ({
						categoryId: split.categoryId,
						amount: splits.length === 1 ? amount : cents(split.amount),
						...(split.fundId ? { fundId: split.fundId } : {}),
					}))
				: [];
		if (kind === "purchase") validateSplits(amount, allocations);
		return { data: { amount, splits: allocations }, error: null };
	} catch (error) {
		return {
			data: null,
			error: error instanceof Error ? error.message : "Check the amounts.",
		};
	}
}
