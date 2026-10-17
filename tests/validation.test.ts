import assert from "node:assert/strict";
import test from "node:test";
import { labelError } from "../src/domain/validation";

test("labels reject names made only of spaces", () => {
	assert.notEqual(labelError("   "), "");
	assert.equal(labelError(" Alice "), "");
});
