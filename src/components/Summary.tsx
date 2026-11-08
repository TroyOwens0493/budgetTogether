import { usd } from "./ui";
import type { Dashboard } from "./view-types";

export function Summary({ data }: { data: Dashboard }) {
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
					{usd(data.unreservedSavings - (data.plan?.savingsTarget ?? 0))}{" "}
					{data.unreservedSavings >= (data.plan?.savingsTarget ?? 0)
						? "above"
						: "relative to"}{" "}
					your {usd(data.plan?.savingsTarget ?? 0)} target
				</small>
				{data.fundPlan.items.length > 0 && (
					<small>
						{usd(data.fundPlan.contributed)} reserved for funds ·{" "}
						{usd(data.unreservedSavings)} left after fund reservations and
						payments
					</small>
				)}
			</article>
		</div>
	);
}
