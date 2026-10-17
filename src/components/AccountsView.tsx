import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { labelError } from "../domain/validation";
import { openPlaid } from "../lib/plaid-link";
import { ContributionsView } from "./ContributionsView";
import { ConfirmModal, Modal } from "./ui";
import { ValidatedInput } from "./ValidatedInput";
import type { ViewProps } from "./view-types";
export function AccountsView({
	spaceId,
	month,
	active,
	run,
	home,
}: ViewProps & { home: FunctionReturnType<typeof api.budgets.home> }) {
	const accounts = useQuery(api.accounts.list, { spaceId });
	const connections = useQuery(api.accounts.connections, {});
	const status = useQuery(api.sharing.status, { spaceId });
	const link = useAction(api.bank.link);
	const exchange = useAction(api.bank.exchange);
	const sync = useAction(api.bank.sync);
	const disconnect = useAction(api.bank.disconnect);
	const rename = useMutation(api.accounts.rename);
	const move = useMutation(api.accounts.move);
	const leave = useMutation(api.sharing.leave);
	const create = useMutation(api.sharing.create);
	const invite = useAction(api.sharing.invite);
	const revoke = useMutation(api.sharing.revoke);
	const accept = useAction(api.sharing.accept);
	const [reviewing, setReviewing] = useState<Id<"connections"> | null>(null);
	const [leaving, setLeaving] = useState<Id<"spaces"> | null>(null);
	const [renaming, setRenaming] = useState<
		NonNullable<typeof accounts>[number] | null
	>(null);
	const [renamePending, setRenamePending] = useState(false);
	const [disconnecting, setDisconnecting] = useState<Id<"connections"> | null>(
		null,
	);
	const [moving, setMoving] = useState<
		NonNullable<typeof accounts>[number] | null
	>(null);
	const space = home.spaces.find((x) => x._id === spaceId)!;
	const destination = home.spaces.find((x) => x.active && x._id !== spaceId);
	const hasSharedBudget = home.spaces.some(
		(x) => x.type === "shared" && x.active,
	);
	const inviteToken =
		typeof window === "undefined"
			? null
			: new URLSearchParams(window.location.search).get("invite");
	return (
		<>
			{reviewing && (
				<AccountReview
					key={reviewing}
					id={reviewing}
					run={run}
					close={() => setReviewing(null)}
				/>
			)}
			<div className="page-actions">
				<div className="button-row">
					<button
						type="button"
						disabled={!active}
						onClick={() =>
							run(async () => {
								const token = await link({});
								await openPlaid(token, async (publicToken) => {
									const id = await exchange({ publicToken });
									setReviewing(id);
								});
							}, "Bank linked. Check for accounts that need review.")
						}
					>
						Connect a bank
					</button>
				</div>
			</div>
			<section className="panel">
				<h2>Accounts in this budget</h2>
				{accounts?.map((a) => (
					<div className="account-row" key={a._id}>
						<div>
							<strong>{a.name}</strong>
							<small>
								{a.type} · {a.mask} ·{" "}
								{a.active ? "Current assignment" : "Historical records"}
							</small>
						</div>
						<div className="button-row">
							{a.canMove && (
								<button
									type="button"
									className="secondary"
									disabled={!active}
									onClick={() => setMoving(a)}
								>
									Move account
								</button>
							)}
							<button
								type="button"
								className="secondary"
								disabled={!active || !a.active}
								onClick={() => setRenaming(a)}
							>
								Rename
							</button>
						</div>
					</div>
				))}
				{!accounts?.length && (
					<p className="empty-state">
						No accounts yet. Connect a bank to import transactions
						automatically.
					</p>
				)}
			</section>
			<section className="panel">
				<h2>Your bank connections</h2>
				{connections?.map((c) => (
					<div className="connection-row" key={c._id}>
						<div>
							<strong>{c.institution}</strong>
							<small>
								{c.status} · Last successful import:{" "}
								{c.lastSync ? new Date(c.lastSync).toLocaleString() : "Not yet"}
							</small>
							{c.error && (
								<p className="over">{c.error}. Imported history is retained.</p>
							)}
						</div>
						<div className="button-row">
							{c.status === "review" && (
								<button type="button" onClick={() => setReviewing(c._id)}>
									Review accounts
								</button>
							)}
							<button
								type="button"
								className="secondary"
								disabled={["disconnected", "review", "discarding"].includes(
									c.status,
								)}
								onClick={() =>
									run(
										() => sync({ id: c._id }),
										"Sync requested. Check the connection status below.",
									)
								}
							>
								Sync
							</button>
							<button
								type="button"
								className="secondary"
								disabled={["disconnected", "review", "discarding"].includes(
									c.status,
								)}
								onClick={() =>
									run(async () => {
										const token = await link({ connectionId: c._id });
										await openPlaid(token, async () => {}, true);
										await sync({ id: c._id });
									}, "Reconnection completed.")
								}
							>
								Reconnect
							</button>
							<button
								type="button"
								className="text-button"
								disabled={c.status === "disconnected"}
								onClick={() => setDisconnecting(c._id)}
							>
								Disconnect
							</button>
						</div>
					</div>
				))}
				{!connections?.length && <p>No bank connections yet.</p>}
			</section>
			{(space.type === "shared" || !hasSharedBudget) && (
				<section className="panel narrow">
					<h2>Your shared budget</h2>
					{inviteToken && (
						<div className="banner">
							<p>
								You have an invitation. Accept it with the email address that
								received the invitation.
							</p>
							<button
								type="button"
								onClick={() =>
									run(async () => {
										await accept({ token: inviteToken });
										window.history.replaceState(null, "", "/");
									}, "Invitation accepted.")
								}
							>
								Accept invitation
							</button>
						</div>
					)}
					{space.type === "private" ? (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								void run(
									() => create({}),
									"Shared budget created. Select it to invite your partner.",
								);
							}}
						>
							<p>
								You can share one budget with one partner. Each of you has equal
								control. Your private budget remains separate.
							</p>
							<button type="submit">Create shared budget</button>
						</form>
					) : (
						<>
							{active && (
								<button
									type="button"
									className="danger"
									onClick={() => setLeaving(spaceId)}
								>
									Leave shared budget
								</button>
							)}
							<p>
								{status?.members
									.map((x) => `${x.name}${x.active ? "" : " (left)"}`)
									.join(" & ")}
							</p>
							<form
								onSubmit={(e) => {
									e.preventDefault();
									const data = new FormData(e.currentTarget);
									void run(
										() => invite({ spaceId, email: String(data.get("email")) }),
										"Invitation queued for email delivery.",
									);
								}}
							>
								<label>
									Partner’s email
									<input name="email" type="email" required />
								</label>
								<button
									type="submit"
									disabled={
										!active ||
										(status?.members.filter((x) => x.active).length ?? 0) >= 2
									}
								>
									Send invitation
								</button>
							</form>
							{status?.invitations.map((x) => (
								<div className="alert-row" key={x._id}>
									<span>
										{x.email}
										<small>
											{x.status} · email {x.delivery} · expires{" "}
											{new Date(x.expiresAt).toLocaleDateString()}
										</small>
									</span>
									{x.status === "pending" && (
										<button
											type="button"
											className="text-button"
											onClick={() =>
												run(() => revoke({ id: x._id }), "Invitation revoked.")
											}
										>
											Revoke
										</button>
									)}
								</div>
							))}
						</>
					)}
				</section>
			)}
			{space.type === "private" &&
				home.spaces
					.filter((x) => x.type === "shared" && x.active)
					.map((x) => (
						<ContributionsView
							key={`${x._id}:${month}`}
							privateId={spaceId}
							sharedId={x._id}
							month={month}
							run={run}
						/>
					))}
			{renaming && (
				<Modal
					title="Rename account"
					onClose={() => !renamePending && setRenaming(null)}
				>
					<form
						onSubmit={async (e) => {
							e.preventDefault();
							if (renamePending) return;
							const name = String(
								new FormData(e.currentTarget).get("name"),
							).trim();
							if (!name) return;
							setRenamePending(true);
							try {
								if (
									await run(
										() =>
											rename({
												id: renaming._id,
												name,
												revision: renaming.revision,
											}),
										"Account renamed.",
									)
								)
									setRenaming(null);
							} finally {
								setRenamePending(false);
							}
						}}
					>
						<label htmlFor="accountsview-name">
							Account name
							<ValidatedInput
								id="accountsview-name"
								aria-label="Account name"
								validate={labelError}
								name="name"
								defaultValue={renaming.name}
								required
								maxLength={100}
								disabled={renamePending}
							/>
						</label>
						<div className="button-row">
							<button
								type="button"
								className="secondary"
								disabled={renamePending}
								onClick={() => setRenaming(null)}
							>
								Cancel
							</button>
							<button type="submit" disabled={renamePending}>
								{renamePending ? "Saving…" : "Save account name"}
							</button>
						</div>
					</form>
				</Modal>
			)}
			{disconnecting && (
				<ConfirmModal
					title="Disconnect bank"
					confirmLabel="Disconnect bank"
					onClose={() => setDisconnecting(null)}
					onConfirm={() =>
						run(
							() => disconnect({ id: disconnecting }),
							"Disconnected. History retained.",
						)
					}
				>
					<p>Disconnect this bank? Imported history will be kept.</p>
				</ConfirmModal>
			)}
			{leaving && (
				<ConfirmModal
					title="Leave shared budget"
					confirmLabel="Leave shared budget"
					onClose={() => setLeaving(null)}
					onConfirm={() =>
						run(
							() => leave({ spaceId: leaving }),
							"You left the shared budget.",
						)
					}
				>
					<p>
						Your accounts return to your private budget. The other partner keeps
						this budget. You keep read access to previously shared records.
					</p>
				</ConfirmModal>
			)}
			{moving && (
				<Modal title="Move account" onClose={() => setMoving(null)}>
					<p>
						Only transactions from today onward will be assigned to the
						destination budget. Earlier records stay in their current budget.
						Existing private history stays private. Earlier shared history
						remains available to both partners.
					</p>
					<form
						onSubmit={async (e) => {
							e.preventDefault();
							if (!destination) return;
							if (
								await run(
									() =>
										move({
											id: moving._id,
											destinationId: destination._id,
											revision: moving.revision,
										}),
									"Account moved. Earlier history was kept in its original budget.",
								)
							)
								setMoving(null);
						}}
					>
						<p>
							<strong>Destination budget</strong>
							<br />
							{destination
								? `${destination.name} · ${destination.type}`
								: "No destination budget available."}
						</p>
						<button type="submit" disabled={!destination}>
							Confirm account move
						</button>
					</form>
				</Modal>
			)}
		</>
	);
}

