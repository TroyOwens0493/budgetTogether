import { ConvexError } from "convex/values";

/** Convex hides server errors that are not ConvexError behind a diagnostic message. */
const serverDiagnostic = /^\[CONVEX [A-Z]\(|^\[Request ID:|Server Error$/m;

/** Return text that is safe to show to a user, or the fallback. */
export function errorMessage(error: unknown, fallback: string): string {
	if (error instanceof ConvexError)
		return typeof error.data === "string" && error.data.trim()
			? error.data
			: fallback;
	return error instanceof Error &&
		error.message.trim() &&
		!serverDiagnostic.test(error.message)
		? error.message
		: fallback;
}
