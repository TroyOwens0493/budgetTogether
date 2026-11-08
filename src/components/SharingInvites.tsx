import { useAction, useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { partnerEmailError } from "../domain/validation";
import { ValidatedInput } from "./ValidatedInput";
import type { Run } from "./view-types";

export function SharingInvites({ email, run }: { email: string; run: Run }) {
	const outgoing = useQuery(api.sharing.outgoing, {});
	const invite = useAction(api.sharing.invite);
	const resend = useAction(api.sharing.resend);
	const revoke = useMutation(api.sharing.revoke);
	const [recipient, setRecipient] = useState("");
	const recipientError = partnerEmailError(recipient, email);
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	async function perform(work: () => Promise<unknown>, success: string) {
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		try {
			if (await run(work, success)) setRecipient("");
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	return (
		<section className="panel narrow shared-budget-setup">
			<h2>Start a shared budget</h2>
			{outgoing === undefined ? (
				<p aria-live="polite">Loading invitations…</p>
			) : outgoing ? (
				<div>
					<p>
						<strong>{outgoing.email}</strong>
					</p>
					<p>
						{outgoing.expiresAt <= Date.now()
							? "Invitation expired."
							: "Invitation email sent."}{" "}
						Expires {new Date(outgoing.expiresAt).toLocaleString()}.
					</p>
					<p
						aria-live="polite"
						className={outgoing.delivery === "failed" ? "over" : undefined}
					>
						{outgoing.delivery === "failed"
							? "The email could not be sent. Please resend the invitation."
							: outgoing.delivery === "sent"
								? "Invitation email sent."
								: "Invitation email queued."}
					</p>
					<p className="muted">
						Resending replaces the old link and restarts the seven-day period.
					</p>
					<div className="button-row">
						<button
							type="button"
							disabled={busy}
							onClick={() =>
								void perform(
									() => resend({ id: outgoing._id }),
									"Invitation email queued.",
								)
							}
						>
							Resend invitation
						</button>
						<button
							type="button"
							className="secondary"
							disabled={busy}
							onClick={() =>
								void perform(
									() => revoke({ id: outgoing._id }),
									"Invitation cancelled.",
								)
							}
						>
							Cancel invitation
						</button>
					</div>
				</div>
			) : (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (recipientError) return;
						void perform(
							() => invite({ email: recipient }),
							"Invitation email queued.",
						);
					}}
				>
					<fieldset disabled={busy}>
						<label htmlFor="sharing-recipient">
							Partner’s email
							<ValidatedInput
								id="sharing-recipient"
								name="email"
								type="email"
								autoComplete="email"
								required
								value={recipient}
								onChange={(event) => setRecipient(event.target.value)}
								validate={(value) => partnerEmailError(value, email)}
							/>
						</label>
						<button type="submit" disabled={Boolean(recipientError)}>
							{busy ? "Sending…" : "Send invitation"}
						</button>
					</fieldset>
				</form>
			)}
		</section>
	);
}
