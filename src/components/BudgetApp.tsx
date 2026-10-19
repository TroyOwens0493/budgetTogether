import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
	ArrowLeftRight,
	Bell,
	CalendarDays,
	CircleCheck,
	Landmark,
	LayoutDashboard,
	LogOut,
	Plus,
	Settings,
	TrendingUp,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { cents, nextMonth } from "../domain/budget";
import {
	amountError,
	labelError,
	passwordLimits,
	timeZoneError,
} from "../domain/validation";
import { authClient } from "../lib/auth-client";
import { AccountsView } from "./AccountsView";
import { ErrorBanner } from "./ErrorBanner";
import { PlanView } from "./PlanView";
import { SpendingChart } from "./SpendingChart";
import { TransactionsView } from "./TransactionsView";
import { Modal, usd } from "./ui";
import { ValidatedInput } from "./ValidatedInput";
import type { Run, ViewProps } from "./view-types";

type Home = FunctionReturnType<typeof api.budgets.home>;
type Dashboard = FunctionReturnType<typeof api.budgets.dashboard>;
const nav = [
	["overview", "Overview", LayoutDashboard],
	["transactions", "Transactions", ArrowLeftRight],
	["budget", "Monthly budget", CalendarDays],
	["review", "Monthly review", CircleCheck],
	["accounts", "Accounts & settings", Landmark],
] as const;
export function BudgetApp({ home }: { home: Home }) {
	const [selected, setSelected] = useState(
		home.spaces.find((x) => x.active && x.type === "shared")?._id ??
			home.spaces.find((x) => x.active)?._id ??
			home.spaces[0]._id,
	);
	const space = home.spaces.find((x) => x._id === selected) ?? home.spaces[0];
	const currentMonth = new Intl.DateTimeFormat("en-CA", {
		timeZone: space.timeZone,
		year: "numeric",
		month: "2-digit",
	}).formatToParts(new Date());
	const [month, setMonth] = useState(
		`${currentMonth.find((x) => x.type === "year")!.value}-${currentMonth.find((x) => x.type === "month")!.value}`,
	);
	const [view, setView] = useState<string>("overview");
	const pageName = nav.find(([id]) => id === view)?.[1] ?? "Settings";
	const [notice, setNotice] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const data = useQuery(api.budgets.dashboard, { spaceId: space._id, month });
	const alerts = useQuery(api.budgets.alerts, { spaceId: space._id, month });
	const readAlert = useMutation(api.budgets.readAlert);
	const [alertOpen, setAlertOpen] = useState(false);
	const run: Run = async (work, success = "Saved.") => {
		setBusy(true);
		setError("");
		setNotice("");
		try {
			await work();
			setNotice(success);
			return true;
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "The request failed. Try again.",
			);
			return false;
		} finally {
			setBusy(false);
		}
	};
	const ensureMonth = useMutation(api.budgets.ensureMonth);
	useEffect(() => {
		if (space.active)
			void ensureMonth({ spaceId: space._id, month }).catch((e) =>
				setError(e.message),
			);
	}, [space._id, space.active, month, ensureMonth]);
	const props = { spaceId: space._id, month, active: space.active, run };
	return (
		<div className="app-shell">
			<aside className="sidebar">
				<a className="brand" href="/">
					<span>b.</span> budget together
				</a>
				<label className="space-select">
					<span className="eyebrow">YOUR SPACE</span>
					<select
						aria-label="Budget space"
						value={space._id}
						onChange={(e) => setSelected(e.target.value as Id<"spaces">)}
					>
						{home.spaces.map((s) => (
							<option key={s._id} value={s._id}>
								{s.name}
								{s.active ? "" : " · previous membership"}
							</option>
						))}
					</select>
				</label>
				<nav aria-label="Main navigation">
					{nav.map(([id, name, Icon]) => (
						<button
							key={id}
							type="button"
							className={view === id ? "nav-item selected" : "nav-item"}
							aria-current={view === id ? "page" : undefined}
							onClick={() => setView(id)}
						>
							<Icon size={18} />
							{name}
						</button>
					))}
				</nav>
				<div className="sidebar-bottom">
					<button
						className="nav-item"
						type="button"
						onClick={() => setView("profile")}
					>
						<Settings size={18} />
						Settings
					</button>
					<button
						className="nav-item"
						type="button"
						onClick={() =>
							run(async () => {
								await authClient.signOut();
								window.location.reload();
							}, "Signed out.")
						}
					>
						<LogOut size={18} />
						Sign out
					</button>
				</div>
			</aside>
			<main className="main-content">
				<header className="topbar">
					<span>
						{space.type === "shared" ? "Our household" : "Personal"}{" "}
						<span className="slash">/</span> <strong>{pageName}</strong>
					</span>
					<div>
						<button
							type="button"
							className="icon-button"
							aria-label={`Alerts, ${alerts?.filter((x) => !x.read).length ?? 0} unread`}
							onClick={() => setAlertOpen(true)}
						>
							<Bell size={18} />
							{Boolean(alerts?.some((x) => !x.read)) && (
								<span className="notification-dot" />
							)}
						</button>
						<label className="month-picker">
							<span className="sr-only">Reporting month</span>
							<input
								type="month"
								min="0001-01"
								max="9999-12"
								value={month}
								onChange={(e) => {
									if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value))
										setMonth(e.target.value);
								}}
							/>
						</label>
						<span className="avatar">
							{home.profile?.name.slice(0, 2).toUpperCase()}
						</span>
					</div>
				</header>
				{!space.active && (
					<p className="banner">
						You left this budget. Records shared before you left are available
						to read.
					</p>
				)}
				{error && (
					<ErrorBanner message={error} onDismiss={() => setError("")} />
				)}
				{notice && (
					<div className="save-notice" aria-live="polite">
						{notice}
					</div>
				)}
				<div aria-busy={busy}>
					{!data ? (
						<p aria-live="polite">Loading this month…</p>
					) : view === "overview" ? (
						<Overview {...props} data={data} onView={setView} />
					) : view === "transactions" ? (
						<TransactionsView {...props} categories={data.categories} />
					) : view === "budget" ? (
						<PlanView
							key={`${space._id}:${month}`}
							{...props}
							data={data}
							shared={space.type === "shared"}
						/>
					) : view === "review" ? (
						<ReviewView key={`${space._id}:${month}`} {...props} data={data} />
					) : view === "profile" ? (
						<Profile home={home} run={run} />
					) : (
						<AccountsView
							{...props}
							home={home}
							fundedByShared={Boolean(data.fundedBy)}
						/>
					)}
				</div>
			</main>
			{alertOpen && (
				<Modal title="Your alerts" onClose={() => setAlertOpen(false)}>
					{!alerts?.length ? (
						<p>No category alerts this month.</p>
					) : (
						alerts.map((x) => (
							<div key={x.key} className="alert-row">
								<p>{x.text}</p>
								{!x.read && (
									<button
										type="button"
										className="secondary"
										onClick={() =>
											run(
												() => readAlert({ spaceId: space._id, key: x.key }),
												"Alert read.",
											)
										}
									>
										Mark read
									</button>
								)}
							</div>
						))
					)}
				</Modal>
			)}
		</div>
	);
}
function Summary({ data }: { data: Dashboard }) {
	return (
		<div className="summary-grid">
			<article className="summary-card">
				<span>Money in</span>
				<strong>{usd(data.income + data.incoming)}</strong>
				<small>
					{usd(data.plan?.expectedIncome ?? 0)} expected income ·{" "}
					{usd(data.funds.incoming)} planned budget funding
				</small>
			</article>
			<article className="summary-card">
				<span>Money out</span>
				<strong>{usd(data.spending)}</strong>
				<small>{usd(data.pending)} pending, separate from totals</small>
			</article>
			<article className="summary-card green">
				<span>Saved this month</span>
				<strong>{usd(data.savings)}</strong>
				<small>
					{usd(data.savings - (data.plan?.savingsTarget ?? 0))}{" "}
					{data.savings >= (data.plan?.savingsTarget ?? 0)
						? "above"
						: "relative to"}{" "}
					your {usd(data.plan?.savingsTarget ?? 0)} target
				</small>
			</article>
		</div>
	);
}
function Overview({
	data,
	spaceId,
	month,
	active,
	onView,
}: {
	data: Dashboard;
	spaceId: Id<"spaces">;
	month: string;
	active: boolean;
	onView: (view: string) => void;
}) {
	const [chartCategory, setChartCategory] = useState("");
	const fromDate = new Date(`${month}-01T12:00:00Z`);
	fromDate.setUTCMonth(fromDate.getUTCMonth() - 5);
	const from = fromDate.toISOString().slice(0, 7);
	const reports = useQuery(api.budgets.reports, { spaceId, from, to: month });
	const recurring = useQuery(api.budgets.recurring, { spaceId });
	const setRecurring = useMutation(api.budgets.setRecurring);
	const [error, setError] = useState("");
	return (
		<>
			<div className="page-actions">
				<button
					type="button"
					className="secondary"
					onClick={() => onView("budget")}
				>
					{active ? "Edit monthly plan" : "View monthly plan"}
				</button>
			</div>
			<Summary data={data} />
			{!data.plan && (
				<p className="banner">
					Start with your monthly plan. Add expected income, category limits,
					and a savings target.
				</p>
			)}
			<div className="dashboard-grid">
				<section className="panel">
					<h2>Category balances</h2>
					{data.categories.map((c, i) => {
						const limit =
							data.plan?.limits.find((x) => x.categoryId === c._id)?.amount ??
							0;
						const used =
							typeof data.categories === "object"
								? data.entries
										.filter(
											(x) => !x.removed && !x.pending && x.kind === "purchase",
										)
										.reduce(
											(sum, x) =>
												sum +
												x.splits
													.filter((s) => s.categoryId === c._id)
													.reduce((n, s) => n + s.amount, 0),
											0,
										)
								: 0;
						const left = limit - used;
						return (
							<div className="category-row" key={c._id}>
								<span
									className="category-icon"
									style={{ backgroundColor: `${c.color}25` }}
								>
									{["⌂", "◒", "♧", "♫", "↗", "·"][i % 6]}
								</span>
								<div className="category-main">
									<div>
										<strong>{c.name}</strong>
										<small>
											{usd(used)} of {usd(limit)}
										</small>
									</div>
									<div className="progress-track">
										<div
											style={{
												width: `${limit > 0 ? Math.max(0, Math.min(100, (left / limit) * 100)) : left > 0 ? 100 : 0}%`,
												background: c.color,
											}}
										/>
									</div>
								</div>
								<div
									className={
										left < 0 ? "category-balance over" : "category-balance"
									}
								>
									<strong>{usd(left)}</strong>
									<small>{left < 0 ? "over budget" : "left to spend"}</small>
								</div>
							</div>
						);
					})}
				</section>
				<section className="panel">
					<div className="chart-title">
						<TrendingUp size={20} />
						<h2>Spending over time</h2>
					</div>
					<label>
						Spending shown
						<select
							value={chartCategory}
							onChange={(e) => setChartCategory(e.target.value)}
						>
							<option value="">Total spending</option>
							{data.categories.map((c) => (
								<option value={c._id} key={c._id}>
									{c.name}
								</option>
							))}
						</select>
					</label>
					<SpendingChart
						reports={reports ?? []}
						categories={data.categories}
						categoryId={chartCategory}
					/>
					<table className="compact-table">
						<caption className="sr-only">
							Monthly spending in US dollars
						</caption>
						<thead>
							<tr>
								<th>Month</th>
								<th>Spending</th>
							</tr>
						</thead>
						<tbody>
							{reports?.map((x) => (
								<tr key={x.month}>
									<td>{x.month}</td>
									<td>
										{usd(
											chartCategory
												? (x.categories[chartCategory] ?? 0)
												: x.spending,
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			</div>
			<section className="panel activity">
				<div className="section-heading">
					<h2>Recent activity</h2>
					<button
						type="button"
						className="text-button"
						onClick={() => onView("transactions")}
					>
						All transactions →
					</button>
				</div>
				{data.entries
					.filter((x) => !x.removed)
					.slice(-3)
					.reverse()
					.map((x) => (
						<div className="activity-row" key={x._id}>
							<span className="category-icon">
								<ArrowLeftRight size={16} />
							</span>
							<div>
								<strong>{x.description}</strong>
								<small>
									{x.date} · {x.pending ? "Pending" : x.kind}
								</small>
							</div>
							<strong>{usd(-x.amount)}</strong>
						</div>
					))}
				{!data.entries.length && (
					<p className="empty-state">
						Connect an account to see your activity here.
					</p>
				)}
			</section>
			{Boolean(recurring?.some((x) => x.status !== "dismissed")) && (
				<section className="panel">
					<h2>Recurring-charge suggestions</h2>
					<p>
						Estimates from at least three similar monthly charges. No money is
						moved.
					</p>
					{recurring
						?.filter((x) => x.status !== "dismissed")
						.map((x) => (
							<div className="alert-row" key={x.merchant}>
								<span>
									<strong>{x.merchant}</strong>
									<small>
										{usd(x.amount)} · estimated {x.date} · {x.status}
									</small>
								</span>
								<div className="button-row">
									<button
										type="button"
										className="secondary"
										disabled={!active}
										onClick={() =>
											setRecurring({
												spaceId,
												merchant: x.merchant,
												status: "confirmed",
											}).catch((e) => setError(e.message))
										}
									>
										Confirm
									</button>
									<button
										type="button"
										className="text-button"
										disabled={!active}
										onClick={() =>
											setRecurring({
												spaceId,
												merchant: x.merchant,
												status: "dismissed",
											}).catch((e) => setError(e.message))
										}
									>
										Dismiss
									</button>
								</div>
							</div>
						))}
					<p role="alert">{error}</p>
				</section>
			)}
		</>
	);
}
function ReviewView({
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
	const available = Math.max(0, data.savings - (data.plan?.savingsTarget ?? 0));
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
function Profile({ home, run }: { home: Home; run: Run }) {
	const setup = useMutation(api.budgets.setup);
	const [passwordOpen, setPasswordOpen] = useState(false);
	return (
		<>
			<form
				className="panel narrow"
				onSubmit={(e) => {
					e.preventDefault();
					const data = new FormData(e.currentTarget);
					void run(async () => {
						const name = String(data.get("name"));
						const result = await authClient.updateUser({ name });
						if (result.error) throw new Error(result.error.message);
						await setup({ name, timeZone: String(data.get("timeZone")) });
					});
				}}
			>
				<label htmlFor="budgetapp-name">
					Name
					<ValidatedInput
						id="budgetapp-name"
						aria-label="Name"
						validate={labelError}
						name="name"
						defaultValue={home.profile!.name}
						required
						maxLength={100}
					/>
				</label>
				<label>
					Email
					<input value={home.user.email} readOnly type="email" />
				</label>
				<label htmlFor="budgetapp-timeZone">
					Time zone
					<ValidatedInput
						id="budgetapp-timeZone"
						aria-label="Time zone"
						validate={timeZoneError}
						name="timeZone"
						defaultValue={home.profile!.timeZone}
						required
					/>
				</label>
				<button type="submit">Save profile</button>
				<button
					type="button"
					className="secondary"
					onClick={() => setPasswordOpen(true)}
				>
					Change password
				</button>
			</form>
			{passwordOpen && (
				<Modal title="Change password" onClose={() => setPasswordOpen(false)}>
					<form
						onSubmit={async (e) => {
							e.preventDefault();
							const f = new FormData(e.currentTarget);
							if (
								await run(async () => {
									const result = await authClient.changePassword({
										currentPassword: String(f.get("current")),
										newPassword: String(f.get("new")),
										revokeOtherSessions: true,
									});
									if (result.error) throw new Error(result.error.message);
								})
							)
								setPasswordOpen(false);
						}}
					>
						<label>
							Current password
							<input
								name="current"
								type="password"
								autoComplete="current-password"
								required
							/>
						</label>
						<label>
							New password
							<input
								name="new"
								type="password"
								minLength={passwordLimits.min}
								maxLength={passwordLimits.max}
								autoComplete="new-password"
								required
							/>
						</label>
						<button type="submit">Save password</button>
					</form>
				</Modal>
			)}
		</>
	);
}
export type { Dashboard, Doc };
