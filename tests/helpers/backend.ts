import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
	RegisteredAction,
	RegisteredMutation,
	RegisteredQuery,
} from "convex/server";
import { getFunctionName } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import { authComponent } from "../../convex/auth.ts";
import * as bank from "../../convex/bank.ts";
import * as budgets from "../../convex/budgets.ts";

type Reference<T> =
	T extends RegisteredQuery<infer V, infer A, infer R>
		? FunctionReference<"query", V, A, Awaited<R>>
		: T extends RegisteredMutation<infer V, infer A, infer R>
			? FunctionReference<"mutation", V, A, Awaited<R>>
			: T extends RegisteredAction<infer V, infer A, infer R>
				? FunctionReference<"action", V, A, Awaited<R>>
				: never;
type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Predicate = (row: Row) => boolean;
export class Memory {
	rows = new Map<string, Row>();
	sequence = 0;
	reads: { table: string; method: string; rows: number }[] = [];
	forbidCollect = new Set<string>();
	scheduled: { name: string; args: Record<string, unknown>; delay: number }[] =
		[];
	current = "alice";
	async insert(table: string, value: Record<string, unknown>) {
		const id = `${table}:${++this.sequence}`;
		this.rows.set(id, {
			...value,
			_id: id,
			_creationTime: Date.now() - 100000 + this.sequence,
		});
		return id;
	}
	async get(id: string) {
		return this.rows.get(id) ?? null;
	}
	async patch(id: string, value: Record<string, unknown>) {
		const row = this.rows.get(id);
		if (!row) throw new Error("Missing row");
		this.rows.set(id, { ...row, ...value });
	}
	async delete(id: string) {
		this.rows.delete(id);
	}
	query(table: string) {
		const predicates: Predicate[] = [];
		let descending = false;
		const all = () =>
			[...this.rows.values()]
				.filter(
					(x) => x._id.startsWith(`${table}:`) && predicates.every((p) => p(x)),
				)
				.sort((a, b) => {
					const key =
						table === "transactions"
							? "date"
							: table === "plans"
								? "month"
								: "_creationTime";
					return (
						(String(a[key]).localeCompare(String(b[key])) ||
							a._creationTime - b._creationTime ||
							a._id.localeCompare(b._id)) * (descending ? -1 : 1)
					);
				});
		const range = {
			eq: (field: string, value: unknown) => {
				predicates.push((row) => row[field] === value);
				return range;
			},
			gte: (field: string, value: string) => {
				predicates.push((row) => String(row[field]) >= value);
				return range;
			},
			lt: (field: string, value: string) => {
				predicates.push((row) => String(row[field]) < value);
				return range;
			},
		};
		const field = (name: string) => (row: Row) => row[name];
		const value = (item: unknown, row: Row) =>
			typeof item === "function" ? (item as (row: Row) => unknown)(row) : item;
		const read = (method: string, rows: Row[]) => {
			if (method === "collect" && this.forbidCollect.has(table))
				throw new Error(`Unbounded collect: ${table}`);
			this.reads.push({ table, method, rows: rows.length });
			return rows;
		};
		const query = {
			withIndex: (_index: string, fn: (q: typeof range) => unknown) => {
				fn(range);
				return query;
			},
			filter: (
				fn: (q: {
					field: typeof field;
					eq: (a: unknown, b: unknown) => Predicate;
					lte: (a: unknown, b: unknown) => Predicate;
				}) => Predicate,
			) => {
				predicates.push(
					fn({
						field,
						eq: (a, b) => (row) => value(a, row) === value(b, row),
						lte: (a, b) => (row) =>
							Number(value(a, row)) <= Number(value(b, row)),
					}),
				);
				return query;
			},
			order: (direction: string) => {
				descending = direction === "desc";
				return query;
			},
			collect: async () => read("collect", all()),
			first: async () => read("first", all().slice(0, 1))[0] ?? null,
			take: async (count: number) => read("take", all().slice(0, count)),
			paginate: async (opts: {
				cursor: string | null;
				numItems: number;
				maximumRowsRead?: number;
				maximumBytesRead?: number;
			}) => {
				// Model an index-position cursor, including same-date ties. The cursor
				// survives deletion of its anchor; it is deliberately not a row offset.
				const anchor: [string, number, string] | null = opts.cursor
					? JSON.parse(opts.cursor)
					: null;
				const rows = all().filter(
					(row) =>
						!anchor ||
						(String(row.date).localeCompare(anchor[0]) ||
							row._creationTime - anchor[1] ||
							row._id.localeCompare(anchor[2])) *
							(descending ? -1 : 1) >
							0,
				);
				const page: Row[] = [];
				let bytes = 0;
				for (const row of rows.slice(
					0,
					Math.min(opts.numItems, opts.maximumRowsRead ?? Infinity),
				)) {
					bytes += new TextEncoder().encode(JSON.stringify(row)).byteLength;
					page.push(row);
					if (bytes >= (opts.maximumBytesRead ?? Infinity)) break;
				}
				read("paginate", page);
				const last = page.at(-1);
				return {
					page,
					isDone: page.length === rows.length,
					continueCursor: last
						? JSON.stringify([last.date, last._creationTime, last._id])
						: (opts.cursor ?? ""),
				};
			},
			unique: async () => {
				const rows = read("unique", all().slice(0, 2));
				if (rows.length > 1) throw new Error("Not unique");
				return rows[0] ?? null;
			},
		};
		return query;
	}
}
let actor = "alice";
Object.defineProperty(authComponent, "getAuthUser", {
	value: async () => ({
		_id: actor,
		email: `${actor}@example.com`,
		name: actor,
	}),
});
export async function invoke<T>(
	fn: T,
	db: Memory,
	args: FunctionArgs<Reference<T>>,
): Promise<FunctionReturnType<Reference<T>>> {
	actor = db.current;
	const backup = structuredClone(db.rows);
	const scheduledBackup = [...db.scheduled];
	const call = async (
		reference: FunctionReference<"query" | "mutation" | "action">,
		args: Record<string, unknown>,
	) => {
		const [module, name] = getFunctionName(reference).split(":");
		if (module !== "bank")
			throw new Error(`Unsupported harness function: ${module}:${name}`);
		// biome-ignore lint/performance/noDynamicNamespaceImportAccess: Test-only function dispatcher.
		return invoke(bank[name as keyof typeof bank], db, args as never);
	};
	try {
		return await (
			fn as unknown as {
				_handler: (
					ctx: unknown,
					args: unknown,
				) => Promise<FunctionReturnType<Reference<T>>>;
			}
		)._handler(
			{
				db,
				runQuery: call,
				runMutation: call,
				runAction: call,
				scheduler: {
					runAfter: async (
						delay: number,
						reference: FunctionReference<"action">,
						args: Record<string, unknown>,
					) => {
						db.scheduled.push({
							name: getFunctionName(reference),
							args,
							delay,
						});
						return null;
					},
				},
			},
			args,
		);
	} catch (error) {
		if (!(fn as { isAction?: boolean }).isAction) {
			db.rows = backup;
			db.scheduled = scheduledBackup;
		}
		throw error;
	}
}
export const id = <
	T extends
		| "spaces"
		| "accounts"
		| "categories"
		| "transactions"
		| "connections"
		| "plans"
		| "contributions"
		| "bankSyncRuns",
