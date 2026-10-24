import { useMutation, useQuery } from "convex/react";
import {
	ArrowLeftRight,
	CalendarDays,
	CircleCheck,
	Landmark,
	LayoutDashboard,
	LogOut,
	PiggyBank,
	Settings,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { authClient } from "../lib/auth-client";
import { AccountsView } from "./AccountsView";
import { ErrorBanner } from "./ErrorBanner";
import { FundsView } from "./FundsView";
import { OverviewView } from "./OverviewView";
import { PlanView } from "./PlanView";
import { ProfileView } from "./ProfileView";
import { ReviewView } from "./ReviewView";
import { TransactionsView } from "./TransactionsView";
import { useAlerts } from "./useAlerts";
import type { Home, Run } from "./view-types";

const nav = [
	["overview", "Overview", LayoutDashboard],
	["transactions", "Transactions", ArrowLeftRight],
	["budget", "Monthly budget", CalendarDays],
	["funds", "Funds", PiggyBank],
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
	const alerts = useAlerts(props);
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
						{alerts.button}
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
						<OverviewView
							spaceId={space._id}
							month={month}
							active={space.active}
							data={data}
							onOpenPlan={() => setView("budget")}
							onOpenTransactions={() => setView("transactions")}
						/>
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
					) : view === "funds" ? (
						<FundsView
							key={`${space._id}:${month}`}
							{...props}
							data={data.fundPlan}
						/>
					) : view === "profile" ? (
						<ProfileView
							profile={home.profile!}
							email={home.user.email}
							run={run}
						/>
					) : (
						<AccountsView
							{...props}
							home={home}
							fundedByShared={Boolean(data.fundedBy)}
						/>
					)}
				</div>
			</main>
			{alerts.dialog}
		</div>
	);
}
