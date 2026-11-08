import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cents } from "../domain/budget";
import { amountError } from "../domain/validation";
import { MoneyInput } from "./ui";
import type { Run } from "./view-types";

type Person = {
	privateId: Id<"spaces">;
	name: string;
	active: boolean;
	automatic: boolean;
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
				Personal budgets are funded automatically from their spending limits,
				savings targets, and fund goals, after carry-forward. No bank transfer
				is needed.
			</p>
			<p className="muted">
				Both partners can set a manual amount below. Amounts save when you leave
				the field or press Enter. Personal spending and transactions stay
				private. After a change, balance and save the affected budgets.
			</p>
			{!people ? (
				<p>Loading personal funding…</p>
			) : (
				people.map((person) => (
					<AllocationRow
						key={`${props.sharedId}:${props.month}:${person.privateId}`}
						{...props}
						person={person}
					/>
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
	const [failed, setFailed] = useState(false);
	const [dirty, setDirty] = useState(false);
	const inFlight = useRef(false);
	// Automatic amounts can change without an allocation record revision.
	const automaticChanged =
		snapshot.automatic && person.automatic && person.amount !== snapshot.amount;
	if (automaticChanged && !dirty) setSnapshot(person);
	const stale = person.revision > snapshot.revision || automaticChanged;
	async function saveAmount(form: HTMLFormElement) {
		if (!active || !person.active || inFlight.current || stale) return;
		const value = String(new FormData(form).get("amount"));
		if (amountError(value)) return;
		const amount = cents(value);
		if (amount === snapshot.amount) return;
		inFlight.current = true;
		setSaving(true);
		setFailed(false);
		try {
			const saved = await run(
				() =>
					save({
						sharedId,
						privateId: person.privateId,
						month,
						amount,
						revision: snapshot.revision,
					}),
				"Personal funding saved.",
			);
			if (saved) {
				setDirty(false);
				setSnapshot({
					...person,
					automatic: false,
					amount,
					revision: snapshot.revision + 1,
				});
			}
			setFailed(!saved);
		} finally {
			inFlight.current = false;
			setSaving(false);
		}
	}
	return (
		<>
			{stale && (
				<div className="banner" role="alert">
					{person.name}'s funding changed. Your unsaved amount is still here.{" "}
					<button
						type="button"
						className="secondary"
						onClick={() => {
							setSnapshot(person);
							setDirty(false);
							setFailed(false);
						}}
					>
						Load current amount
					</button>
				</div>
			)}
			<form
				key={`${snapshot.revision}:${snapshot.amount}`}
				className="inline-form"
				onBlur={(event) => {
					if (event.target instanceof HTMLInputElement)
						void saveAmount(event.currentTarget);
				}}
				onSubmit={(event) => {
					event.preventDefault();
					void saveAmount(event.currentTarget);
				}}
			>
				<fieldset disabled={!active || !person.active || saving}>
					{snapshot.automatic && (
						<small>
							Automatic funding · Saving an amount below sets a manual override.
						</small>
					)}
					<MoneyInput
						name="amount"
						value={snapshot.amount}
						label={`${person.name}'s personal amount`}
						onChange={() => setDirty(true)}
					/>
					<output>
						{saving ? "Saving…" : failed ? "Amount not saved. Try again." : ""}
					</output>
					{failed && (
						<button type="submit" disabled={stale}>
							Retry save
						</button>
					)}
				</fieldset>
			</form>
		</>
	);
}
