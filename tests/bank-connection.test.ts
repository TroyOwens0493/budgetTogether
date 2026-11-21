import assert from "node:assert/strict";
import test from "node:test";
import { connectionStatus } from "../src/domain/bank-connection.ts";

test("bank connection problems explain the next step without provider codes", () => {
	const login = connectionStatus("reconnect", "ITEM_LOGIN_REQUIRED");
	assert.equal(login.label, "Needs reconnection");
	assert.equal(
		login.problem,
		"Your bank needs you to sign in again. Select Reconnect to resume imports. Your imported history is kept.",
	);
	for (const [status, code] of [
		["stale", "SYNC_FAILED"],
		["stale", "INVESTMENT_SYNC_FAILED"],
		["stale", "SOME_NEW_PLAID_CODE"],
		["reconnect", "SOME_NEW_PLAID_CODE"],
	]) {
		const { problem } = connectionStatus(status, code);
		assert.ok(problem?.endsWith("Your imported history is kept."));
		assert.doesNotMatch(problem ?? "", /[A-Z]+_[A-Z]+/);
	}
	assert.match(
		connectionStatus("reconnect", "SOME_NEW_PLAID_CODE").problem ?? "",
		/Reconnect/,
	);
	assert.deepEqual(connectionStatus("connected"), {
		label: "Connected",
		problem: undefined,
	});
});
