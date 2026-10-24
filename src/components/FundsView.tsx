import { useMutation } from "convex/react";
import { PiggyBank, Plus } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { cents, nextMonth } from "../domain/budget";
import { amountError, labelError } from "../domain/validation";
import { amount, Modal, usd } from "./ui";
import { ValidatedInput } from "./ValidatedInput";
import type { Dashboard, ViewProps } from "./view-types";

type FundItem = Dashboard["fundPlan"]["items"][number];

export function FundsView({
	data,
	...props
}: ViewProps & { data: Dashboard["fundPlan"] }) {
	const [editing, setEditing] = useState<FundItem | null | undefined>();
	return (
		<>
			<div className="section-heading funds-heading">
				<div>
					<h1>Funds</h1>
					<p className="muted">
						Set money aside for future payments and savings goals.
					</p>
				</div>
				<button
					type="button"
					disabled={!props.active}
					onClick={() => setEditing(null)}
				>
					<Plus size={17} /> Add fund
				</button>
			</div>
			<div className="summary-grid funds-summary">
				<article className="summary-card green">
					<span>Required this month</span>
					<strong>{usd(data.total)}</strong>
					<small>Automatic Funds amount in your {props.month} budget</small>
				</article>
				<article className="summary-card">
					<span>Reserved through this month</span>
					<strong>
						{usd(data.items.reduce((sum, fund) => sum + fund.balance, 0))}
					</strong>
					<small>
						Opening balances + saved budget amounts − linked payments
					</small>
				</article>
				<article className="summary-card">
					<span>Reserved in this budget</span>
					<strong>{usd(data.contributed)}</strong>
					<small>
						{data.total === data.contributed
							? "This month’s fund amounts are reserved."
							: "Save the monthly budget to reserve its current fund amounts."}
					</small>
				</article>
			</div>
			{data.items.length === 0 ? (
				<section className="panel empty-state funds-empty">
					<PiggyBank size={38} aria-hidden="true" />
					<h2>Give future plans a place</h2>
					<p>
						Add a yearly phone bill, six-month insurance payment, or a goal for
						a new vehicle.
					</p>
					<p>
						The monthly budget will calculate and reserve the amount each fund
						needs.
					</p>
				</section>
			) : (
				<div className="funds-grid">
					{data.items.map((fund) => (
						<article className="panel fund-card" key={fund._id}>
							<div className="section-heading">
								<div>
									<span className="eyebrow">
										{fund.intervalMonths ? "REPEATING PAYMENT" : "SAVINGS GOAL"}
									</span>
									<h2>{fund.name}</h2>
								</div>
								<button
									type="button"
									className="secondary"
									disabled={!props.active}
									aria-label={`Edit ${fund.name}`}
									onClick={() => setEditing(fund)}
								>
									Edit
								</button>
							</div>
							<div className="fund-monthly">
								<strong>{usd(fund.required)}</strong>
								<span>required per month</span>
							</div>
							<dl className="fund-details">
								<div>
									<dt>Reserved balance</dt>
									<dd className={fund.balance < 0 ? "over" : ""}>
										{usd(fund.balance)}
									</dd>
								</div>
								<div>
									<dt>
										{fund.intervalMonths ? "Payment amount" : "Goal amount"}
									</dt>
									<dd>{usd(fund.targetAmount)}</dd>
								</div>
								{fund.targetMonth && (
									<div>
										<dt>
											{fund.intervalMonths ? "Next payment" : "Target month"}
										</dt>
										<dd>{fund.targetMonth}</dd>
									</div>
								)}
								{fund.intervalMonths && (
									<div>
										<dt>Payment frequency</dt>
										<dd>Every {fund.intervalMonths} months</dd>
									</div>
								)}
								<div>
									<dt>Reserved in {props.month}</dt>
									<dd>{usd(fund.contributed)}</dd>
								</div>
							</dl>
							{fund.complete ? (
								<p className="inflow">Goal funded</p>
							) : (
								fund.required !== fund.contributed && (
									<p className="muted">
										Save this month’s budget to reserve {usd(fund.required)}.
									</p>
								)
							)}
							{fund.balance < 0 && (
								<p className="over" role="alert">
									Linked payments exceed the money reserved for this fund.
								</p>
							)}
						</article>
					))}
				</div>
			)}
			<p className="muted">
				Fund balances track reserved money. The app does not move money between
				bank accounts. Select a fund on a purchase or refund in Transactions to
				update its balance.
			</p>
			{editing !== undefined && (
				<FundEditor
					{...props}
					fund={editing}
					onClose={() => setEditing(undefined)}
				/>
			)}
		</>
	);
}

