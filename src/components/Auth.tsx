import { type FormEvent, useState } from "react";
import { labelError } from "../domain/validation";
import { authClient } from "../lib/auth-client";
import { ValidatedInput } from "./ValidatedInput";
export function Auth() {
	const token =
		typeof window === "undefined"
			? null
			: new URLSearchParams(window.location.search).get("token");
	const [mode, setMode] = useState<"login" | "register" | "request" | "reset">(
		token ? "reset" : "login",
	);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setBusy(true);
		setMessage("");
		const data = new FormData(event.currentTarget);
		const email = String(data.get("email") ?? "");
		const password = String(data.get("password") ?? "");
		try {
			let result: { error: { message?: string } | null };
			if (mode === "register")
				result = await authClient.signUp.email({
					name: String(data.get("name")),
					email,
					password,
				});
			else if (mode === "login")
				result = await authClient.signIn.email({ email, password });
			else if (mode === "request")
				result = await authClient.requestPasswordReset({
					email,
					redirectTo: `${window.location.origin}/`,
				});
			else
				result = await authClient.resetPassword({
					newPassword: password,
					token: token ?? "",
				});
			if (result.error)
				throw new Error(result.error.message ?? "Please try again.");
			if (mode === "request")
				setMessage("If this email has an account, a reset link will be sent.");
			else if (mode === "reset") {
				window.history.replaceState(null, "", "/");
				setMode("login");
				setMessage("Password updated. Sign in with your new password.");
			}
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Please try again.");
		} finally {
			setBusy(false);
		}
	}
	return (
		<main className="auth-shell">
			<div className="auth-intro">
				<a className="brand" href="/">
					<span>b.</span> budget together
				</a>
				<h1>Manage your finances, together.</h1>
				<div className="intro-rule">Make your money work for you</div>
			</div>
			<section className="auth-card">
				<p className={mode === "login" ? "eyebrow auth-welcome" : "eyebrow"}>
					{mode === "login" ? "WELCOME BACK" : "WELCOME TOGETHER"}
				</p>
				{mode !== "login" && (
					<h2>
						{
							{
								register: "Create your account",
								request: "Reset your password",
								reset: "Choose a new password",
							}[mode]
						}
					</h2>
				)}
				<form onSubmit={submit}>
					{mode === "register" && (
						<label htmlFor="auth-name">
							Name
							<ValidatedInput
								id="auth-name"
								aria-label="Name"
								name="name"
								validate={labelError}
								required
								autoComplete="name"
								maxLength={100}
							/>
						</label>
					)}
					{mode !== "reset" && (
						<label>
							Email
							<input name="email" type="email" required autoComplete="email" />
						</label>
					)}
					{mode !== "request" && (
						<label>
							Password
							<input
								name="password"
								type="password"
								required
								minLength={mode === "login" ? 1 : 12}
								autoComplete={
									mode === "login" ? "current-password" : "new-password"
								}
							/>
							{mode !== "login" && <small>Use at least 12 characters.</small>}
						</label>
					)}
					<button type="submit" disabled={busy}>
						{busy
							? "Please wait…"
							: {
									login: "Sign in",
									register: "Create account",
									request: "Send reset link",
									reset: "Save password",
								}[mode]}
					</button>
					<p aria-live="polite">{message}</p>
				</form>
				<div className="auth-links">
					{mode === "login" ? (
						<>
							<button
								type="button"
								className="text-button"
								onClick={() => setMode("request")}
							>
								Forgot password?
							</button>
							<button
								type="button"
								className="text-button"
								onClick={() => setMode("register")}
							>
								Create an account
							</button>
						</>
					) : (
						<button
							type="button"
							className="text-button"
							onClick={() => setMode("login")}
						>
							Back to sign in
						</button>
					)}
				</div>
			</section>
		</main>
	);
}
