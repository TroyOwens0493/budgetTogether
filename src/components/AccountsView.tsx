import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { openPlaid } from "../lib/plaid-link";
import { AccountOptions } from "./AccountOptions";
import { ContributionsView } from "./ContributionsView";
import { SharingInvites } from "./SharingInvites";
import { ConfirmModal, Modal } from "./ui";
import type { ViewProps } from "./view-types";
export function AccountsView({
	spaceId,
	month,
	active,
	run,
	home,
	fundedByShared,
}: ViewProps & {
	home: FunctionReturnType<typeof api.budgets.home>;
	fundedByShared: boolean;
}) {
	const accounts = useQuery(api.accounts.list, { spaceId });
	const connections = useQuery(api.accounts.connections, {});
	const link = useAction(api.bank.link);
	const exchange = useAction(api.bank.exchange);
	const sync = useAction(api.bank.sync);
	const disconnect = useAction(api.bank.disconnect);
	const leave = useMutation(api.sharing.leave);
	const [reviewing, setReviewing] = useState<Id<"connections"> | null>(null);
	const [leaving, setLeaving] = useState<Id<"spaces"> | null>(null);
	const [editingAccount, setEditingAccount] = useState<Id<"accounts"> | null>(
		null,
	);
	const [disconnecting, setDisconnecting] = useState<Id<"connections"> | null>(
		null,
	);
	const space = home.spaces.find((x) => x._id === spaceId)!;
	const selectedAccount = accounts?.find((a) => a._id === editingAccount);
	const hasSharedBudget = home.spaces.some(
		(x) => x.type === "shared" && x.active,
	);

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
				<div className="accounts-grid">
					{accounts?.map((a) => (
						<article className="budget-account-card" key={a._id}>
							<div>
								<strong>{a.name}</strong>
								<small>
									{a.type} · {a.mask} ·{" "}
									{a.active ? "Current assignment" : "Historical records"}
								</small>
							</div>
							<button
								type="button"
								className="secondary account-options-button"
								disabled={!active || !a.active}
								aria-haspopup="dialog"
								onClick={() => setEditingAccount(a._id)}
							>
								Options <span aria-hidden="true">↗</span>
							</button>
						</article>
					))}
				</div>
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
			{space.type === "private" && !hasSharedBudget && (
				<SharingInvites email={home.user.email} run={run} />
			)}
			{space.type === "shared" && (
				<button
					type="button"
					className="danger leave-shared-budget"
					onClick={() => setLeaving(spaceId)}
				>
					Leave shared budget
				</button>
			)}
			{space.type === "private" && fundedByShared && (
				<section className="panel">
					<h2>Personal funding</h2>
					<p>Assign personal funding from the shared monthly budget.</p>
				</section>
			)}
			{space.type === "private" &&
				home.spaces
					.filter((x) => x.type === "shared")
					.map((x) => (
						<ContributionsView
							key={`${x._id}:${month}`}
							privateId={spaceId}
							sharedId={x._id}
							month={month}
							run={run}
						/>
					))}
			{selectedAccount && (
				<AccountOptions
					key={selectedAccount._id}
					account={selectedAccount}
					destinations={home.spaces.filter(
						(x) => x.active && x._id !== spaceId,
					)}
					run={run}
					close={() => setEditingAccount(null)}
				/>
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
					confirmLabel="Leave and delete shared budget"
					onClose={() => setLeaving(null)}
					onConfirm={() =>
						run(
							() => leave({ spaceId: leaving }),
							"Shared budget deleted for both people.",
						)
					}
				>
					<p>
						Leaving permanently deletes this shared budget and all its records
						for both people. This cannot be undone. Each person's accounts
						return to their private budget. Private records and bank connections
						are kept.
					</p>
				</ConfirmModal>
			)}
		</>
	);
}

export function AccountReview({
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
				No account data will import until you complete this check. A match uses
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
