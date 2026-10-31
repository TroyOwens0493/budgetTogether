import { ConvexError } from "convex/values";

export function errorMessage(error: unknown, fallback: string): string {
	if (error instanceof ConvexError)
		return typeof error.data === "string" && error.data.trim()
			? error.data
			: fallback;
	return error instanceof Error ? error.message : fallback;
}
