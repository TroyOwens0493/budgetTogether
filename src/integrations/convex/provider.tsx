import {
	type AuthClient,
	ConvexBetterAuthProvider,
} from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { type ReactNode, useState } from "react";
import { authClient } from "../../lib/auth-client";
export default function AppConvexProvider({
	children,
}: {
	children: ReactNode;
}) {
	const url = import.meta.env.VITE_CONVEX_URL;
	const [client] = useState(() => (url ? new ConvexReactClient(url) : null));
	if (!client)
		return (
			<main className="auth-card">
				{import.meta.env.DEV ? (
					<>
						<h1>Set up Budget Together</h1>
						<p>
							Set VITE_CONVEX_URL and VITE_CONVEX_SITE_URL in .env.local, then
							start the development server again.
						</p>
					</>
				) : (
					<>
						<h1>Budget Together is unavailable</h1>
						<p>We're working on it. Try again later.</p>
					</>
				)}
			</main>
		);
	// Better Auth 1.6.33 changes the inferred plugin generic; the configured Convex plugin matches this provider.
	return (
		<ConvexBetterAuthProvider
			client={client}
			authClient={authClient as unknown as AuthClient}
		>
			{children}
		</ConvexBetterAuthProvider>
	);
}
