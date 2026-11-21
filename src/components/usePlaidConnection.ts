import { useAction, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { connectionStatus } from "../domain/bank-connection";
import { openPlaid } from "../lib/plaid-link";
import type { Run } from "./view-types";

type ConnectionFlow =
	| { phase: "idle" | "connecting" | "finishing" | "cancelled" | "failed" }
	| { phase: "linked"; id: Id<"connections">; reconnect: boolean };

export function usePlaidConnection(
	run: Run,
	review: (id: Id<"connections">) => void,
	investments = false,
) {
	const link = useAction(api.bank.link);
	const exchange = useAction(api.bank.exchange);
	const sync = useAction(api.bank.sync);
	const [flow, setFlow] = useState<ConnectionFlow>({ phase: "idle" });
	const inFlight = useRef(false);
	const connections = useQuery(
		api.accounts.connections,
		flow.phase === "linked" ? {} : "skip",
	);

	async function connect(connectionId?: Id<"connections">) {
		if (inFlight.current) return;
		inFlight.current = true;
		setFlow({ phase: "connecting" });
		try {
			const ok = await run(async () => {
				const token = await link(
					connectionId ? { connectionId } : { investments },
				);
				let id = connectionId;
				const result = await openPlaid(
					token,
					connectionId
						? undefined
						: async (publicToken) => {
								setFlow({ phase: "finishing" });
								id = await exchange({ publicToken, investments });
							},
				);
				if (result === "cancelled") {
					setFlow({ phase: "cancelled" });
					return;
				}
				if (connectionId) {
					setFlow({ phase: "finishing" });
					await sync({ id: connectionId });
				}
				if (id) {
					setFlow({ phase: "linked", id, reconnect: Boolean(connectionId) });
					if (!connectionId) review(id);
				}
			}, "");
			if (!ok) setFlow({ phase: "failed" });
		} finally {
			inFlight.current = false;
		}
	}

	const busy = flow.phase === "connecting" || flow.phase === "finishing";
	let message = "";
	switch (flow.phase) {
		case "connecting":
			message = "Connecting securely with Plaid…";
			break;
		case "finishing":
			message = "Finishing the connection…";
			break;
		case "cancelled":
			message = "Connection cancelled.";
			break;
		case "failed":
			message = "Couldn’t complete the connection. See the error for details.";
			break;
		case "linked": {
			const connection = connections?.find((row) => row._id === flow.id);
			const location =
				"New accounts start in Personal. In Accounts & sharing, use Options to move them to Shared.";
			if (connection?.status === "review")
				message = "Review possible duplicate accounts to start importing.";
			else if (connection?.status === "connected")
				message = flow.reconnect
					? "Reconnected. Import complete."
					: `Import complete. ${location}`;
			else if (!connection || connection.status === "syncing")
				message = flow.reconnect
					? "Reconnected. Importing data…"
					: `Connected. Importing data… ${location}`;
			else {
				const status = connectionStatus(connection.status, connection.error);
				message = `${status.label}. ${status.problem ?? "See the connection in Accounts & sharing."}`;
			}
			break;
		}
	}
	return { connect, busy, message };
}
