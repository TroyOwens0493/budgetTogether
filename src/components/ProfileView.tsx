import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import {
	labelError,
	passwordLimits,
	timeZoneError,
} from "../domain/validation";
import { authClient } from "../lib/auth-client";
import { Modal } from "./ui";
import { ValidatedInput } from "./ValidatedInput";
import type { Home, Run } from "./view-types";

export function ProfileView({
	profile,
	email,
	run,
}: {
	profile: Pick<NonNullable<Home["profile"]>, "name" | "timeZone">;
	email: string;
	run: Run;
}) {
	const setup = useMutation(api.budgets.setup);
	const [passwordOpen, setPasswordOpen] = useState(false);
	return (
		<>
			<form
				className="panel narrow"
				onSubmit={(e) => {
					e.preventDefault();
					const data = new FormData(e.currentTarget);
					void run(async () => {
						const name = String(data.get("name"));
						const result = await authClient.updateUser({ name });
						if (result.error) throw new Error(result.error.message);
						await setup({ name, timeZone: String(data.get("timeZone")) });
					});
				}}
			>
				<label htmlFor="budgetapp-name">
					Name
					<ValidatedInput
						id="budgetapp-name"
						aria-label="Name"
						validate={labelError}
						name="name"
						defaultValue={profile.name}
						required
						maxLength={100}
					/>
				</label>
				<label>
					Email
					<input value={email} readOnly type="email" />
				</label>
				<label htmlFor="budgetapp-timeZone">
					Time zone
					<ValidatedInput
						id="budgetapp-timeZone"
						aria-label="Time zone"
						validate={timeZoneError}
						name="timeZone"
						defaultValue={profile.timeZone}
						required
					/>
				</label>
				<button type="submit">Save profile</button>
				<button
					type="button"
					className="secondary"
					onClick={() => setPasswordOpen(true)}
				>
					Change password
				</button>
			</form>
			{passwordOpen && (
				<Modal title="Change password" onClose={() => setPasswordOpen(false)}>
					<form
						onSubmit={async (e) => {
							e.preventDefault();
							const f = new FormData(e.currentTarget);
							if (
								await run(async () => {
									const result = await authClient.changePassword({
										currentPassword: String(f.get("current")),
										newPassword: String(f.get("new")),
										revokeOtherSessions: true,
									});
									if (result.error) throw new Error(result.error.message);
								})
							)
								setPasswordOpen(false);
						}}
					>
						<label>
							Current password
							<input
								name="current"
								type="password"
								autoComplete="current-password"
								required
							/>
						</label>
						<label>
							New password
							<input
								name="new"
								type="password"
								minLength={passwordLimits.min}
								maxLength={passwordLimits.max}
								autoComplete="new-password"
								required
							/>
						</label>
						<button type="submit">Save password</button>
					</form>
				</Modal>
			)}
		</>
	);
}
