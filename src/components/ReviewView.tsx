import { useMutation } from "convex/react";
import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cents, nextMonth } from "../domain/budget";
import { amountError } from "../domain/validation";
import { Summary } from "./Summary";
import { usd } from "./ui";
import { ValidatedInput } from "./ValidatedInput";
import type { Dashboard, ViewProps } from "./view-types";

export function ReviewView({
	data,
	spaceId,
	month,
	active,
	run,
}: ViewProps & { data: Dashboard }) {
	const review = useMutation(api.budgets.review);
	const [rows, setRows] = useState(
		data.reserved.map((x) => ({
			key: String(x._id),
			categoryId: x.categoryId ?? "",
			amount: (x.amount / 100).toFixed(2),
		})),
	);
	const [revision, setRevision] = useState(data.plan?.revision ?? 0);
	const reserved = rows.reduce((sum, x) => {
		try {
			return sum + cents(x.amount);
		} catch {
			return sum;
		}
	}, 0);
	const available = Math.max(
		0,
		data.unreservedSavings - (data.plan?.savingsTarget ?? 0),
	);
	async function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if ((data.plan?.revision ?? 0) > revision) return;
		const saved = await run(
			() =>
				review({
					spaceId,
					month,
					revision,
					allocations: rows.map((x) => ({
						...(x.categoryId
							? { categoryId: x.categoryId as Id<"categories"> }
							: {}),
						amount: cents(x.amount),
					})),
				}),
			"Monthly review saved.",
		);
		if (saved) setRevision(revision + 1);
	}
	return (
		<>
			<Summary data={data} />
			{(data.plan?.revision ?? 0) > revision && (
				<div className="banner" role="alert">
					This review changed.{" "}
					<button
						type="button"
						className="secondary"
						onClick={() => {
							setRows(
								data.reserved.map((x) => ({
									key: String(x._id),
									categoryId: x.categoryId ?? "",
									amount: (x.amount / 100).toFixed(2),
								})),
							);
							setRevision(data.plan?.revision ?? 0);
						}}
					>
						Load current review
					</button>
				</div>
			)}
			<form className="panel" onSubmit={submit}>
				<div className="review-totals">
					<div>
						<span>Available to allocate</span>
						<strong>{usd(available)}</strong>
					</div>
					<div>
						<span>Remaining</span>
						<strong className={reserved > available ? "over" : ""}>
							{usd(available - reserved)}
						</strong>
					</div>
				</div>
				<fieldset disabled={!active}>
					{rows.map((row, i) => (
						<div className="carry-row" key={row.key}>
							<label>
								Destination
								<select
									value={row.categoryId}
									onChange={(e) =>
										setRows(
											rows.map((x, j) =>
												j === i ? { ...x, categoryId: e.target.value } : x,
											),
										)
									}
								>
									<option value="">{nextMonth(month)} savings target</option>
									{data.categories.map((c) => (
										<option key={c._id} value={c._id}>
											{nextMonth(month)} {c.name}
										</option>
									))}
								</select>
							</label>
							<label htmlFor={`carry-${row.key}`}>
								Amount
								<ValidatedInput
									id={`carry-${row.key}`}
									aria-label="Amount"
									validate={amountError}
									value={row.amount}
									inputMode="decimal"
									required
									onChange={(e) =>
										setRows(
											rows.map((x, j) =>
												j === i ? { ...x, amount: e.target.value } : x,
											),
										)
									}
								/>
							</label>
							<button
								type="button"
								className="text-button"
								aria-label={`Remove allocation ${i + 1}`}
								onClick={() => setRows(rows.filter((_, j) => j !== i))}
							>
								×
							</button>
						</div>
					))}
					<button
						type="button"
						className="secondary"
						onClick={() =>
							setRows([
								...rows,
								{ key: crypto.randomUUID(), categoryId: "", amount: "0.00" },
							])
						}
					>
						<Plus size={16} />
						Add allocation
					</button>
					<div className="retained">
						<span>
							Keep in {month} savings
							<small>Unassigned savings remain here.</small>
						</span>
						<strong>{usd(data.savings - reserved)}</strong>
					</div>
					<dl>
						<div>
							<dt>Carry forward to {nextMonth(month)}</dt>
							<dd>{usd(reserved)}</dd>
						</div>
						<div>
							<dt>Original monthly savings result</dt>
							<dd>{usd(data.savings)}</dd>
						</div>
					</dl>
					<p className="muted">
						Reserving funds does not change this month’s income, spending,
						savings, or target. Late bank corrections can require a new review.
					</p>
					{!data.plan?.saved && (
						<p>Save this month’s budget before completing its review.</p>
					)}
					<button
						type="submit"
						disabled={
							reserved > available ||
							!data.plan?.saved ||
							(data.plan?.revision ?? 0) > revision
						}
					>
						{data.plan?.reviewed
							? "Update monthly review"
							: "Complete monthly review"}
					</button>
				</fieldset>
			</form>
		</>
	);
}
