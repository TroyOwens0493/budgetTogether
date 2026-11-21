import { ConvexError } from "convex/values";
import { passwordLimits } from "../domain/validation";

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

type AuthError = { code?: string; status?: number } | null | undefined;

const tooShortOrLong = `Use a password with ${passwordLimits.min} to ${passwordLimits.max} characters.`;
const authMessages: Record<string, string> = {
	INVALID_EMAIL_OR_PASSWORD:
		"That email and password don't match. Check them and try again, or reset your password.",
	INVALID_PASSWORD: "Your current password isn't correct.",
	INVALID_EMAIL: "Enter a valid email address, such as name@example.com.",
	USER_ALREADY_EXISTS:
		"An account already uses this email. Sign in, or reset your password.",
	USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
		"An account already uses this email. Sign in, or reset your password.",
	INVALID_TOKEN:
		"This reset link has expired or was already used. Request a new link.",
	TOKEN_EXPIRED:
		"This reset link has expired or was already used. Request a new link.",
	PASSWORD_TOO_SHORT: tooShortOrLong,
	PASSWORD_TOO_LONG: tooShortOrLong,
	SESSION_EXPIRED:
		"For your security, sign out and sign in again, then make this change.",
	SESSION_NOT_FRESH:
		"For your security, sign out and sign in again, then make this change.",
};

/** Plain text for a Better Auth error. Unknown codes use the fallback. */
export function authErrorMessage(error: AuthError, fallback: string): string {
	if (error?.status === 429)
		return "Too many attempts. Wait a minute, then try again.";
	return (error?.code && authMessages[error.code]) || fallback;
}
