import assert from "node:assert/strict";
import test from "node:test";
import { amountError, labelError } from "../src/domain/validation";

test("budget and funding amounts reject negatives, invalid precision and unsafe cents", () => {
	for (const value of ["-1", "1.001", "abc", "", "90071992547409.92"])
		assert.notEqual(amountError(value), "", value);
	for (const value of ["0", "100.01", " 12.50 ", "90071992547409.91"])
		assert.equal(amountError(value), "", value);
	assert.equal(amountError("-10.50", true), "");
	assert.notEqual(amountError("-10.501", true), "");
});

test("labels reject names made only of spaces", () => {
	assert.notEqual(labelError("   "), "");
	assert.equal(labelError(" Alice "), "");
});
