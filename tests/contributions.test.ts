import assert from "node:assert/strict";
import test from "node:test";
import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
	RegisteredMutation,
	RegisteredQuery,
} from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { authComponent } from "../convex/auth.ts";
import * as contributions from "../convex/contributions.ts";

type Reference<T> =
	T extends RegisteredQuery<infer V, infer A, infer R>
		? FunctionReference<"query", V, A, Awaited<R>>
		: T extends RegisteredMutation<infer V, infer A, infer R>
			? FunctionReference<"mutation", V, A, Awaited<R>>
			: never;
type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Predicate = (row: Row) => boolean;

// Only the database operations used by contributions and its access checks.
class Memory {
	rows = new Map<string, Row>();
	async insert(table: string, fields: Record<string, unknown>) {
		const id = `${table}:${this.rows.size + 1}`;
		this.rows.set(id, { _id: id, _creationTime: 1, ...fields });
		return id;
	}
	async get(id: string) {
		return this.rows.get(id) ?? null;
	}
	async patch(id: string, fields: Record<string, unknown>) {
		const row = this.rows.get(id);
		if (!row) throw new Error("Missing row");
		this.rows.set(id, { ...row, ...fields });
	}
	query(table: string) {
		const predicates: Predicate[] = [];
		const all = () =>
			[...this.rows.values()].filter(
				(row) =>
					row._id.startsWith(`${table}:`) && predicates.every((p) => p(row)),
			);
		const range = {
			eq: (field: string, value: unknown) => {
				predicates.push((row) => row[field] === value);
				return range;
			},
		};
		const query = {
			withIndex: (_name: string, fn: (q: typeof range) => unknown) => {
				fn(range);
				return query;
			},
			filter: (
				fn: (q: {
					field: (name: string) => (row: Row) => unknown;
					eq: (field: (row: Row) => unknown, value: unknown) => Predicate;
				}) => Predicate,
			) => {
				predicates.push(
					fn({
						field: (name) => (row) => row[name],
						eq: (field, value) => (row) => field(row) === value,
					}),
				);
				return query;
			},
			collect: async () => all(),
			first: async () => all()[0] ?? null,
			unique: async () => {
				assert.ok(all().length <= 1);
				return all()[0] ?? null;
			},
		};
		return query;
	}
}

Object.defineProperty(authComponent, "getAuthUser", {
	value: async () => ({ _id: "alice" }),
});
async function invoke<T>(
	fn: T,
	db: Memory,
	args: FunctionArgs<Reference<T>>,
): Promise<FunctionReturnType<Reference<T>>> {
	return (
		fn as unknown as {
			_handler: (
				ctx: unknown,
				args: unknown,
			) => Promise<FunctionReturnType<Reference<T>>>;
		}
	)._handler({ db }, args);
}
const privateId = "spaces:private" as Id<"spaces">;
const sharedId = "spaces:shared" as Id<"spaces">;
const joinedAt = Date.parse("2026-10-01T00:30:00Z"); // September in Boise.
const leftAt = Date.parse("2026-10-15T12:00:00Z");
async function fixture() {
	const db = new Memory();
	db.rows.set(privateId, {
		_id: privateId,
		_creationTime: 1,
		type: "private",
		ownerId: "alice",
		timeZone: "America/Boise",
	});
	db.rows.set(sharedId, {
		_id: sharedId,
		_creationTime: 1,
		type: "shared",
		timeZone: "America/Boise",
	});
	await db.insert("memberships", {
		spaceId: privateId,
		userId: "alice",
		active: true,
		joinedAt: 1,
	});
	const membershipId = await db.insert("memberships", {
		spaceId: sharedId,
		userId: "alice",
		active: true,
		joinedAt,
	});
	return { db, membershipId };
}
async function transferPair(db: Memory, month: string) {
	const fields = {
		date: `${month}-10`,
		pending: false,
		removed: false,
		kind: "transfer",
		splits: [],
		revision: 1,
	};
	const outId = (await db.insert("transactions", {
		...fields,
		spaceId: privateId,
		amount: 5000,
		description: "Private transfer",
	})) as Id<"transactions">;
	const inId = (await db.insert("transactions", {
		...fields,
		spaceId: sharedId,
		amount: -5000,
		description: "Shared deposit",
	})) as Id<"transactions">;
	return { outId, inId };
}
async function legacyRecord(db: Memory, month: string) {
	const pair = await transferPair(db, month);
	const id = (await db.insert("contributions", {
		privateId,
		sharedId,
		month,
		planned: 5000,
		revision: 2,
		pairs: [{ ...pair, amount: 5000 }],
	})) as Id<"contributions">;
	return { id, ...pair };
}

