import { useMutation, useQuery } from "convex/react";
import { ArrowLeftRight, TrendingUp } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SpendingChart } from "./SpendingChart";
import { Summary } from "./Summary";
import { usd } from "./ui";
import type { Dashboard } from "./view-types";

export function OverviewView({
	data,
	spaceId,
	month,
	active,
	onOpenPlan,
	onOpenTransactions,
}: {
	data: Dashboard;
	spaceId: Id<"spaces">;
	month: string;
	active: boolean;
	onOpenPlan: () => void;
	onOpenTransactions: () => void;
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
				<button type="button" className="secondary" onClick={onOpenPlan}>
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
													.filter((s) => s.categoryId === c._id && !s.fundId)
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
					{data.fundPlan.items.length > 0 && (
						<div className="fund-overview-row">
							<strong>Funds</strong>
							<span>
								{usd(data.fundPlan.contributed)} reserved this month ·{" "}
								{usd(data.fundPlan.total)} required
							</span>
						</div>
					)}
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
						onClick={onOpenTransactions}
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
