import { Component, type ReactNode } from "react";

/** Separate subscriptions can report a deleted budget before the home query updates. */
export class BudgetReadBoundary extends Component<
	{ membershipKey: string; children: ReactNode },
	{ unavailable: boolean }
> {
	state = { unavailable: false };
	static getDerivedStateFromError(error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		if (!/Budget not found|You do not have access to this budget/.test(message))
			throw error;
		return { unavailable: true };
	}
	componentDidUpdate(previous: Readonly<{ membershipKey: string }>) {
		if (
			this.state.unavailable &&
			previous.membershipKey !== this.props.membershipKey
		)
			this.setState({ unavailable: false });
	}
	render() {
		return this.state.unavailable ? (
			<div className="panel">
				<p aria-live="polite">
					This budget is no longer available. Updating your budget list…
				</p>
				<button type="button" onClick={() => window.location.reload()}>
					Reload budgets
				</button>
			</div>
		) : (
			this.props.children
		);
	}
}
