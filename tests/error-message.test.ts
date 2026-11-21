import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { authErrorMessage, errorMessage } from "../src/lib/error-message";

const fallback = "The request failed. Try again.";

test("Convex validation messages omit the client diagnostic wrapper", () => {
	const validation =
		"Investment contributions cannot exceed this month's savings target.";
	// The Convex client receives diagnostics as the message and restores data separately.
	const error = new ConvexError<string>(
		`[CONVEX M(projections:saveHolding)] [Request ID: test] Server Error\nUncaught ConvexError: ${validation}\n    at saveHolding (convex/model/projections.ts:253:4)`,
	);
	error.data = validation;
	assert.equal(errorMessage(error, fallback), validation);
});

test("Convex errors without displayable text use the fallback", () => {
	for (const data of ["", " ", null, { internal: "diagnostic details" }])
		assert.equal(errorMessage(new ConvexError(data), fallback), fallback);
});

test("hidden server errors use the fallback instead of diagnostics", () => {
	for (const message of [
		"[CONVEX M(budgets:savePlan)] [Request ID: 1a2b] Server Error",
		"[CONVEX Q(projections:list)] [Request ID: 1a2b] Server Error\n  Called by client",
		"[CONVEX A(bank:sync)] Uncaught Error: Configure PLAID_CLIENT_ID",
		"",
	])
		assert.equal(errorMessage(new Error(message), fallback), fallback);
});

test("local validation errors keep their message and unknown failures use the fallback", () => {
	assert.equal(
		errorMessage(new Error("Enter a percentage, such as 5.25."), fallback),
		"Enter a percentage, such as 5.25.",
	);
	for (const error of [null, undefined, "diagnostic details", {}])
		assert.equal(errorMessage(error, fallback), fallback);
});

test("auth errors use plain text and hide developer messages", () => {
	assert.match(
		authErrorMessage({ code: "INVALID_TOKEN" }, fallback),
		/Request a new link/,
	);
	assert.match(
		authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" }, fallback),
		/don't match/,
	);
	assert.match(authErrorMessage({ status: 429 }, fallback), /Too many/);
	for (const error of [
		{ code: "FAILED_TO_CREATE_USER" },
		{ code: "INVALID_ORIGIN" },
		{},
		null,
	])
		assert.equal(authErrorMessage(error, fallback), fallback);
});
