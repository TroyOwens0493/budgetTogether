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
	const saveOptions = useMutation(api.accounts.saveOptions);
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
					const data = new FormData(event.currentTarget);
					const name = String(data.get("name")).trim();
					const destination = destinations.find(
						(x) => x._id === data.get("destination"),
					);
					if (labelError(name)) return;
					void save(
						() =>
							saveOptions({
								id: account._id,
								name,
								revision: account.revision,
								destinationId: destination?._id,
							}),
						"Account settings saved.",
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
						<label htmlFor="account-options-budget">
							Destination budget
							<select
								id="account-options-budget"
								name="destination"
								defaultValue=""
								disabled={pending || !account.active}
							>
								<option value="">Current budget</option>
								{destinations.map((destination) => (
									<option key={destination._id} value={destination._id}>
										{destination.name} · {destination.type}
									</option>
								))}
							</select>
						</label>
					)}
				</section>
				<button type="submit" disabled={pending || !account.active}>
					{pending ? "Saving…" : "Save"}
				</button>
			</form>
		</Modal>
	);
}
