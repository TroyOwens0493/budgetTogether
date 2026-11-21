import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AccountReview } from "./AccountsView";
import { ProjectionChart } from "./ProjectionChart";
import { HoldingEditor, ProjectionSettingsEditor } from "./ProjectionEditors";
import {
	type Holding,
	holdingForecastErrors,
	holdingReturn,
	type InvestmentAccount,
	prepareProjection,
} from "./projection-data";
import { ConfirmModal, usd } from "./ui";
import { usePlaidConnection } from "./usePlaidConnection";
import type { Run, ViewProps } from "./view-types";

function AccountForecastToggle({
	account,
	run,
}: {
	account: InvestmentAccount;
	run: Run;
}) {
	const include = useMutation(api.projections.includeAccount);
	const [pending, setPending] = useState<boolean | null>(null);
	useEffect(() => {
		if (pending === account.projectionCashExcluded) setPending(null);
	}, [account.projectionCashExcluded, pending]);
	const saving = pending !== null && pending !== account.projectionCashExcluded;
	const name = account.mask
		? `${account.name} ending in ${account.mask}`
		: account.name;
	return (
		<label className="checkbox">
			<input
				type="checkbox"
				aria-label={`Include ${name}${account.institution ? ` at ${account.institution}` : ""}`}
				checked={!account.projectionCashExcluded}
				disabled={saving}
				onChange={async () => {
					const excluded = !account.projectionCashExcluded;
					setPending(excluded);
					const saved = await run(() =>
						include({ id: account._id, excluded, revision: account.revision }),
					);
					if (!saved) setPending(null);
				}}
			/>
			<span>
				<strong>{account.name}</strong>
				<small className="sr-only" aria-live="polite">
					{saving
						? "Saving forecast selection…"
						: account.projectionCashExcluded
							? "Excluded from forecast"
							: "Included in forecast"}
				</small>
			</span>
		</label>
	);
}

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
	const remove = useMutation(api.projections.removeHolding);
	const refresh = useAction(api.investments.refreshReturns);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [editor, setEditor] = useState<{
		holding?: Holding;
		account?: InvestmentAccount;
	} | null>(null);
	const [deleting, setDeleting] = useState<Holding | null>(null);
	const [reviewing, setReviewing] = useState<Id<"connections"> | null>(null);
	const plaid = usePlaidConnection(run, setReviewing, true);
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
	const currentAge = data.settings?.currentAge ?? 0;
	const final = forecast.points.at(-1);
	const investmentAccounts = data.accounts.filter(
		(account) => account.investment,
	);
	const hasHoldings = investmentAccounts.some(
		(account) => account.holdings.length > 0,
	);
	const investmentActions = (
		<>
			<button
				type="button"
				disabled={plaid.busy}
				onClick={() => void plaid.connect()}
			>
				Connect investments
			</button>
			<button type="button" className="secondary" onClick={() => setEditor({})}>
				Add investment manually
			</button>
		</>
	);
	const accountSettings = (
		<button type="button" className="text-button" onClick={onOpenAccounts}>
			Accounts &amp; sharing
		</button>
	);
	const investmentSetup = (
		<section className="panel">
			<h2>Investments</h2>
			<p>
				Connect an investment account or enter an investment to see its
				forecast.
			</p>
			<div className="button-row">{investmentActions}</div>
			<p className="muted">
				New linked accounts start in Personal. To move one to Shared, open{" "}
				{accountSettings}.
			</p>
			<output>{plaid.message}</output>
		</section>
	);
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
				</div>
			</div>
			<div className="projection-funding panel">
				<div>
					<span className="eyebrow">MONTHLY SAVINGS TARGET · {data.month}</span>
					<strong>
						{data.savedPlan ? usd(data.savingsTarget) : "Budget not saved"}
					</strong>
				</div>
				<div>
					<small>To investments</small>
					<strong>{data.savedPlan ? usd(forecast.allocated) : "—"}</strong>
				</div>
				<div>
					<small>To cash savings</small>
					<strong className={forecast.cashMonthly < 0 ? "over" : ""}>
						{data.savedPlan ? usd(forecast.cashMonthly) : "—"}
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
			{!final && !hasHoldings && investmentSetup}
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
						{hasHoldings ? (
							<ProjectionChart
								key={`investments:${data.settings.revision}`}
								points={forecast.points}
								kind="investments"
								currentAge={data.settings.currentAge}
							/>
						) : (
							investmentSetup
						)}
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
												<td>{currentAge + p.month / 12}</td>
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
							<AccountForecastToggle account={account} run={run} />
						</div>
					))}
				{!data.accounts.some((a) => !a.investment) && (
					<p className="empty-state">
						Connect a savings account in Accounts &amp; sharing, or enter
						unlinked cash.
					</p>
				)}
			</section>
			{investmentAccounts.length > 0 && (
				<section className="panel">
					<div className="section-heading">
						<h2>Investment accounts</h2>
						{hasHoldings && (
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
												"Return lookup finished.",
											);
										} finally {
											setRefreshing(false);
										}
									}}
								>
									{refreshing ? "Loading…" : "Load historical returns"}
								</button>
								{investmentActions}
							</div>
						)}
					</div>
					{hasHoldings && <output>{plaid.message}</output>}
					<p>
						Use {accountSettings} to move an account to Shared, sync, reconnect,
						or disconnect it.
					</p>
					{investmentAccounts.map((account) => (
						<div className="projection-account" key={account._id}>
							<div className="account-row">
								<AccountForecastToggle account={account} run={run} />
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
										{holding.history?.error &&
											["stock", "etf", "mutualFund"].includes(holding.type) &&
											holding.annualReturnOverride === undefined &&
											holdingReturn(holding) !== undefined && (
												<small className="over">{holding.history.error}</small>
											)}
										{!account.projectionCashExcluded &&
											holdingForecastErrors(holding).map((error) => (
												<small className="over" key={error}>
													{error}
												</small>
											))}
									</div>
									<div className="button-row">
										<button
											type="button"
											className="secondary"
											onClick={() => setEditor({ account, holding })}
										>
											Edit forecast
										</button>
									</div>
								</div>
							))}
							{!account.holdings.length && (
								<p>
									No holdings yet.{" "}
									{account.linked
										? "Sync this connection in Accounts & sharing."
										: "Add a holding to this account."}
								</p>
							)}
						</div>
					))}
				</section>
			)}
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
					onDelete={
						editor.holding && !editor.account?.linked
							? () => {
									if (!editor.holding) return;
									setDeleting(editor.holding);
									setEditor(null);
								}
							: undefined
					}
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
