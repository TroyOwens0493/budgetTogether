import type { PersonalFunding } from "../domain/personal-funding-draft";
import { amountError } from "../domain/validation";
import { ValidatedInput } from "./ValidatedInput";

/** Funding fields belong to the monthly budget form and share its save action. */
export function PersonalAllocationsView({
	people,
	amounts,
	onChange,
}: {
	people: readonly PersonalFunding[];
	amounts: Record<string, string>;
	onChange: (privateId: string, value: string) => void;
}) {
	if (!people.length) return null;
	return (
		<div>
			<div className="divider" />
			<h3>Personal budget funding</h3>
			{people.map((person) => (
				<label
					className="allocation-row"
					key={person.privateId}
					htmlFor={`personal-${person.privateId}`}
				>
					<span>{person.name}'s personal amount</span>
					<ValidatedInput
						id={`personal-${person.privateId}`}
						aria-label={`${person.name}'s personal amount`}
						value={
							amounts[person.privateId] ?? (person.amount / 100).toFixed(2)
						}
						inputMode="decimal"
						required
						disabled={!person.active}
						validate={amountError}
						onChange={(event) => onChange(person.privateId, event.target.value)}
					/>
				</label>
			))}
		</div>
	);
}
