import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cents } from "../domain/budget";
import { MoneyInput } from "./ui";
import type { Run } from "./view-types";

type Person = {
	privateId: Id<"spaces">;
	name: string;
	active: boolean;
	amount: number;
	revision: number;
};
type Props = {
	sharedId: Id<"spaces">;
	month: string;
	active: boolean;
	run: Run;
};

export function PersonalAllocationsView(props: Props) {
	const people = useQuery(api.personalAllocations.list, {
		sharedId: props.sharedId,
		month: props.month,
	});
	return (
		<section className="panel">
			<h2>Personal budget funding</h2>
			<p>
				Assign a monthly amount to each personal budget. It reduces shared
				funding and is available at once. No bank transfer is needed.
			</p>
			<p className="muted">
				Both partners can change these amounts. Personal spending and
				transactions stay private. After a change, balance and save the affected
				budgets.
			</p>
			{!people ? (
				<p>Loading personal funding…</p>
			) : (
				people.map((person) => (
					<AllocationRow key={person.privateId} {...props} person={person} />
				))
			)}
		</section>
	);
}

function AllocationRow({
	sharedId,
	month,
	active,
	run,
	person,
}: Props & { person: Person }) {
	const save = useMutation(api.personalAllocations.save);
	const [snapshot, setSnapshot] = useState(person);
	const [saving, setSaving] = useState(false);
	return (
		<>
			{person.revision > snapshot.revision && (
				<div className="banner" role="alert">
					{person.name}'s funding changed. Your unsaved amount is still here.{" "}
					<button
						type="button"
						className="secondary"
						onClick={() => setSnapshot(person)}
					>
						Load current amount
					</button>
				</div>
			)}
			<form
				key={snapshot.revision}
				className="inline-form"
				onSubmit={async (event) => {
					event.preventDefault();
					if (saving || person.revision > snapshot.revision) return;
					const form = new FormData(event.currentTarget);
					setSaving(true);
					let amount = snapshot.amount;
					const saved = await run(() => {
						amount = cents(String(form.get("amount")));
						return save({
							sharedId,
							privateId: person.privateId,
							month,
							amount,
							revision: snapshot.revision,
						});
					}, "Personal funding saved.");
					if (saved)
						setSnapshot({ ...person, amount, revision: snapshot.revision + 1 });
					setSaving(false);
				}}
			>
				<fieldset disabled={!active || !person.active || saving}>
					<MoneyInput
						name="amount"
						value={snapshot.amount}
						label={`${person.name}'s personal amount`}
					/>
					<button type="submit" disabled={person.revision > snapshot.revision}>
						Save amount
					</button>
				</fieldset>
			</form>
		</>
	);
}
