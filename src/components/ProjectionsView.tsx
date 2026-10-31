import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { openPlaid } from "../lib/plaid-link";
import { AccountReview } from "./AccountsView";
import { ProjectionChart } from "./ProjectionChart";
import { HoldingEditor, ProjectionSettingsEditor } from "./ProjectionEditors";
import {
	effectiveFixed,
	type Holding,
	holdingReturn,
	type InvestmentAccount,
	investmentNames,
	prepareProjection,
} from "./projection-data";
import { ConfirmModal, usd } from "./ui";
import type { ViewProps } from "./view-types";

export function ProjectionsView({
	spaceId,
	active,
	run,
	onOpenPlan,
	onOpenAccounts,
}: Pick<ViewProps, "spaceId" | "active" | "run"> & {
	onOpenPlan: (month: string) => void;
	onOpenAccounts: () => void;
}) {
	const data = useQuery(api.projections.list, active ? { spaceId } : "skip");
	const include = useMutation(api.projections.includeAccount);
	const remove = useMutation(api.projections.removeHolding);
	const link = useAction(api.bank.link),
		exchange = useAction(api.bank.exchange);
	const refresh = useAction(api.investments.refreshReturns);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [editor, setEditor] = useState<{
		holding?: Holding;
		account?: InvestmentAccount;
	} | null>(null);
	const [deleting, setDeleting] = useState<Holding | null>(null);
	const [reviewing, setReviewing] = useState<Id<"connections"> | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	if (!active)
		return (
			<p className="banner">
				Forecasts use current account data and are available only to active
				budget members.
			</p>
		);
	if (!data) return <p aria-live="polite">Loading projections…</p>;
	const forecast = prepareProjection(data);
	const final = forecast.points.at(-1);
	return (
		<>
			<div className="page-actions">
				<div>
					<h1 className="projection-heading">Look ahead</h1>
					<p>See where your current savings plan could take you.</p>
				</div>
				<div className="button-row">
					<button
						type="button"
						className="secondary"
						onClick={() => setSettingsOpen(true)}
					>
						Forecast settings
					</button>
					<button type="button" onClick={() => setEditor({})}>
						Add investment
					</button>
				</div>
			</div>
			<div className="projection-funding panel">
				<div>
					<span className="eyebrow">MONTHLY SAVINGS TARGET · {data.month}</span>
					<strong>{usd(data.savingsTarget)}</strong>
				</div>
				<div>
					<small>To investments</small>
					<strong>{usd(forecast.allocated)}</strong>
				</div>
				<div>
					<small>To cash savings</small>
					<strong className={forecast.cashMonthly < 0 ? "over" : ""}>
						{usd(forecast.cashMonthly)}
					</strong>
				</div>
				<button
					type="button"
					className="secondary"
					onClick={() => onOpenPlan(data.month)}
				>
					Edit monthly budget
				</button>
			</div>
			{forecast.errors.length > 0 && (
				<section className="banner" aria-label="Forecast needs attention">
					<strong>Complete your forecast</strong>
					<ul>
						{forecast.errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
					{!data.settings && (
						<button type="button" onClick={() => setSettingsOpen(true)}>
							Set up forecast
						</button>
					)}
				</section>
			)}
			{forecast.warnings.length > 0 && (
				<details className="panel projection-notes">
					<summary>Data notes ({forecast.warnings.length})</summary>
					<ul>
						{forecast.warnings.map((warning) => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				</details>
			)}
			{final && data.settings && (
				<>
					<div className="summary-grid">
						<section className="summary-card">
							<span>Total at age {data.settings.targetAge}</span>
							<strong>{usd(final.total)}</strong>
							<small>Cash plus investments</small>
						</section>
						<section className="summary-card">
							<span>New contributions</span>
							<strong>{usd(final.contributions)}</strong>
							<small>From your monthly savings target</small>
						</section>
						<section className="summary-card">
							<span>Estimated growth</span>
							<strong>{usd(final.growth)}</strong>
							<small>Interest and investment gains or losses</small>
						</section>
					</div>
					<div className="dashboard-grid">
						<ProjectionChart
							key={`cash:${data.settings.revision}`}
							points={forecast.points}
							kind="cash"
							currentAge={data.settings.currentAge}
						/>
						<ProjectionChart
							key={`investments:${data.settings.revision}`}
							points={forecast.points}
							kind="investments"
							currentAge={data.settings.currentAge}
						/>
					</div>
					<details className="panel projection-notes">
						<summary>Yearly forecast values</summary>
						<div className="table-scroll">
							<table className="compact-table">
								<caption className="sr-only">
									Yearly forecast in US dollars
								</caption>
								<thead>
									<tr>
										<th>Age</th>
										<th>Cash savings</th>
										<th>Investments</th>
										<th>Total</th>
									</tr>
								</thead>
								<tbody>
									{forecast.points
										.filter((p) => p.month % 12 === 0)
										.map((p) => (
											<tr key={p.month}>
												<td>{data.settings!.currentAge + p.month / 12}</td>
												<td>{usd(p.cash)}</td>
												<td>{usd(p.investments)}</td>
												<td>{usd(p.total)}</td>
											</tr>
										))}
								</tbody>
							</table>
						</div>
					</details>
				</>
			)}
			<section className="panel">
				<div className="section-heading">
					<h2>Cash savings accounts</h2>
					<span>Starting cash: {usd(forecast.cash)}</span>
				</div>
				<p>
					Choose which balances to include. Checking accounts start excluded.
					Add unlinked cash in Forecast settings.
				</p>
				{data.accounts
					.filter((a) => !a.investment)
					.map((account) => (
						<div key={account._id} className="account-row">
							<label className="checkbox">
								<input
									type="checkbox"
									aria-label={`Include ${account.name}`}
									checked={!account.projectionCashExcluded}
									onChange={(e) => {
										const excluded = !e.target.checked;
										void run(() =>
											include({
												id: account._id,
												excluded,
												revision: account.revision,
											}),
										);
									}}
								/>
								<span>
									<strong>{account.name}</strong>
									<small>
										{account.balance === undefined
											? "Balance unavailable"
											: usd(account.balance)}{" "}
										·{" "}
										{account.balanceAsOf
											? new Date(account.balanceAsOf).toLocaleString()
											: "Not synced"}
									</small>
								</span>
							</label>
						</div>
					))}
				{!data.accounts.some((a) => !a.investment) && (
					<p className="empty-state">
						Connect a savings account in Accounts &amp; settings, or enter
						unlinked cash.
					</p>
				)}
			</section>
			<section className="panel">
				<div className="section-heading">
					<h2>Investment accounts</h2>
					<div className="button-row">
						<button
							type="button"
							className="secondary"
							disabled={refreshing}
							onClick={async () => {
								setRefreshing(true);
								try {
									await run(
										() => refresh({ spaceId }),
										"Return lookup finished. Check each holding's source and any data notes.",
									);
								} finally {
									setRefreshing(false);
								}
							}}
						>
							{refreshing ? "Loading…" : "Load historical returns"}
						</button>
						<button
							type="button"
							onClick={() =>
								void run(async () => {
									const token = await link({ investments: true });
									await openPlaid(token, async (publicToken) => {
										const id = await exchange({
											publicToken,
											investments: true,
										});
										setReviewing(id);
									});
								}, "Investment account linked. New linked accounts start in Personal.")
							}
						>
							Connect investments
						</button>
					</div>
				</div>
				<p>
					New linked accounts start in Personal. Use{" "}
					<button
						type="button"
						className="text-button"
						onClick={onOpenAccounts}
					>
						Accounts &amp; settings
					</button>{" "}
					to move an account to Shared, sync, reconnect, or disconnect it.
				</p>
				{data.accounts
					.filter((a) => a.investment)
					.map((account) => (
						<div className="projection-account" key={account._id}>
							<div className="account-row">
								<label className="checkbox">
									<input
										type="checkbox"
										aria-label={`Include ${account.name}`}
										checked={!account.projectionCashExcluded}
										onChange={(e) => {
											const excluded = !e.target.checked;
											void run(() =>
												include({
													id: account._id,
													excluded,
													revision: account.revision,
												}),
											);
										}}
									/>
									<span>
										<strong>{account.name}</strong>
										<small>
											{account.type} · {account.linked ? "Linked" : "Manual"}
											{account.balanceAsOf
												? ` · Imported ${new Date(account.balanceAsOf).toLocaleString()}`
												: ""}
										</small>
									</span>
								</label>
								{!account.linked && (
									<button
										type="button"
										className="secondary"
										onClick={() => setEditor({ account })}
									>
										Add holding
									</button>
								)}
							</div>
							{account.holdings.map((holding) => (
								<div className="projection-holding" key={holding._id}>
									<div>
										<strong>{holding.name}</strong>
										<small>
											{investmentNames[holding.type]}
											{holding.ticker ? ` · ${holding.ticker}` : ""} ·{" "}
											{holding.balance === undefined
												? "Value unavailable"
												: usd(holding.balance)}
											{holding.excluded || account.projectionCashExcluded
												? " · Excluded"
												: ""}
										</small>
										<small>
											{holding.type === "bond"
												? `Coupon ${effectiveFixed(holding).couponRate ?? "—"}% · Matures ${effectiveFixed(holding).maturityDate ?? "not set"}`
												: `${holdingReturn(holding)?.toFixed(2) ?? "—"}% annual ${holding.type === "cd" ? "yield" : "return"} · ${holding.annualReturnOverride !== undefined ? "Your override" : holding.type === "cash" ? "Cash assumption" : holding.type === "cd" ? "CD terms" : "Historical"}`}
										</small>
										{holding.history?.rate !== undefined && (
											<small>
												Tiingo · {holding.history.startDate} to{" "}
												{holding.history.endDate} ·{" "}
												{holding.history.rate.toFixed(2)}% annualized
												{holding.history.fetchedAt
													? ` · Retrieved ${new Date(holding.history.fetchedAt).toLocaleDateString()}`
													: ""}
											</small>
										)}
										{holding.asOf && (
											<small>Holding value as of {holding.asOf}</small>
										)}
										{holding.history?.error && (
											<small className="over">{holding.history.error}</small>
										)}
										{holding.problem && (
											<small className="over">{holding.problem}</small>
										)}
										{holding.monthlyContribution > 0 && (
											<small>
												{usd(holding.monthlyContribution)} per month
											</small>
										)}
									</div>
									<div className="button-row">
										<button
											type="button"
											className="secondary"
											onClick={() => setEditor({ account, holding })}
										>
											Edit forecast
										</button>
										{!account.linked && (
											<button
												type="button"
												className="text-button"
												onClick={() => setDeleting(holding)}
											>
												Delete
											</button>
										)}
									</div>
								</div>
							))}
							{!account.holdings.length && (
								<p>
									No holdings yet.{" "}
									{account.linked
										? "Sync this connection in Accounts & settings."
										: "Add a holding to this account."}
								</p>
							)}
						</div>
					))}
				{!data.accounts.some((a) => a.investment) && (
					<p className="empty-state">
						Connect an investment account or add a manual investment to start.
					</p>
				)}
			</section>
			<details className="panel projection-notes">
				<summary>How this forecast works</summary>
				<p>
					The forecast starts on {data.startsOn}. It repeats the current month's
					savings target, with contributions added at each month end. Stock and
					fund returns compound monthly. Historical rates use adjusted monthly
					prices and assume dividends are reinvested.
				</p>
				<p>
					Bonds keep their current value until maturity. Scheduled coupons go to
					cash, and the face value goes to cash at maturity. CDs compound at the
					entered APY until maturity, then move to cash. Cash interest is
					applied monthly; payments received during a month earn cash interest
					from the following month. Enter a new holding for another bond or CD
					purchase.
				</p>
				<p>
					These are estimates. Prices, returns, and interest rates can change.
					The calculation does not include taxes, withdrawals, inflation,
					employer matches, contribution limits, early redemption, bond default
					or calls, or accrued interest adjustments. Retirement accounts show
					the value of their holdings before taxes.
				</p>
			</details>
			{settingsOpen && (
				<ProjectionSettingsEditor
					data={data}
					spaceId={spaceId}
					run={run}
					close={() => setSettingsOpen(false)}
				/>
			)}
			{editor && (
				<HoldingEditor
					data={data}
					spaceId={spaceId}
					{...editor}
					run={run}
					close={() => setEditor(null)}
				/>
			)}
			{deleting && (
				<ConfirmModal
					title="Delete manual investment?"
					confirmLabel="Delete investment"
					onClose={() => setDeleting(null)}
					onConfirm={() =>
						run(
							() => remove({ id: deleting._id, revision: deleting.revision }),
							"Investment deleted.",
						)
					}
				>
					<p>Remove {deleting.name} from this forecast?</p>
				</ConfirmModal>
			)}
			{reviewing && (
				<AccountReview
					id={reviewing}
					run={run}
					close={() => setReviewing(null)}
				/>
			)}
		</>
	);
}
