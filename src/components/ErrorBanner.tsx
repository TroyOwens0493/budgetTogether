import { X } from "lucide-react";
import { createContext, useContext } from "react";

/** The latest failed action, so an open dialog can show it above its backdrop. */
export const ActionErrorContext = createContext<{
	message: string;
	dismiss: () => void;
}>({ message: "", dismiss: () => {} });

/** Shows the latest failed action inside a dialog, where the page banner is hidden. */
export function ActionErrorBanner() {
	const { message, dismiss } = useContext(ActionErrorContext);
	return message ? <ErrorBanner message={message} onDismiss={dismiss} /> : null;
}

export function ErrorBanner({
	message,
	onDismiss,
	dismissLabel = "Dismiss error notification",
}: {
	message: string;
	onDismiss: () => void;
	dismissLabel?: string;
}) {
	return (
		<div className="banner error dismissible-banner" role="alert">
			{message}
			<button
				type="button"
				className="banner-dismiss"
				aria-label={dismissLabel}
				onClick={onDismiss}
			>
				<X size={18} aria-hidden="true" />
			</button>
		</div>
	);
}
