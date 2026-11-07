import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import * as budgets from "../convex/budgets.ts";
import { hash } from "../convex/plaidClient.ts";
import * as sharing from "../convex/sharing.ts";
import {
	fixture,
	invoke,
	type Memory,
	sharedBudget,
} from "./helpers/backend.ts";

function emailSetup(t: TestContext) {
	const values = {
		RESEND_API_KEY: "fixture-key",
		RESEND_FROM: "budget-together@example.test",
		SITE_URL: "https://budget.example.test",
	};
	for (const [key, value] of Object.entries(values)) {
		const old = process.env[key];
		process.env[key] = value;
		t.after(() => {
			if (old === undefined) delete process.env[key];
			else process.env[key] = old;
		});
	}
}

async function queue(
	db: Memory,
	email = "bob@example.com",
	token = "first-link",
) {
	return invoke(sharing.storeInvite, db, {
		email,
		token,
		tokenHash: await hash(token),
	});
}
async function bobSetup(db: Memory) {
	db.current = "bob";
	await invoke(budgets.setup, db, { name: "Bob", timeZone: "UTC" });
}
const shared = (db: Memory) =>
	[...db.rows.values()].filter((row) => row.type === "shared");

test("sending an invite queues Resend delivery without creating a budget or exposing its token", async (t) => {
	emailSetup(t);
	const { db } = await fixture();
	const before = new Map(db.rows);
	await invoke(sharing.invite, db, { email: "  BOB@EXAMPLE.COM  " });
	assert.equal(shared(db).length, 0);
	for (const [key, row] of before) assert.deepEqual(await db.get(key), row);
	const outgoing = await invoke(sharing.outgoing, db, {});
	assert.equal(outgoing?.email, "bob@example.com");
	assert.equal(outgoing?.delivery, "queued");
	assert.ok(outgoing);
	assert.deepEqual(Object.keys(outgoing).sort(), [
		"_id",
		"delivery",
		"email",
		"expiresAt",
	]);
	assert.equal(db.scheduled.length, 1);
	assert.equal(db.scheduled[0].name, "sharing:send");
	assert.equal(typeof db.scheduled[0].args.token, "string");
	const stored = await db.get(outgoing._id);
	assert.equal(stored?.spaceId, undefined);
	assert.equal(stored?.token, undefined);
});

test("a new recipient signs up, reviews, and explicitly accepts to create an empty shared budget with default categories", async () => {
	const { db } = await fixture();
	const invitation = await queue(db);
	db.current = "bob";
	const preview = await invoke(sharing.preview, db, { token: "first-link" });
	assert.equal(preview.state, "ready");
	assert.equal(shared(db).length, 0);
	await assert.rejects(
		() => invoke(sharing.accept, db, { token: "first-link" }),
		/setup/,
	);
	assert.equal(shared(db).length, 0);
	await bobSetup(db);
	const before = new Map(db.rows);
	const spaceId = await invoke(sharing.accept, db, { token: "first-link" });
	assert.equal(shared(db).length, 1);
	assert.equal((await db.get(spaceId))?.timeZone, "America/Boise");
	for (const [key, row] of before)
		if (key !== invitation) assert.deepEqual(await db.get(key), row);
	const categories = [...db.rows.values()].filter(
		(row) => row.spaceId === spaceId && row._id.startsWith("categories:"),
	);
	assert.deepEqual(
		categories.map((row) => row.name),
		[
			"Housing",
			"Groceries",
			"Dining out",
			"Entertainment",
			"Transport",
			"Other",
		],
	);
	const members = [...db.rows.values()].filter(
		(row) => row.spaceId === spaceId && row._id.startsWith("memberships:"),
	);
	assert.deepEqual(members.map((row) => row.userId).sort(), ["alice", "bob"]);
	assert.ok(members.every((row) => row.active));
	assert.ok(
		![...db.rows.values()].some(
			(row) =>
				row.spaceId === spaceId &&
				/^(plans|transactions|accounts):/.test(row._id),
		),
	);
	assert.equal((await db.get(invitation))?.status, "accepted");
	await assert.rejects(
		() => invoke(sharing.accept, db, { token: "first-link" }),
		/invalid/,
	);
	assert.equal(shared(db).length, 1);
});

test("invites require the matching email and do not expose sender details to another account", async () => {
	const { db } = await fixture();
	await queue(db);
	db.current = "eve";
	assert.deepEqual(await invoke(sharing.preview, db, { token: "first-link" }), {
		state: "wrong-email",
	});
	await assert.rejects(
		() => invoke(sharing.accept, db, { token: "first-link" }),
		/another email/,
	);
	assert.equal(shared(db).length, 0);
});

