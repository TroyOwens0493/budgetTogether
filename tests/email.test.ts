import assert from "node:assert/strict";
import test from "node:test";
import * as email from "../convex/email.ts";
import {
	invitationEmail,
	passwordResetEmail,
} from "../convex/emailTemplates.ts";
import { invoke, Memory } from "./helpers/backend.ts";

const inviteUrl =
	"https://budget.example.test/?invite=example-token&source=email";

test("invitation HTML and plain text preserve the intended recipient, action, and expiration", () => {
	const message = invitationEmail({
		inviterName: "Alice",
		email: "bob@example.test",
		url: inviteUrl,
	});
	assert.match(message.subject, /Alice/);
	for (const content of [message.html, message.text]) {
		assert.match(content, /bob@example.test/);
		assert.match(content, /7 days/);
		assert.match(content, /only after you accept/);
		assert.match(content, /Review invitation/);
	}
	assert.match(message.text, /\?invite=example-token&source=email/);
	const links = [...message.html.matchAll(/href="([^"]+)"/g)].map(
		(match) => match[1],
	);
	assert.equal(links.length, 2);
	assert.ok(links.every((link) => link === inviteUrl.replaceAll("&", "&amp;")));
});

test("email content cannot inject markup through sender names or recipient addresses", () => {
	const message = invitationEmail({
		inviterName: '<img src=x onerror="alert(1)"> Alice & Bob',
		email: 'bob+"<test>"@example.test',
		url: inviteUrl,
	});
	assert.doesNotMatch(message.html, /<img|<script|<iframe|<link/i);
	assert.match(
		message.html,
		/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; Alice &amp; Bob/,
	);
	assert.match(message.html, /bob\+&quot;&lt;test&gt;&quot;@example.test/);
});

test("both email templates reject executable links", () => {
	for (const url of [
		"javascript:alert(1)",
		"data:text/html,example",
		"file:///tmp/example",
	]) {
		assert.throws(() => passwordResetEmail(url), /HTTP or HTTPS/);
		assert.throws(
			() =>
				invitationEmail({
					inviterName: "Alice",
					email: "bob@example.test",
					url,
				}),
			/HTTP or HTTPS/,
		);
	}
});

test("password reset delivers matching HTML and plain text through the existing Resend action", async (t) => {
	for (const [key, value] of Object.entries({
		RESEND_API_KEY: "email-test-key",
		RESEND_FROM: "budget@example.test",
	})) {
		const previous = process.env[key];
		process.env[key] = value;
		t.after(() => {
			if (previous === undefined) delete process.env[key];
			else process.env[key] = previous;
		});
	}
	const url = "https://budget.example.test/?token=reset-token&callback=%2F";
	const fetch = t.mock.method(
		globalThis,
		"fetch",
		async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body));
			assert.deepEqual(body.to, ["bob@example.test"]);
			assert.equal(body.subject, "Reset your Budget Together password");
			assert.match(body.html, /Reset password<\/a>/);
			assert.match(body.html, /token=reset-token&amp;callback=%2F/);
			assert.ok(body.text.includes(url));
			assert.doesNotMatch(body.html, /shared budget|invitation expires/i);
			assert.equal(
				(init.headers as Record<string, string>)["Idempotency-Key"],
				"reset-fixture",
			);
			return new Response(JSON.stringify({ id: "resend-fixture" }));
		},
	);
	await invoke(email.reset, new Memory(), {
		to: "bob@example.test",
		url,
		key: "reset-fixture",
	});
	assert.equal(fetch.mock.callCount(), 1);
});