>(
	value: string,
) => value as Id<T>;
export async function connectedAccount(
	db: Memory,
	spaceId: Id<"spaces">,
	name = "Checking",
) {
	const connectionId = await db.insert("connections", {
		userId: db.current,
		itemId: `fixture-item-${db.sequence}`,
		accessToken: "encrypted",
		institution: "Fixture Bank",
		institutionId: "fixture-bank",
		status: "connected",
	});
	return id<"accounts">(
		await db.insert("accounts", {
			userId: db.current,
			spaceId,
			connectionId,
			externalId: `fixture-account-${db.sequence}`,
			name,
			type: "checking",
			mask: "0000",
			active: true,
			revision: 0,
		}),
	);
}
export async function fixture() {
	const db = new Memory();
	await invoke(budgets.setup, db, { name: "Alice", timeZone: "America/Boise" });
	const privateId = id<"spaces">(
		[...db.rows.values()].find((x) => x.type === "private")!._id,
	);
	const categoryId = id<"categories">(
		[...db.rows.values()].find((x) => x.name === "Groceries")!._id,
	);
	const accountId = await connectedAccount(db, privateId);
	return { db, privateId, categoryId, accountId };
}
export async function entry(
	db: Memory,
	spaceId: Id<"spaces">,
	accountId: Id<"accounts">,
	amount: number,
	kind: "income" | "purchase" | "transfer",
	categoryId?: Id<"categories">,
	date = "2026-09-10",
) {
	return db.insert("transactions", {
		spaceId,
		accountId,
		amount,
		kind,
		date,
		source: "manual",
		description: "Entry",
		pending: false,
		splits: categoryId ? [{ categoryId, amount }] : [],
		removed: false,
		note: "",
		revision: 0,
		edited: false,
	}) as Promise<Id<"transactions">>;
}

// Execute immediate durable continuations. Delayed watchdogs stay queued so tests
// can explicitly simulate a lost action or an old watchdog arriving late.
export async function drainSync(db: Memory, maxSteps = 1000) {
	for (let step = 0; step < maxSteps; step++) {
		const index = db.scheduled.findIndex((x) => x.delay === 0);
		if (index < 0) return;
		const [job] = db.scheduled.splice(index, 1);
		if (!job.name.startsWith("bank:"))
			throw new Error(`Unsupported job: ${job.name}`);
		await invoke(
			// biome-ignore lint/performance/noDynamicNamespaceImportAccess: Test-only scheduled function dispatcher.
			bank[job.name.slice(5) as keyof typeof bank],
			db,
			job.args as never,
		);
	}
	throw new Error("Sync did not finish within the harness step limit");
}