test("one pending invite is allowed and only its sender can cancel or resend it", async () => {
	const { db } = await fixture();
	const invitation = await queue(db);
	await assert.rejects(
		() => queue(db, "charlie@example.com", "other-link"),
		/Cancel your pending/,
	);
	db.current = "eve";
	assert.equal(await invoke(sharing.outgoing, db, {}), null);
	await assert.rejects(
		() => invoke(sharing.revoke, db, { id: invitation }),
		/not found/,
	);
	await assert.rejects(
		() =>
			invoke(sharing.storeInvite, db, {
				id: invitation,
				token: "stolen-link",
				tokenHash: "stolen-hash",
			}),
		/no longer be resent|setup/,
	);
	db.current = "alice";
	await invoke(sharing.revoke, db, { id: invitation });
	assert.equal(await invoke(sharing.outgoing, db, {}), null);
	await queue(db, "charlie@example.com", "other-link");
	db.current = "bob";
	assert.deepEqual(await invoke(sharing.preview, db, { token: "first-link" }), {
		state: "unavailable",
	});
	await assert.rejects(
		() => invoke(sharing.accept, db, { token: "first-link" }),
		/invalid/,
	);
});

test("resending replaces the link, resets seven days, and ignores old workers", async (t) => {
	let now = Date.now();
	t.mock.method(Date, "now", () => now);
	emailSetup(t);
	const { db } = await fixture();
	const invitation = await queue(db);
	const firstHash = await hash("first-link");
	now += 86400000;
	await invoke(sharing.resend, db, { id: invitation });
	const stored = await db.get(invitation);
	assert.equal(stored?.expiresAt, now + 7 * 86400000);
	assert.notEqual(stored?.tokenHash, firstHash);
	assert.equal(stored?.delivery, "queued");
	await invoke(sharing.markDelivery, db, {
		id: invitation,
		tokenHash: firstHash,
		status: "failed",
	});
	assert.equal((await db.get(invitation))?.delivery, "queued");
	const fetch = t.mock.method(globalThis, "fetch", async () => {
		throw new Error("A stale job must not send.");
	});
	await invoke(sharing.send, db, { id: invitation, token: "first-link" });
	assert.equal(fetch.mock.callCount(), 0);
	db.current = "bob";
	assert.deepEqual(await invoke(sharing.preview, db, { token: "first-link" }), {
		state: "unavailable",
	});
});

test("invites expire at seven days and expired invitations can be resent or replaced", async (t) => {
	let now = Date.now();
	t.mock.method(Date, "now", () => now);
	const { db } = await fixture();
	const invitation = await queue(db);
	now += 7 * 86400000;
	db.current = "bob";
	assert.deepEqual(await invoke(sharing.preview, db, { token: "first-link" }), {
		state: "unavailable",
	});
	await assert.rejects(
		() => invoke(sharing.accept, db, { token: "first-link" }),
		/expired/,
	);
	db.current = "alice";
	await invoke(sharing.storeInvite, db, {
		id: invitation,
		token: "fresh-link",
		tokenHash: await hash("fresh-link"),
	});
	assert.equal((await db.get(invitation))?.expiresAt, now + 7 * 86400000);
	now += 7 * 86400000;
	await queue(db, "charlie@example.com", "replacement");
	assert.equal((await db.get(invitation))?.status, "revoked");
	assert.equal(
		(await invoke(sharing.outgoing, db, {}))?.email,
		"charlie@example.com",
	);
});

test("accepting an incoming invite cancels the recipient's outgoing invite", async () => {
	const { db } = await fixture();
	await queue(db);
	await bobSetup(db);
	const outgoing = await queue(db, "charlie@example.com", "bob-to-charlie");
	await invoke(sharing.accept, db, { token: "first-link" });
	assert.equal((await db.get(outgoing))?.status, "revoked");
	assert.equal(await invoke(sharing.outgoing, db, {}), null);
	db.current = "charlie";
	await assert.rejects(
		() => invoke(sharing.accept, db, { token: "bob-to-charlie" }),
		/invalid/,
	);
});

