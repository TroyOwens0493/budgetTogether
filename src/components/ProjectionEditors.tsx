import { useMutation } from "convex/react";
import { useId, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cents } from "../domain/budget";
import { annualReturn } from "../domain/projections";
import { labelError } from "../domain/validation";
import {
	effectiveFixed,
	type Holding,
	type InvestmentAccount,
	investmentNames,
	type ProjectionData,
} from "./projection-data";
import { Modal, MoneyInput } from "./ui";
import { ValidatedInput } from "./ValidatedInput";
import type { Run } from "./view-types";

function RateInput({
	label,
	name,
	value,
	required = false,
	nonnegative = false,
}: {
	label: string;
	name: string;
	value?: number;
	required?: boolean;
	nonnegative?: boolean;
}) {
	const id = useId();
	return (
		<label htmlFor={id}>
			{label}
			<ValidatedInput
				id={id}
				aria-label={label}
				name={name}
				defaultValue={value ?? ""}
				inputMode="decimal"
				required={required}
				validate={(value) => {
					if (!value.trim())
						return required ? "Enter an annual percentage." : "";
					if (!/^-?\d+(\.\d+)?$/.test(value.trim()))
						return "Enter a percentage, such as 5.25.";
					try {
						annualReturn(Number(value));
						if (nonnegative && Number(value) < 0)
							return "Enter zero or a positive percentage.";
						return "";
					} catch (error) {
						return (error as Error).message;
					}
				}}
			/>
		</label>
	);
}

export function ProjectionSettingsEditor({
	data,
	spaceId,
	run,
	close,
}: {
	data: ProjectionData;
	spaceId: Id<"spaces">;
	run: Run;
	close: () => void;
}) {
	const save = useMutation(api.projections.saveSettings);
	const [pending, setPending] = useState(false);
	const settings = data.settings;
	return (
		<Modal title="Forecast settings" onClose={() => !pending && close()}>
			<form
				onSubmit={async (event) => {
					event.preventDefault();
					if (pending) return;
					const form = new FormData(event.currentTarget);
					setPending(true);
					try {
						if (
							await run(
								() =>
									save({
										spaceId,
										currentAge: Number(form.get("currentAge")),
										targetAge: Number(form.get("targetAge")),
										cashBalance: cents(String(form.get("cashBalance"))),
										cashAnnualReturn: Number(form.get("cashRate")),
										revision: settings?.revision ?? 0,
									}),
								"Forecast settings saved.",
							)
						)
							close();
					} finally {
						setPending(false);
					}
				}}
			>
				<div className="plan-grid">
					<label>
						Current age
						<input
							name="currentAge"
							aria-label="Current age"
							type="number"
							min="0"
							max="119"
							step="1"
							required
							defaultValue={settings?.currentAge ?? ""}
						/>
					</label>
					<label>
						Forecast to age
						<input
							name="targetAge"
							aria-label="Forecast to age"
							type="number"
							min="1"
							max="120"
							step="1"
							required
							defaultValue={settings?.targetAge ?? 65}
						/>
					</label>
				</div>
				<p>
					Your entered age is the age at the start of this forecast. Update it
					when needed.
				</p>
				<MoneyInput
					label="Additional unlinked cash savings"
					name="cashBalance"
					value={settings?.cashBalance ?? 0}
				/>
				<p>
					Enter only cash that is not already included in a linked account
					below.
				</p>
				<RateInput
					label="Cash annual interest (%)"
					name="cashRate"
					value={settings?.cashAnnualReturn ?? 0}
					nonnegative
					required
				/>
				<p>
					The current monthly budget supplies the savings target. Investment
					contributions use part of that target; the rest goes to cash.
				</p>
				<button type="submit" disabled={pending}>
					{pending ? "Saving…" : "Save forecast settings"}
				</button>
			</form>
		</Modal>
	);
}

