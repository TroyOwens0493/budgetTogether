import { createFileRoute } from "@tanstack/react-router";

async function handleAuth({ request }: { request: Request }) {
	const { handler } = await import("#/lib/auth");
	return handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: handleAuth,
			POST: handleAuth,
		},
	},
});
