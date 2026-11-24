import { X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

/** The latest failed action, so an open dialog can show it above its backdrop. */
export const ActionErrorContext = createContext<{
	message: string;
	dismiss: () => void;
}>({ message: "", dismiss: () => {} });

/** Shows a failed action inside a dialog, where the page banner is hidden. */
export function ActionErrorBanner() {
	const { message, dismiss } = useContext(ActionErrorContext);
	// An error from before this dialog opened stays on the page only.
	const [earlier, setEarlier] = useState(message);
	const shown = message !== earlier ? message : "";
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!message) setEarlier("");
	}, [message]);
	// Save buttons sit at the bottom of long dialogs, so bring the error into view.
	useEffect(() => {
		if (shown) ref.current?.scrollIntoView({ block: "nearest" });
	}, [shown]);
	return shown ? (
		<div ref={ref}>
			<ErrorBanner message={shown} onDismiss={dismiss} />
		</div>
	) : null;
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