function FundEditor({
	fund,
	spaceId,
	month,
	run,
	onClose,
}: ViewProps & { fund: FundItem | null; onClose: () => void }) {
	const save = useMutation(api.budgets.saveFund);
	const [mode, setMode] = useState(
		fund?.intervalMonths
			? "repeating"
			: fund?.monthlyAmount
				? "monthly"
				: "date",
	);
	const [pending, setPending] = useState(false);
	const inFlight = useRef(false);
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (inFlight.current) return;
		const form = new FormData(event.currentTarget);
		inFlight.current = true;
		setPending(true);
		try {
			const saved = await run(
				() =>
					save({
						spaceId,
						...(fund ? { id: fund._id } : {}),
						startMonth: fund?.startMonth ?? month,
						effectiveMonth: month,
						openingBalance:
							fund?.openingBalance ?? cents(String(form.get("openingBalance"))),
						name: String(form.get("name")),
						targetAmount: cents(String(form.get("targetAmount"))),
						...(mode === "monthly"
							? { monthlyAmount: cents(String(form.get("monthlyAmount"))) }
							: { targetMonth: String(form.get("targetMonth")) }),
						...(mode === "repeating"
							? { intervalMonths: Number(form.get("intervalMonths")) }
							: {}),
						revision: fund?.revision ?? 0,
					}),
				"Fund saved. Check the Funds amount and save your monthly budget.",
			);
			if (saved) onClose();
		} finally {
			inFlight.current = false;
			setPending(false);
		}
	}
	return (
		<Modal
			title={fund ? "Edit fund" : "Add fund"}
			onClose={() => !inFlight.current && onClose()}
		>
			<form onSubmit={submit}>
				<p>
					Changes apply from {month}. The Funds amount is calculated for you in
					each monthly budget.
				</p>
				<fieldset disabled={pending}>
					<label htmlFor="fund-name">
						Fund name
						<ValidatedInput
							id="fund-name"
							name="name"
							defaultValue={fund?.name ?? ""}
							required
							maxLength={100}
							validate={labelError}
						/>
					</label>
					<label>
						Fund type
						<select
							aria-label="Fund type"
							value={mode}
							onChange={(event) => setMode(event.target.value)}
						>
							{(!fund || !fund.intervalMonths) && (
								<>
									<option value="date">Savings goal with a target month</option>
									<option value="monthly">
										Savings goal with a monthly amount
									</option>
								</>
							)}
							{(!fund || fund.intervalMonths) && (
								<option value="repeating">Repeating payment</option>
							)}
						</select>
					</label>
					<label htmlFor="fund-target">
						{mode === "repeating" ? "Payment amount" : "Goal amount"}
						<ValidatedInput
							id="fund-target"
							name="targetAmount"
							inputMode="decimal"
							defaultValue={fund ? amount(fund.targetAmount) : ""}
							required
							validate={(value) =>
								amountError(value) ||
								(cents(value) > 0 ? "" : "Enter an amount greater than zero.")
							}
						/>
					</label>
					{mode === "monthly" ? (
						<label htmlFor="fund-monthly">
							Monthly amount
							<ValidatedInput
								id="fund-monthly"
								name="monthlyAmount"
								inputMode="decimal"
								defaultValue={amount(fund?.monthlyAmount ?? 0)}
								required
								validate={(value) =>
									amountError(value) ||
									(cents(value) > 0 ? "" : "Enter an amount greater than zero.")
								}
							/>
						</label>
					) : (
						<label>
							{mode === "repeating" ? "Next payment month" : "Target month"}
							<input
								name="targetMonth"
								type="month"
								min={month}
								max="9999-12"
								defaultValue={
									fund?.targetMonth && fund.targetMonth >= month
										? fund.targetMonth
										: nextMonth(month)
								}
								required
							/>
						</label>
					)}
					{mode === "repeating" && (
						<label>
							Pay every (months)
							<input
								name="intervalMonths"
								type="number"
								min="2"
								max="120"
								step="1"
								defaultValue={fund?.intervalMonths ?? 12}
								required
							/>
							<small>
								Use 3 for quarterly, 6 for twice a year, or 12 for yearly.
							</small>
						</label>
					)}
					{!fund && (
						<label htmlFor="fund-opening">
							Amount already saved
							<ValidatedInput
								id="fund-opening"
								aria-label="Amount already saved"
								name="openingBalance"
								inputMode="decimal"
								defaultValue="0.00"
								required
								validate={amountError}
							/>
							<small>
								This amount is available from {month} and does not use this
								month’s income.
							</small>
						</label>
					)}
					{fund && (
						<p className="muted">
							Started {fund.startMonth} with {usd(fund.openingBalance)} already
							saved.
						</p>
					)}
					<div className="button-row">
						<button type="button" className="secondary" onClick={onClose}>
							Cancel
						</button>
						<button type="submit">{pending ? "Saving…" : "Save fund"}</button>
					</div>
				</fieldset>
			</form>
		</Modal>
	);
}
