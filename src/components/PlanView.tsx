import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../../convex/_generated/api";
import { nextMonth } from "../domain/budget";
import { createPlanDraft, evaluatePlanDraft } from "../domain/plan-draft";
import { amountError } from "../domain/validation";
import { PersonalAllocationsView } from "./PersonalAllocationsView";
import { usd } from "./ui";
import { ValidatedInput } from "./ValidatedInput";
import type { Dashboard, ViewProps } from "./view-types";

const draftMoney = (value: number | null) =>
	value === null ? "Check amounts" : usd(value);

export function PlanView({
	data,
	spaceId,
	month,
	active,
	run,
	shared,
}: ViewProps & { data: Dashboard; shared: boolean }) {
	const save = useMutation(api.budgets.savePlan);
	const repeat = useMutation(api.budgets.repeatPlan);
	const [draft, setDraft] = useState(() =>
		createPlanDraft(data.plan, data.categories),
	);
	const [saving, setSaving] = useState(false);
	const result = evaluatePlanDraft(draft, data.categories, {
		fundedByShared: Boolean(data.fundedBy),
		funds: data.funds,
		revision: data.plan?.revision ?? 0,
		fundAmount: data.fundPlan.total,
	});
	async function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const plan = result.plan;
		if (!active || saving || !result.canSave || !plan) return;
		setSaving(true);
		try {
			const saved = await run(
				() =>
					save({
						spaceId,
						month,
						...plan,
						revision: draft.revision,
						fundSignature: data.fundPlan.signature,
					}),
				"Budget saved.",
			);
			if (saved)
				setDraft((current) => ({ ...current, revision: draft.revision + 1 }));
		} finally {
			setSaving(false);
		}
	}
	return (
		<>
			{result.stale && (
				<div className="banner" role="alert">
					This plan changed. Your unsaved entries are still here.{" "}
					<button
						type="button"
						className="secondary"
						onClick={() =>
							setDraft(createPlanDraft(data.plan, data.categories))
						}
					>
						Load current plan
					</button>
				</div>
			)}
			<form onSubmit={submit} className="plan-grid">
				<section className="panel">
					<h2>Monthly spending</h2>
					<fieldset disabled={!active || saving}>
						{data.fundedBy ? (
							<p>
								Income is planned in the shared budget. Your personal allocation
								is {usd(data.funds.personalIncoming)} for this month.
							</p>
						) : (
							<label htmlFor="budgetapp-expected">
								Expected take-home income
								<ValidatedInput
									id="budgetapp-expected"
									aria-label="Expected take-home income"
									validate={amountError}
									name="expected"
									value={draft.expectedIncome}
									inputMode="decimal"
									required
									onChange={(e) =>
										setDraft({ ...draft, expectedIncome: e.target.value })
									}
								/>
							</label>
						)}
						{data.categories.map((c) => (
							<label
								htmlFor={`limit-${c._id}`}
								className="allocation-row"
								key={c._id}
							>
								<span>{c.name}</span>
								<ValidatedInput
									id={`limit-${c._id}`}
									aria-label={c.name}
									validate={amountError}
									name={c._id}
									value={draft.limits[c._id] ?? "0.00"}
									inputMode="decimal"
									required
									onChange={(e) =>
										setDraft({
											...draft,
											limits: { ...draft.limits, [c._id]: e.target.value },
										})
									}
								/>
							</label>
						))}
						<div className="divider" />
						{data.fundPlan.items.length > 0 && (
							<div className="fund-budget-row">
								<label htmlFor="budget-funds" className="allocation-row">
									<span>Funds</span>
									<input
										id="budget-funds"
										aria-label="Funds"
										value={(data.fundPlan.total / 100).toFixed(2)}
										readOnly
									/>
								</label>
								<small>
									Calculated from your fund goals. Change the goals in Funds.
								</small>
								{data.fundPlan.items
									.filter((fund) => fund.required > 0)
									.map((fund) => (
										<div className="fund-budget-detail" key={fund._id}>
											<span>{fund.name}</span>
											<span>{usd(fund.required)}</span>
										</div>
									))}
							</div>
						)}
						<label htmlFor="budgetapp-target" className="allocation-row">
							<span>Monthly savings target</span>
							<ValidatedInput
								id="budgetapp-target"
								aria-label="Monthly savings target"
								validate={amountError}
								name="target"
								value={draft.savingsTarget}
								inputMode="decimal"
								required
								onChange={(e) =>
									setDraft({ ...draft, savingsTarget: e.target.value })
								}
							/>
						</label>
						<p className="muted">
							Category limits repeat next month. Allocate all available money,
							then save your budget.
						</p>
					</fieldset>
				</section>
				<aside className="panel green plan-summary">
					<p className="eyebrow">THE BIG PICTURE</p>
					<h2>Money available to plan</h2>
					<strong className="big-number">{draftMoney(result.available)}</strong>
					<dl>
						<div>
							<dt>Expected income</dt>
							<dd>{draftMoney(result.expectedIncome)}</dd>
						</div>
						<div>
							<dt>Incoming budget funding</dt>
							<dd>{usd(data.funds.incoming)}</dd>
						</div>
						<div>
							<dt>Carry-forward</dt>
							<dd>{usd(data.funds.carry)}</dd>
						</div>
						<div>
							<dt>Outgoing budget funding</dt>
							<dd>{usd(data.funds.outgoing)}</dd>
						</div>
						<div>
							<dt>Spending limits</dt>
							<dd>{draftMoney(result.total)}</dd>
						</div>
						{data.fundPlan.items.length > 0 && (
							<div>
								<dt>Funds</dt>
								<dd>{usd(data.fundPlan.total)}</dd>
							</div>
						)}
						<div>
							<dt>Savings target</dt>
							<dd>{draftMoney(result.savingsTarget)}</dd>
						</div>
						<div className="total">
							<dt>Left to allocate</dt>
							<dd>{draftMoney(result.balance)}</dd>
						</div>
					</dl>
					<p>
						{result.error ||
							(result.balance === 0
								? "✓ Every dollar has a place."
								: "Adjust your plan until this amount is zero.")}
					</p>
					<button type="submit" disabled={!active || saving || !result.canSave}>
						{saving ? "Saving…" : "Save budget"}
					</button>
				</aside>
			</form>
			{shared && (
				<PersonalAllocationsView
					sharedId={spaceId}
					month={month}
					active={active}
					run={run}
				/>
			)}
			<div className="button-row">
				{data.plan && (
					<button
						type="button"
						className="secondary"
						disabled={!active}
						onClick={() =>
							run(
								() => repeat({ spaceId, month }),
								"Limits copied. Open next month to finish and save your budget.",
							)
						}
					>
						Copy limits to {nextMonth(month)}
					</button>
				)}
			</div>
		</>
	);
}
