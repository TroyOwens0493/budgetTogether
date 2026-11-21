const statusLabels: Record<string, string> = {
	connected: "Connected",
	syncing: "Importing",
	review: "Waiting for account review",
	discarding: "Removing",
	reconnect: "Needs reconnection",
	stale: "Import paused",
	disconnected: "Disconnected",
};

const signInAgain =
	"Your bank needs you to sign in again. Select Reconnect to resume imports.";
const tryLater =
	"Your bank isn't responding right now. Select Sync to try again later.";

/** Plaid error codes the user can act on. Others use the generic message. */
const problems: Record<string, string> = {
	ITEM_LOGIN_REQUIRED: signInAgain,
	PENDING_EXPIRATION: signInAgain,
	PENDING_DISCONNECT: signInAgain,
	INVALID_CREDENTIALS: signInAgain,
	INVALID_MFA: signInAgain,
	USER_PERMISSION_REVOKED: signInAgain,
	ACCESS_NOT_GRANTED:
		"Your bank didn't share the account access imports need. Select Reconnect and allow access to your accounts.",
	ITEM_LOCKED:
		"Your bank locked online access for this login. Unlock it on your bank's website, then select Reconnect.",
	USER_SETUP_REQUIRED:
		"Your bank needs you to finish a step on its website first. Sign in there, then select Reconnect.",
	INSTITUTION_DOWN: tryLater,
	INSTITUTION_NOT_RESPONDING: tryLater,
	INSTITUTION_NOT_AVAILABLE: tryLater,
	PRODUCT_NOT_READY:
		"Your bank is still preparing your transactions. Select Sync again in a few minutes.",
	RATE_LIMIT_EXCEEDED:
		"Too many import requests were sent. Wait a few minutes, then select Sync.",
	INSTITUTION_NO_LONGER_SUPPORTED:
		"This bank no longer supports automatic imports. Disconnect it to stop import attempts.",
	NO_ACCOUNTS:
		"Your bank didn't return any accounts for this login. Select Reconnect and choose an account.",
};

/** Plain-language status and problem text for a bank connection. */
export function connectionStatus(status: string, error?: string) {
	const problem = error
		? (problems[error] ??
			(status === "reconnect"
				? signInAgain
				: "The last import didn't finish. Select Sync to try again."))
		: undefined;
	return {
		label: statusLabels[status] ?? "Unknown status",
		problem: problem && `${problem} Your imported history is kept.`,
	};
}
