import assert from "node:assert/strict";
import test from "node:test";
import {
	amountError,
	authEmailError,
	categoryNameError,
	labelError,
	partnerEmailError,
	timeZoneError,
} from "../src/domain/validation";

test("budget and funding amounts reject negatives, invalid precision and unsafe cents", () => {
	for (const value of ["-1", "1.001", "abc", "", "90071992547409.92"])
		assert.notEqual(amountError(value), "", value);
	for (const value of ["0", "100.01", " 12.50 ", "90071992547409.91"])
		assert.equal(amountError(value), "", value);
	assert.equal(amountError("-10.50", true), "");
	assert.notEqual(amountError("-10.501", true), "");
});

test("labels must contain non-space characters and time zones must exist", () => {
	assert.notEqual(labelError("   "), "");
	assert.notEqual(labelError("a".repeat(101)), "");
	assert.equal(labelError(" Alice "), "");
	assert.equal(labelError("a".repeat(200), 200), "");
	assert.equal(timeZoneError("America/Boise"), "");
	assert.equal(timeZoneError("UTC"), "");
	assert.notEqual(timeZoneError("Boise"), "");
	assert.notEqual(timeZoneError(""), "");
});

test("category names use trimmed, case-insensitive uniqueness and allow the current name", () => {
	const categories = [{ _id: "groceries", name: "Groceries" }];
	assert.notEqual(categoryNameError(" groceries ", categories), "");
	assert.equal(categoryNameError(" groceries ", categories, "groceries"), "");
	assert.equal(categoryNameError("Transport", categories), "");
	assert.notEqual(categoryNameError(" ", categories), "");
});

test("invitations reject the sender's email and email domains without a dot", () => {
	assert.notEqual(
		partnerEmailError(" ALICE@example.com ", "alice@example.com"),
		"",
	);
	assert.notEqual(partnerEmailError("bob@localhost", "alice@example.com"), "");
	assert.equal(partnerEmailError(" BOB@example.com ", "alice@example.com"), "");
});

test("auth emails catch formats accepted by browsers but rejected by Better Auth", () => {
	for (const value of [
		"alice@localhost",
		"alice..smith@example.com",
		".alice@example.com",
	])
		assert.notEqual(authEmailError(value), "", value);
	for (const value of ["alice@example.com", "alice.smith+budget@example.co.uk"])
		assert.equal(authEmailError(value), "", value);
});