function AccountReview({
	id,
	run,
	close,
}: {
	id: Id<"connections">;
	run: ViewProps["run"];
	close: () => void;
}) {
	const accounts = useQuery(api.bank.review, { id });
	const confirm = useMutation(api.bank.confirmAccounts);
	const [decisions, setDecisions] = useState<Record<string, string>>({});
	if (accounts === undefined || accounts === null) return null;
	return (
		<Modal title="Check possible duplicate accounts" onClose={close}>
			<p>
				No transactions will import until you complete this check. A match uses
				the bank, account type, and last four digits of an account connected by
				you or your partner.
			</p>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void run(async () => {
						await confirm({
							id,
							decisions: Object.entries(decisions).map(
								([accountId, value]) => ({
									accountId,
									sameAccount: value === "same",
								}),
							),
						});
						close();
					}, "Account review saved.");
				}}
			>
				{accounts
					.filter((a) => a.possibleDuplicate)
					.map((a) => (
						<label key={a.accountId}>
							{a.name} · {a.type} · {a.mask}
							<select
								required
								value={decisions[a.accountId] ?? ""}
								onChange={(e) =>
									setDecisions({ ...decisions, [a.accountId]: e.target.value })
								}
							>
								<option value="">Is this an account already connected?</option>
								<option value="same">
									Same account — keep the existing connection
								</option>
								<option value="different">
									Different account — import this account
								</option>
							</select>
						</label>
					))}
				<p>Other selected accounts will import with this connection.</p>
				<button type="submit">Confirm accounts</button>
			</form>
		</Modal>
	);
}
