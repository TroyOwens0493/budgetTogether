import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { errorMessage } from "../lib/error-message";
import appCss from "../styles.css?url";
export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Budget Together" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: ({ children }) => (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	),
	errorComponent: ({ error, reset }) => (
		<main className="auth-card">
			<h1>We could not load this page</h1>
			<p role="alert">
				{errorMessage(error, "Check your connection, then select Try again.")}
			</p>
			<button type="button" onClick={reset}>
				Try again
			</button>
		</main>
	),
	notFoundComponent: () => (
		<main className="auth-card">
			<h1>Page not found</h1>
			<a href="/">Return to your budget</a>
		</main>
	),
});
