import { X } from "lucide-react";

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
