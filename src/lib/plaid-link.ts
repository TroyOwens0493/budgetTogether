type LinkHandler = { open: () => void; destroy: () => void };
type PlaidWindow = Window & {
	Plaid?: {
		create: (options: {
			token: string;
			onSuccess: (publicToken: string) => void;
			onExit: (error: { display_message?: string } | null) => void;
		}) => LinkHandler;
	};
};
let loading: Promise<void> | undefined;
export async function openPlaid(
	token: string,
	onSuccess?: (token: string) => Promise<void>,
): Promise<"linked" | "cancelled"> {
	if (!(window as PlaidWindow).Plaid) {
		loading ??= new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
			script.onload = () => resolve();
			script.onerror = () => {
				loading = undefined;
				script.remove();
				reject(
					new Error(
						"Could not load Plaid. Check your connection and try again.",
					),
				);
			};
			document.head.append(script);
		});
		await loading;
	}
	const plaid = (window as PlaidWindow).Plaid;
	if (!plaid)
		throw new Error(
			"Could not initialize Plaid. Reload the page and try again.",
		);
	return new Promise((resolve, reject) => {
		let completed = false;
		const handler = plaid.create({
			token,
			onSuccess: (publicToken) => {
				if (completed) return;
				completed = true;
				void Promise.resolve()
					.then(() => onSuccess?.(publicToken))
					.then(
						() => {
							handler.destroy();
							resolve("linked");
						},
						(e) => {
							handler.destroy();
							reject(e);
						},
					);
			},
			onExit: (error) => {
				if (completed) return;
				completed = true;
				handler.destroy();
				if (error)
					reject(
						new Error(
							error.display_message ?? "Bank connection was not completed.",
						),
					);
				else resolve("cancelled");
			},
		});
		handler.open();
	});
}
