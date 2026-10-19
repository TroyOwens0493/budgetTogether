import { useMutation, useQuery } from "convex/react";
import { Bell } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Modal } from "./ui";
import type { ViewProps } from "./view-types";

// Keep the trigger in the topbar and the dialog at the app root.
export function useAlerts({ spaceId, month, run }: Omit<ViewProps, "active">) {
	const alerts = useQuery(api.budgets.alerts, { spaceId, month });
	const readAlert = useMutation(api.budgets.readAlert);
	const [alertOpen, setAlertOpen] = useState(false);
	return {
		button: (
			<button
				type="button"
				className="icon-button"
				aria-label={`Alerts, ${alerts?.filter((x) => !x.read).length ?? 0} unread`}
				onClick={() => setAlertOpen(true)}
			>
				<Bell size={18} />
				{Boolean(alerts?.some((x) => !x.read)) && (
					<span className="notification-dot" />
				)}
			</button>
		),
		dialog: alertOpen && (
			<Modal title="Your alerts" onClose={() => setAlertOpen(false)}>
				{!alerts?.length ? (
					<p>No category alerts this month.</p>
				) : (
					alerts.map((x) => (
						<div key={x.key} className="alert-row">
							<p>{x.text}</p>
							{!x.read && (
								<button
									type="button"
									className="secondary"
									onClick={() =>
										run(() => readAlert({ spaceId, key: x.key }), "Alert read.")
									}
								>
									Mark read
								</button>
							)}
						</div>
					))
				)}
			</Modal>
		),
	};
}
