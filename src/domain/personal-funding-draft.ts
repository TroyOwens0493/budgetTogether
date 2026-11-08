import { cents, money } from "./budget";

export type PersonalFunding<Id extends string = string> = {
	privateId: Id;
	name: string;
	active: boolean;
	amount: number;
	revision: number;
	automatic: boolean;
};

export function fundingSignature(people: readonly PersonalFunding[]) {
	return JSON.stringify(
		people
			.map(({ privateId, amount, revision, automatic }) => [
				privateId,
				amount,
				revision,
				automatic,
			])
			.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
	);
}

export function evaluatePersonalFunding<Id extends string>(
	people: readonly PersonalFunding<Id>[],
	amounts: Record<string, string>,
) {
	try {
		const changes = people.flatMap((person) => {
			const value = amounts[person.privateId];
			if (value === undefined) return [];
			const amount = money(cents(value), true);
			return amount === person.amount
				? []
				: [{ privateId: person.privateId, amount }];
		});
		const total = money(
			people.reduce(
				(sum, person) =>
					sum +
					(changes.find((x) => x.privateId === person.privateId)?.amount ??
						person.amount),
				0,
			),
			true,
		);
		return { changes, total };
	} catch {
		return null;
	}
}
