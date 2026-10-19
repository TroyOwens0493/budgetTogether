import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cents } from "../domain/budget";
import { MoneyInput, usd } from "./ui";
import type { Run } from "./view-types";
export function ContributionsView({
	privateId,
	sharedId,
	month,
	run,
}: {
	privateId: Id<"spaces">;
	sharedId: Id<"spaces">;
	month: string;
	run: Run;
}) {
	const data = useQuery(api.contributions.list, { privateId, sharedId, month });
	const save = useMutation(api.contributions.savePlanned);
	const confirm = useMutation(api.contributions.confirm);
	const unmatch = useMutation(api.contributions.unmatch);
	const [snapshot, setSnapshot] = useState<{
		planned: number;
		revision: number;
	} | null>(null);
	useEffect(() => {
		if (data && !snapshot)
			setSnapshot({
				planned: data.contribution?.planned ?? 0,
				revision: data.contribution?.revision ?? 0,
			});
	}, [data, snapshot]);
	if (!data || !snapshot) return <p>Loading contributions…</p>;
	const contribution = data.contribution;
	if (!data.canEdit && !contribution) return null;
	return (
		<section className="panel">
			<h2>Historical contributions for {month}</h2>
			{data.canEdit ? (
				<>
					<p>
						A contribution reduces private funding and adds the same amount to
						shared funding. It is separate from earned income.
					</p>
					<p className="muted">
						After changing the planned amount, balance and save both monthly
						budgets.
					</p>
				</>
			) : (
				<p>These contribution records are read-only.</p>
			)}
			{data.canEdit && (
				<>
					{(data.contribution?.revision ?? 0) > snapshot.revision && (
						<div className="banner" role="alert">
							Contribution funding changed.{" "}
							<button
								type="button"
								className="secondary"
								onClick={() =>
									setSnapshot({
										planned: data.contribution?.planned ?? 0,
										revision: data.contribution?.revision ?? 0,
									})
								}
							>
								Load current amount
							</button>
						</div>
					)}
					<form
						key={snapshot.revision}
						className="inline-form"
						onSubmit={async (e) => {
							e.preventDefault();
							if (
								!data.canEdit ||
								(data.contribution?.revision ?? 0) > snapshot.revision
							)
								return;
							const form = new FormData(e.currentTarget);
							const saved = await run(() =>
								save({
									privateId,
									sharedId,
									month,
									planned: cents(String(form.get("planned"))),
									revision: snapshot.revision,
								}),
							);
							if (saved)
								setSnapshot({
									planned: cents(String(form.get("planned"))),
									revision: snapshot.revision + 1,
								});
						}}
					>
						<MoneyInput
							name="planned"
							value={snapshot.planned}
							label={`Planned contribution for ${month}`}
						/>
						<button
							type="submit"
							disabled={
								!data.canEdit ||
								(data.contribution?.revision ?? 0) > snapshot.revision
							}
						>
							Save planned amount
						</button>
					</form>
					<h3>Suggested bank matches</h3>
					<p>
						Confirm a match only when these entries record the same transfer.
					</p>
					{data.suggestions.map((x) => (
						<div className="alert-row" key={`${x.outId}:${x.inId}`}>
							<span>
								<strong>{usd(x.amount)}</strong>
								<small>
									{x.date} · {x.outDescription} → {x.inDescription}
								</small>
							</span>
							<button
								type="button"
								className="secondary"
								onClick={() =>
									run(
										() =>
											confirm({
												privateId,
												sharedId,
												outId: x.outId,
												inId: x.inId,
											}),
										"Contribution confirmed.",
									)
								}
							>
								Confirm match
							</button>
						</div>
					))}
					{!data.suggestions.length && (
						<p className="muted">
							No matching posted transfers found. Classify an outgoing personal
							entry as a transfer to suggest its matching shared deposit.
						</p>
					)}
				</>
			)}
			{!data.canEdit && (
				<p>Planned contribution: {usd(data.contribution?.planned ?? 0)}</p>
			)}
			<h3>Confirmed contributions</h3>
			{contribution?.pairs.map((x) => (
				<div className="alert-row" key={x.outId}>
					<span>{usd(x.amount)}</span>
					{data.canEdit && (
						<button
							type="button"
							className="text-button"
							onClick={() =>
								run(
									() =>
										unmatch({
											id: contribution._id,
											outId: x.outId,
											revision: contribution.revision,
										}),
									"Match removed. The entries remain transfers.",
								)
							}
						>
							Remove match
						</button>
					)}
				</div>
			))}
		</section>
	);
}