export function HoldingEditor({
	data,
	spaceId,
	holding,
	account,
	run,
	close,
}: {
	data: ProjectionData;
	spaceId: Id<"spaces">;
	holding?: Holding;
	account?: InvestmentAccount;
	run: Run;
	close: () => void;
}) {
	const inputId = useId();
	const save = useMutation(api.projections.saveHolding);
	const [type, setType] = useState<Holding["type"]>(holding?.type ?? "etf");
	const [selectedAccount, setSelectedAccount] = useState(account?._id ?? "new");
	const [pending, setPending] = useState(false);
	const linked = Boolean(account?.linked);
	const fixed = holding ? effectiveFixed(holding) : {};
	const fixedTerm = type === "bond" || type === "cd";
	return (
		<Modal
			title={holding ? "Edit investment forecast" : "Add investment"}
			onClose={() => !pending && close()}
		>
			<form
				onSubmit={async (event) => {
					event.preventDefault();
					if (pending) return;
					const form = new FormData(event.currentTarget);
					const number = (name: string) =>
						String(form.get(name) ?? "").trim()
							? Number(form.get(name))
							: undefined;
					const date = (name: string) =>
						String(form.get(name) ?? "") || undefined;
					setPending(true);
					try {
						if (
							await run(
								() =>
									save({
										spaceId,
										id: holding?._id,
										accountId: holding
											? holding.accountId
											: selectedAccount === "new"
												? undefined
												: (selectedAccount as Id<"accounts">),
										accountName: String(form.get("accountName") ?? ""),
										accountType: String(form.get("accountType") ?? "brokerage"),
										name: String(form.get("name")),
										type,
										ticker: String(form.get("ticker") ?? ""),
										balance: cents(String(form.get("balance"))),
										annualReturnOverride:
											type === "bond" ? undefined : number("return"),
										monthlyContribution: fixedTerm
											? 0
											: cents(String(form.get("contribution"))),
										excluded: !form.has("included"),
										revision: holding?.revision ?? 0,
										fixedIncome: fixedTerm
											? {
													maturityDate: date("maturity"),
													faceValue:
														type === "bond" && form.get("faceValue")
															? cents(String(form.get("faceValue")))
															: undefined,
													couponRate: number("coupon"),
													paymentsPerYear: number("frequency"),
													nextPaymentDate: date("nextCoupon"),
												}
											: undefined,
									}),
								"Investment forecast saved.",
							)
						)
							close();
					} finally {
						setPending(false);
					}
				}}
			>
				{!holding && (
					<>
						<label>
							Investment account
							<select
								aria-label="Investment account"
								value={selectedAccount}
								onChange={(e) => setSelectedAccount(e.target.value)}
							>
								<option value="new">New manual account</option>
								{data.accounts
									.filter((a) => a.investment && !a.linked)
									.map((a) => (
										<option key={a._id} value={a._id}>
											{a.name}
										</option>
									))}
							</select>
						</label>
						{selectedAccount === "new" && (
							<div className="plan-grid">
								<label htmlFor={`${inputId}-account`}>
									Account name
									<ValidatedInput
										id={`${inputId}-account`}
										aria-label="Account name"
										name="accountName"
										required
										defaultValue="Manual investments"
										validate={labelError}
									/>
								</label>
								<label>
									Account type
									<select aria-label="Account type" name="accountType">
										<option value="brokerage">Brokerage</option>
										<option value="401k">401(k)</option>
										<option value="ira">IRA</option>
										<option value="roth ira">Roth IRA</option>
										<option value="other retirement">
											Other retirement account
										</option>
									</select>
								</label>
							</div>
						)}
					</>
				)}
				<label htmlFor={`${inputId}-name`}>
					Investment name
					<ValidatedInput
						id={`${inputId}-name`}
						name="name"
						aria-label="Investment name"
						defaultValue={holding?.name ?? ""}
						required
						readOnly={linked}
						validate={labelError}
					/>
				</label>
				<div className="plan-grid">
					<label>
						Investment type
						<select
							aria-label="Investment type"
							value={type}
							disabled={linked}
							onChange={(e) => setType(e.target.value as Holding["type"])}
						>
							{Object.entries(investmentNames)
								.filter(([key]) => linked || key !== "unsupported")
								.map(([value, name]) => (
									<option key={value} value={value}>
										{name}
									</option>
								))}
						</select>
					</label>
					<label>
						Trading symbol
						<input
							aria-label="Trading symbol"
							name="ticker"
							defaultValue={holding?.ticker ?? ""}
							readOnly={linked}
							maxLength={30}
							placeholder="For example, VTI"
						/>
					</label>
				</div>
				<MoneyInput
					label="Current investment value"
					name="balance"
					value={holding?.balance ?? 0}
					readOnly={linked}
				/>
				{linked && (
					<p>
						Linked names, symbols, types, and balances come from the provider.
						Your forecast settings stay saved after each sync.
					</p>
				)}
				{type === "bond" ? (
					<>
						<MoneyInput
							label="Total bond face value"
							name="faceValue"
							value={fixed.faceValue}
							required={false}
						/>
						<RateInput
							label="Annual coupon rate (%)"
							name="coupon"
							value={fixed.couponRate}
							nonnegative
						/>
						<label>
							Coupon payments per year
							<select
								name="frequency"
								aria-label="Coupon payments per year"
								defaultValue={fixed.paymentsPerYear ?? ""}
							>
								<option value="">Select frequency</option>
								<option value="0">Zero coupon</option>
								<option value="1">1 (annual)</option>
								<option value="2">2 (semiannual)</option>
								<option value="4">4 (quarterly)</option>
								<option value="12">12 (monthly)</option>
							</select>
						</label>
						<label>
							Next coupon payment
							<input
								name="nextCoupon"
								aria-label="Next coupon payment"
								type="date"
								defaultValue={fixed.nextPaymentDate ?? ""}
							/>
						</label>
						<p>
							Coupon payments go to cash. At maturity, the total face value goes
							to cash. Enter 0% for a zero-coupon bond. Payment dates must match
							the bond's terms.
						</p>
					</>
				) : (
					<>
						<RateInput
							label={
								type === "cd"
									? "CD annual yield (APY %)"
									: "Annual return override (%)"
							}
							name="return"
							value={
								holding?.annualReturnOverride ??
								(type === "cd" ? fixed.apy : undefined)
							}
							nonnegative={type === "cd" || type === "cash"}
						/>
						<p>
							{type === "cd"
								? "Enter the CD's APY. The forecast compounds interest until maturity, then moves the full value to cash."
								: type === "cash"
									? "Account cash defaults to 0% interest unless you enter a rate."
									: "Leave blank to use the historical annualized return. We use 10 years, or the available history for newer investments. At least one year is required."}
						</p>
					</>
				)}
				{fixedTerm ? (
					<>
						<label>
							Maturity date
							<input
								name="maturity"
								aria-label="Maturity date"
								type="date"
								defaultValue={fixed.maturityDate ?? ""}
							/>
						</label>
						<p>
							For a new bond or CD purchase, add another holding. The forecast
							does not add monthly contributions to an existing fixed-term
							holding.
						</p>
					</>
				) : (
					<MoneyInput
						label="Monthly investment contribution"
						name="contribution"
						value={holding?.monthlyContribution ?? 0}
					/>
				)}
				<label className="checkbox">
					<input
						name="included"
						type="checkbox"
						defaultChecked={!holding?.excluded}
						disabled={type === "unsupported"}
					/>
					Include this holding in the forecast
				</label>
				<button type="submit" disabled={pending}>
					{pending ? "Saving…" : "Save investment"}
				</button>
			</form>
		</Modal>
	);
}