test("existing memberships block sending and acceptance without leaving or deleting a budget", async () => {
	const { db } = await fixture();
	await queue(db);
	const existing = await sharedBudget(db);
	await assert.rejects(
		() => queue(db, "charlie@example.com"),
		/already have a shared budget/,
	);
	await bobSetup(db);
	await assert.rejects(
		() => invoke(sharing.accept, db, { token: "first-link" }),
		/no longer available/,
	);
	assert.equal(shared(db).length, 1);
	assert.ok(await db.get(existing));

	const other = await fixture();
	await queue(other.db);
	await bobSetup(other.db);
	const recipientBudget = await sharedBudget(other.db);
	assert.deepEqual(
		await invoke(sharing.preview, other.db, { token: "first-link" }),
		{ state: "blocked" },
	);
	await assert.rejects(
		() => invoke(sharing.accept, other.db, { token: "first-link" }),
		/Leaving deletes/,
	);
	assert.ok(await other.db.get(recipientBudget));
});

test("competing invitations cannot create a second shared budget after the first acceptance", async () => {
	const { db } = await fixture();
	await queue(db);
	db.current = "charlie";
	await invoke(budgets.setup, db, { name: "Charlie", timeZone: "UTC" });
	await queue(db, "bob@example.com", "charlie-to-bob");
	await bobSetup(db);
	await invoke(sharing.accept, db, { token: "first-link" });
	await assert.rejects(
		() => invoke(sharing.accept, db, { token: "charlie-to-bob" }),
		/existing shared budget/,
	);
	assert.equal(shared(db).length, 1);
});

test("failed acceptance rolls back budget creation and both memberships", async (t) => {
	const { db } = await fixture();
	await queue(db);
	await bobSetup(db);
	const before = structuredClone(db.rows);
	const insert = db.insert.bind(db);
	t.mock.method(
		db,
		"insert",
		async (table: string, value: Record<string, unknown>) => {
			if (table === "categories") throw new Error("simulated failure");
			return insert(table, value);
		},
	);
	await assert.rejects(
		() => invoke(sharing.accept, db, { token: "first-link" }),
		/simulated/,
	);
	assert.deepEqual(db.rows, before);
});

test("Resend receives the correct invitation link and records accepted email submission", async (t) => {
	emailSetup(t);
	const { db } = await fixture();
	const invitation = await queue(db);
	const fetch = t.mock.method(
		globalThis,
		"fetch",
		async (url: string, init: RequestInit) => {
			assert.equal(url, "https://api.resend.com/emails");
			assert.equal(init.method, "POST");
			const body = JSON.parse(String(init.body));
			assert.equal(body.from, "budget-together@example.test");
			assert.deepEqual(body.to, ["bob@example.com"]);
			assert.match(body.subject, /Alice/);
			assert.match(
				body.text,
				/https:\/\/budget.example.test\/\?invite=first-link/,
			);
			assert.match(body.text, /7 days/);
			assert.match(body.html, /Review invitation<\/a>/);
			assert.match(
				body.html,
				/href="https:\/\/budget.example.test\/\?invite=first-link"/,
			);
			assert.match(body.text, /bob@example.com/);
			assert.ok(
				String(
					(init.headers as Record<string, string>)["Idempotency-Key"],
				).startsWith(`invite-${invitation}-`),
			);
			return new Response(JSON.stringify({ id: "resend-fixture" }));
		},
	);
	await invoke(sharing.send, db, { id: invitation, token: "first-link" });
	assert.equal(fetch.mock.callCount(), 1);
	assert.equal((await db.get(invitation))?.delivery, "sent");
	assert.equal(shared(db).length, 0);
});

test("Resend failures leave a retryable invite and cancelled jobs send no email", async (t) => {
	emailSetup(t);
	const { db } = await fixture();
	const invitation = await queue(db);
	const fetch = t.mock.method(
		globalThis,
		"fetch",
		async () => new Response("unavailable", { status: 503 }),
	);
	await invoke(sharing.send, db, { id: invitation, token: "first-link" });
	assert.equal((await db.get(invitation))?.delivery, "failed");
	await invoke(sharing.revoke, db, { id: invitation });
	await invoke(sharing.send, db, { id: invitation, token: "first-link" });
	assert.equal(fetch.mock.callCount(), 1);
});

test("self-invites and missing email configuration do not create invitations", async (t) => {
	emailSetup(t);
	const { db } = await fixture();
	await assert.rejects(() => queue(db, "ALICE@example.com"), /partner’s email/);
	delete process.env.RESEND_API_KEY;
	await assert.rejects(
		() => invoke(sharing.invite, db, { email: "bob@example.com" }),
		/not configured/,
	);
	assert.equal(await invoke(sharing.outgoing, db, {}), null);
	assert.equal(db.scheduled.length, 0);
	assert.equal(shared(db).length, 0);
});
