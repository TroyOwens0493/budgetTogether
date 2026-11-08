import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { labelError } from "../domain/validation";
import { Modal } from "./ui";
import { ValidatedInput } from "./ValidatedInput";
import type { Home, Run } from "./view-types";

export function AccountOptions({
	account,
	destinations,
	run,
	close,
}: {
	account: FunctionReturnType<typeof api.accounts.list>[number];
	destinations: Home["spaces"];
	run: Run;
	close: () => void;
}) {
	const rename = useMutation(api.accounts.rename);
	const move = useMutation(api.accounts.move);
	const [pending, setPending] = useState(false);
	const inFlight = useRef(false);
	async function save(work: () => Promise<unknown>, success: string) {
		if (inFlight.current) return;
		inFlight.current = true;
		setPending(true);
		try {
			if (await run(work, success)) close();
		} finally {
			inFlight.current = false;
			setPending(false);
		}
	}
	return (
		<Modal title="Account options" onClose={() => !inFlight.current && close()}>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					const name = String(
						new FormData(event.currentTarget).get("name"),
					).trim();
					if (labelError(name)) return;
					void save(
						() => rename({ id: account._id, name, revision: account.revision }),
						"Account renamed.",
					);
				}}
			>
				<label htmlFor="account-options-name">
					Account name
					<ValidatedInput
						id="account-options-name"
						name="name"
						defaultValue={account.name}
						validate={labelError}
						required
						maxLength={100}
						disabled={pending || !account.active}
					/>
				</label>
				<button type="submit" disabled={pending || !account.active}>
					Save account name
				</button>
			</form>
			<section className="account-options-move">
				<h3>Move to another budget</h3>
				{!account.canMove ? (
					<p className="muted">
						Only the person who connected this account can move it.
					</p>
				) : !destinations.length ? (
					<p className="muted">
						No other budget available. Create a shared budget to move this
						account.
					</p>
				) : (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							const selected = new FormData(event.currentTarget).get(
								"destination",
							);
							const destination = destinations.find((x) => x._id === selected);
							if (!destination) return;
							void save(
								() =>
									move({
										id: account._id,
										destinationId: destination._id,
										revision: account.revision,
									}),
								"Account moved. Earlier history was kept in its original budget.",
							);
						}}
					>
						<label htmlFor="account-options-budget">
							Destination budget
							<select
								id="account-options-budget"
								name="destination"
								required
								disabled={pending || !account.active}
							>
								{destinations.map((destination) => (
									<option key={destination._id} value={destination._id}>
										{destination.name} · {destination.type}
									</option>
								))}
							</select>
						</label>
						<p className="muted">
							Only transactions from today onward move to the destination
							budget. Earlier records stay in their current budget. Private
							history stays private, and earlier shared history stays available
							to both partners.
						</p>
						<button type="submit" disabled={pending || !account.active}>
							Move account
						</button>
					</form>
				)}
			</section>
		</Modal>
	);
}
