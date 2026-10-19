// Minimal database adapter, based on the existing backend test harness.
// Product handlers own validation, access, accounting, and revision checks.
type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Predicate = (row: Row) => boolean;
export class Memory {
	rows = new Map<string, Row>();
	sequence = 0;
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
						String(a[key]).localeCompare(String(b[key])) * (descending ? -1 : 1)
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
			collect: async () => all(),
			first: async () => all()[0] ?? null,
			unique: async () => {
				const rows = all();
				if (rows.length > 1) throw new Error("Not unique");
				return rows[0] ?? null;
			},
		};
		return query;
	}
}
