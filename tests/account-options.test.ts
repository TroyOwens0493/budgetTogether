import assert from "node:assert/strict";
import test from "node:test";
import * as accounts from "../convex/accounts.ts";
import { entry, fixture, invoke, sharedBudget } from "./helpers/backend.ts";

test("account options save a name without changing the budget or assignment history", async () => {
	const { db, accountId, privateId } = await fixture();
	const before = await db.get(accountId);
	await invoke(accounts.saveOptions, db, {
		id: accountId,
		name: "Everyday",
		revision: 0,
	});
	const after = await db.get(accountId);
	assert.equal(after?.name, "Everyday");
	assert.equal(after?.spaceId, privateId);
	assert.deepEqual(after?.assignments, before?.assignments);
	assert.equal(after?.revision, 1);
});

test("account options save a rename and move together and preserve earlier transactions", async () => {
	const { db, accountId, privateId } = await fixture();
	const sharedId = await sharedBudget(db);
	const transactionId = await entry(db, privateId, accountId, 100, "transfer");
	await invoke(accounts.saveOptions, db, {
		id: accountId,
		name: "Together",
		destinationId: sharedId,
		revision: 0,
	});
	const after = await db.get(accountId);
	assert.equal(after?.name, "Together");
	assert.equal(after?.spaceId, sharedId);
	assert.equal(after?.revision, 1);
	assert.equal(
		(after?.assignments as { spaceId: string }[]).at(-1)?.spaceId,
		sharedId,
	);
	assert.equal((await db.get(transactionId))?.spaceId, privateId);
	await invoke(accounts.saveOptions, db, {
		id: accountId,
		name: "Together",
		destinationId: sharedId,
		revision: 1,
	});
	assert.deepEqual((await db.get(accountId))?.assignments, after?.assignments);
});

test("account options reject stale saves, invalid names and inaccessible destinations without partial changes", async () => {
	const { db, accountId } = await fixture();
	db.current = "bob";
	const inaccessible = await sharedBudget(db);
	db.current = "alice";
	const before = structuredClone(await db.get(accountId));
	for (const args of [
		{ name: "New name", revision: 7 },
		{ name: " ", revision: 0 },
		{ name: "New name", destinationId: inaccessible, revision: 0 },
	]) {
		await assert.rejects(
			invoke(accounts.saveOptions, db, { id: accountId, ...args }),
		);
		assert.deepEqual(await db.get(accountId), before);
	}
});

test("a partner can rename a shared account but cannot move an account they did not connect", async () => {
	const { db, accountId } = await fixture();
	const sharedId = await sharedBudget(db);
	await invoke(accounts.move, db, {
		id: accountId,
		destinationId: sharedId,
		revision: 0,
	});
	await db.insert("memberships", {
		spaceId: sharedId,
		userId: "bob",
		active: true,
		joinedAt: Date.now(),
	});
	db.current = "bob";
	await invoke(accounts.saveOptions, db, {
		id: accountId,
		name: "Partner name",
		revision: 1,
	});
	const before = structuredClone(await db.get(accountId));
	const destination = await sharedBudget(db);
	await assert.rejects(
		invoke(accounts.saveOptions, db, {
			id: accountId,
			name: "Do not save",
			destinationId: destination,
			revision: 2,
		}),
		/Only the connecting user/,
	);
	assert.deepEqual(await db.get(accountId), before);
});
