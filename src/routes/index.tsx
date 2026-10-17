import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Auth } from "../components/Auth";
import { BudgetApp } from "../components/BudgetApp";
import { ValidatedInput } from "../components/ValidatedInput";
import { labelError, timeZoneError } from "../domain/validation";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
	const { isAuthenticated, isLoading } = useConvexAuth();
	if (isLoading)
		return (
			<main className="auth-card" aria-live="polite">
				Loading your budget…
			</main>
		);
	return isAuthenticated ? <Account /> : <Auth />;
}
function Account() {
	const home = useQuery(api.budgets.home, {});
	const setup = useMutation(api.budgets.setup);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	async function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const data = new FormData(e.currentTarget);
		setBusy(true);
		try {
			await setup({
				name: String(data.get("name")),
				timeZone: String(data.get("timeZone")),
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : "Setup failed.");
		} finally {
			setBusy(false);
		}
	}
	if (!home)
		return (
			<main className="auth-card" aria-live="polite">
				Loading your account…
			</main>
		);
	if (!home.profile)
		return (
			<main className="auth-card">
				<p className="eyebrow">LET’S GET STARTED</p>
				<h1>Make room for your plans.</h1>
				<p>
					Your accounts start in your private budget. You can connect a bank
					after this step.
				</p>
				<form onSubmit={submit}>
					<label htmlFor="setup-name">
						Your name
						<ValidatedInput
							validate={labelError}
							id="setup-name"
							aria-label="Your name"
							name="name"
							defaultValue={home.user.name}
							required
							maxLength={100}
						/>
					</label>
					<label htmlFor="setup-timeZone">
						Reporting time zone
						<ValidatedInput
							validate={timeZoneError}
							id="setup-timeZone"
							aria-label="Reporting time zone"
							name="timeZone"
							defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
							required
						/>
					</label>
					<button type="submit" disabled={busy}>
						Create my private budget
					</button>
					<p role="alert">{error}</p>
				</form>
			</main>
		);
	return <BudgetApp home={home} />;
}
