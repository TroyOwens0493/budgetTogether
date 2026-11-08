import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { authClient } from "../lib/auth-client";
import { errorMessage } from "../lib/error-message";

export function clearInviteLink() {
	const url = new URL(window.location.href);
	url.searchParams.delete("invite");
	window.history.replaceState(
		null,
		"",
		`${url.pathname}${url.search}${url.hash}`,
	);
}

export function InviteReview({
	token,
	email,
	onClose,
	onAccepted,
}: {
	token: string;
	email: string;
	onClose: () => void;
	onAccepted: (spaceId: Id<"spaces">) => void;
}) {
	const preview = useAction(api.sharing.preview);
	const accept = useAction(api.sharing.accept);
	const [review, setReview] =
		useState<FunctionReturnType<typeof api.sharing.preview>>();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const inFlight = useRef(false);
	useEffect(() => {
		// A retry starts a new request even when the token is unchanged.
		void attempt;
		let closed = false;
		setError("");
		setReview(undefined);
		void preview({ token }).then(
			(value) => {
				if (!closed) setReview(value);
			},
			(error) => {
				if (!closed)
					setError(errorMessage(error, "Could not load this invitation."));
			},
		);
		return () => {
			closed = true;
		};
	}, [preview, token, attempt]);
	async function acceptInvite() {
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		setError("");
		try {
			const spaceId = await accept({ token });
			clearInviteLink();
			onAccepted(spaceId);
		} catch (error) {
			setError(errorMessage(error, "Could not accept this invitation."));
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	return (
		<main className="auth-card invite-review">
			<p className="eyebrow">BUDGET TOGETHER</p>
			<h1>Shared budget invitation</h1>
			{!review && !error && <p aria-live="polite">Loading invitation…</p>}
			{review?.state === "ready" && (
				<>
					<p>
						<strong>
							{review.inviterName} invited you to create a shared budget.
						</strong>
					</p>
					<ul className="invite-details">
						<li>
							Accepting creates a new shared budget with equal access for both
							of you.
						</li>
						<li>Your private budgets stay separate.</li>
						<li>
							If you have a pending invitation to someone else, accepting this
							invitation will cancel it.
						</li>
					</ul>
					<p className="muted">
						You are signed in as {email}. Expires{" "}
						{new Date(review.expiresAt).toLocaleString()}.
					</p>
					<button
						type="button"
						disabled={busy}
						onClick={() => void acceptInvite()}
					>
						{busy ? "Creating shared budget…" : "Accept invitation"}
					</button>
				</>
			)}
			{review?.state === "wrong-email" && (
				<>
					<p>
						You are signed in as <strong>{email}</strong>. To accept, sign in or
						create an account with the email address that received this
						invitation.
					</p>
					<button
						type="button"
						disabled={busy}
						onClick={async () => {
							setBusy(true);
							try {
								await authClient.signOut();
								window.location.reload();
							} catch (error) {
								setError(errorMessage(error, "Could not sign out."));
								setBusy(false);
							}
						}}
					>
						Use a different account
					</button>
				</>
			)}
			{review?.state === "unavailable" && (
				<p>
					This invitation has expired, was cancelled, or is no longer available.
					Ask the sender for a new invitation.
				</p>
			)}
			{review?.state === "accepted" && (
				<p>This invitation has already been accepted.</p>
			)}
			{review?.state === "blocked" && (
				<p>
					You already have a shared budget. You must leave it before accepting
					another invitation. Leaving permanently deletes that budget and its
					records for both people.
				</p>
			)}
			{error && (
				<p role="alert" className="error">
					{error}
				</p>
			)}
			{!review && error && (
				<button type="button" onClick={() => setAttempt((n) => n + 1)}>
					Try again
				</button>
			)}
			<button
				type="button"
				className="secondary"
				disabled={busy}
				onClick={() => {
					clearInviteLink();
					onClose();
				}}
			>
				Continue to my budget
			</button>
		</main>
	);
}