test("historical months expose valid edits, preserve revision checks, and can confirm and remove bank matches", async () => {
	const { db } = await fixture();
	const month = "2026-08";
	const pair = await transferPair(db, month);
	const args = { privateId, sharedId, month };
	const before = await invoke(contributions.list, db, args);
	assert.equal(before.canEdit, true);
	assert.deepEqual(
		before.suggestions.map(({ outId, inId }) => ({ outId, inId })),
		[pair],
	);
	await invoke(contributions.savePlanned, db, {
		...args,
		planned: 5000,
		revision: 0,
	});
	await invoke(contributions.confirm, db, { privateId, sharedId, ...pair });
	const after = await invoke(contributions.list, db, args);
	assert.equal(after.contribution?.planned, 5000);
	assert.equal(after.contribution?.pairs.length, 1);
	assert.equal(after.suggestions.length, 0);
	const contribution = after.contribution;
	assert.ok(contribution);
	await assert.rejects(
		() =>
			invoke(contributions.savePlanned, db, {
				...args,
				planned: 1000,
				revision: 1,
			}),
		/changed/,
	);
	await assert.rejects(
		() =>
			invoke(contributions.unmatch, db, {
				id: contribution._id,
				outId: pair.outId,
				revision: 1,
			}),
		/changed/,
	);
	await invoke(contributions.unmatch, db, {
		id: contribution._id,
		outId: pair.outId,
		revision: 2,
	});
	assert.equal(
		(await invoke(contributions.list, db, args)).contribution?.pairs.length,
		0,
	);
	assert.equal((await db.get(pair.inId))?.kind, "transfer");
});

test("the server uses the shared time zone for the join month and keeps shared-funded legacy records read-only", async () => {
	const { db } = await fixture();
	for (const month of ["2026-09", "2026-10", "2027-01"]) {
		const legacy = await legacyRecord(db, month);
		const extraPair = await transferPair(db, month);
		const args = { privateId, sharedId, month };
		const data = await invoke(contributions.list, db, args);
		assert.equal(data.canEdit, false);
		assert.equal(data.contribution?.planned, 5000);
		assert.equal(data.contribution?.pairs.length, 1);
		assert.deepEqual(data.suggestions, []);
		const before = structuredClone(db.rows);
		await assert.rejects(
			() =>
				invoke(contributions.savePlanned, db, {
					...args,
					planned: 1000,
					revision: 2,
				}),
			/shared monthly budget/,
		);
		await assert.rejects(
			() =>
				invoke(contributions.confirm, db, {
					privateId,
					sharedId,
					...extraPair,
				}),
			/budget allocation/,
		);
		await assert.rejects(
			() =>
				invoke(contributions.unmatch, db, {
					id: legacy.id,
					outId: legacy.outId,
					revision: 2,
				}),
			/read-only/,
		);
		assert.deepEqual(db.rows, before);
	}
	const empty = await invoke(contributions.list, db, {
		privateId,
		sharedId,
		month: "2027-02",
	});
	assert.equal(empty.canEdit, false);
	assert.equal(empty.contribution, null);
	assert.deepEqual(empty.suggestions, []);
});

test("former members can read earlier contributions but cannot edit or see records added after departure", async () => {
	const { db, membershipId } = await fixture();
	const month = "2026-08";
	const legacy = await legacyRecord(db, month);
	const newPair = await transferPair(db, month);
	await db.patch(newPair.inId, { _creationTime: leftAt + 1 });
	await db.patch(legacy.id, {
		pairs: [
			{ outId: legacy.outId, inId: legacy.inId, amount: 5000 },
			{ ...newPair, amount: 5000 },
		],
	});
	await db.patch(membershipId, { active: false, leftAt });
	const data = await invoke(contributions.list, db, {
		privateId,
		sharedId,
		month,
	});
	assert.equal(data.canEdit, false);
	assert.equal(data.contribution?.planned, 5000);
	assert.deepEqual(data.contribution?.pairs, [
		{ outId: legacy.outId, inId: legacy.inId, amount: 5000 },
	]);
	assert.deepEqual(data.suggestions, []);
	await assert.rejects(
		() =>
			invoke(contributions.savePlanned, db, {
				privateId,
				sharedId,
				month,
				planned: 1000,
				revision: 2,
			}),
		/access/,
	);
	await assert.rejects(
		() =>
			invoke(contributions.confirm, db, { privateId, sharedId, ...newPair }),
		/access/,
	);
	await assert.rejects(
		() =>
			invoke(contributions.unmatch, db, {
				id: legacy.id,
				outId: legacy.outId,
				revision: 2,
			}),
		/access/,
	);
	const later = await legacyRecord(db, "2026-11");
	await db.patch(later.id, { _creationTime: leftAt + 1 });
	const hidden = await invoke(contributions.list, db, {
		privateId,
		sharedId,
		month: "2026-11",
	});
	assert.equal(hidden.contribution, null);
	assert.equal(hidden.canEdit, false);
	assert.deepEqual(hidden.suggestions, []);
});

test("contribution history still requires membership in both budgets", async () => {
	const { db, membershipId } = await fixture();
	await legacyRecord(db, "2026-08");
	await db.patch(membershipId, { userId: "bob" });
	await assert.rejects(
		() =>
			invoke(contributions.list, db, { privateId, sharedId, month: "2026-08" }),
		/access/,
	);
});
