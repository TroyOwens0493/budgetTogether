import { ConvexError } from "convex/values";
import {
	assertRevision,
	money,
	month,
	nextMonth,
	validateSplits,
} from "../../src/domain/budget";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { access, label, readCutoff } from "../access";
import { validatePayments } from "./funds";

export async function list(
	ctx: QueryCtx,
	args: {
		spaceId: Id<"spaces">;
		month: string;
		search?: string;
		categoryId?: Id<"categories">;
		accountId?: Id<"accounts">;
		cursor?: string;
		limit?: number;
	},
) {
	const cutoff = await readCutoff(ctx, args.spaceId);
	month(args.month);
	const size = Math.max(1, Math.min(100, Math.floor(args.limit ?? 30)));
	const result = await ctx.db
		.query("transactions")
		.withIndex("by_space_date", (q) =>
			q
				.eq("spaceId", args.spaceId)
				.gte("date", `${args.month}-01`)
				.lt("date", `${nextMonth(args.month)}-01`),
		)
		.order("desc")
		.paginate({
			cursor: args.cursor ?? null,
			numItems: size,
			maximumRowsRead: size,
			maximumBytesRead: 512_000,
		});
	// Filter only this bounded index block. Sparse matches can produce empty pages.
	const matches = result.page.filter(
		(x) =>
			x._creationTime <= cutoff &&
			!x.removed &&
			(!args.search ||
				`${x.description} ${x.note}`
					.toLowerCase()
					.includes(args.search.toLowerCase())) &&
			(!args.categoryId ||
				x.splits.some((s) => s.categoryId === args.categoryId)) &&
			(!args.accountId || x.accountId === args.accountId),
	);
	return {
		rows: matches,
		next: result.isDone ? null : result.continueCursor,
	};
}

export async function save(
	ctx: MutationCtx,
	args: {
		spaceId: Id<"spaces">;
		id?: Id<"transactions">;
		accountId: Id<"accounts">;
		description: string;
		amount: number;
		date: string;
		kind: Doc<"transactions">["kind"];
		pending: boolean;
		note: string;
		splits: Doc<"transactions">["splits"];
		revision: number;
	},
) {
	await access(ctx, args.spaceId, true);
	const account = await ctx.db.get(args.accountId);
	const old = args.id ? await ctx.db.get(args.id) : null;
	if (
		!account ||
		(!old && (!account.active || account.spaceId !== args.spaceId)) ||
		(old && (old.spaceId !== args.spaceId || old.accountId !== args.accountId))
	)
		throw new ConvexError("Choose an account in this budget.");
	if (args.id && !old) throw new ConvexError("Transaction not found.");
	const pending = old?.source === "plaid" && args.pending;
	assertRevision(old?.revision ?? 0, args.revision);
	money(args.amount);
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(args.date) ||
		!Number.isFinite(Date.parse(args.date)) ||
		new Date(`${args.date}T12:00:00Z`).toISOString().slice(0, 10) !== args.date
	)
		throw new ConvexError("Enter a valid date.");
	if (args.kind === "purchase") {
		validateSplits(args.amount, args.splits);
		await validatePayments(ctx, args.spaceId, args.date, args.splits);
		for (const s of args.splits)
			if ((await ctx.db.get(s.categoryId))?.spaceId !== args.spaceId)
				throw new ConvexError("Choose categories from this budget.");
	} else if (args.splits.length)
		throw new ConvexError("Only purchases and refunds use category splits.");
	// Contributions use transfers, with exclusion governed by a separate confirmed pair.

	if (args.note.length > 2000)
		throw new ConvexError("Notes can contain at most 2000 characters.");
	if (
		old?.source === "plaid" &&
		(old.amount !== args.amount ||
			old.date !== args.date ||
			old.pending !== args.pending)
	)
		throw new ConvexError(
			"Imported amount, date, and pending status are set by the bank.",
		);
	const linked = await linkedContribution(ctx, old?._id);
	if (
		linked &&
		(args.kind !== "transfer" ||
			old?.amount !== args.amount ||
			old?.date !== args.date ||
			old?.pending !== pending)
	)
		throw new ConvexError(
			"Remove the contribution match before changing its classification.",
		);
	const value = {
		spaceId: args.spaceId,
		accountId: args.accountId,
		description: label(args.description, 200),
		amount: args.amount,
		date: args.date,
		kind: args.kind,
		pending,
		note: args.note,
		splits: args.splits,
		funded: args.splits.some((split) => Boolean(split.fundId)),
		revision: (old?.revision ?? 0) + 1,
		edited: true,
	};
	if (old) await ctx.db.patch(old._id, value);
	else
		await ctx.db.insert("transactions", {
			...value,
			source: "manual",
			removed: false,
		});
}

export async function remove(
	ctx: MutationCtx,
	args: { id: Id<"transactions">; revision: number },
) {
	const entry = await ctx.db.get(args.id);
	if (!entry) throw new ConvexError("Transaction not found.");
	await access(ctx, entry.spaceId, true);
	assertRevision(entry.revision, args.revision);
	if (entry.source !== "manual")
		throw new ConvexError("Only manual entries can be deleted.");
	if (await linkedContribution(ctx, args.id))
		throw new ConvexError("Remove the contribution match first.");
	await ctx.db.delete(args.id);
}

export async function reconcile(
	ctx: MutationCtx,
	args: {
		manualId: Id<"transactions">;
		importId: Id<"transactions">;
		revision: number;
	},
) {
	const manual = await ctx.db.get(args.manualId);
	const imported = await ctx.db.get(args.importId);
	if (
		!manual ||
		!imported ||
		manual.source !== "manual" ||
		imported.source !== "plaid" ||
		manual.spaceId !== imported.spaceId ||
		manual.accountId !== imported.accountId ||
		manual.amount !== imported.amount ||
		manual.removed ||
		imported.removed
	)
		throw new ConvexError(
			"Choose an imported entry in the same account with the same amount.",
		);
	await access(ctx, manual.spaceId, true);
	assertRevision(manual.revision, args.revision);
	await validatePayments(ctx, manual.spaceId, imported.date, manual.splits);
	if (
		(await linkedContribution(ctx, manual._id)) ||
		(await linkedContribution(ctx, imported._id))
	)
		throw new ConvexError("Remove contribution matches first.");
	await ctx.db.patch(imported._id, {
		kind: manual.kind,
		note: manual.note,
		splits: manual.splits,
		funded: manual.splits.some((split) => Boolean(split.fundId)),
		edited: true,
		revision: imported.revision + 1,
	});
	await ctx.db.patch(manual._id, {
		removed: true,
		reconciledWith: imported._id,
		revision: manual.revision + 1,
	});
}

async function linkedContribution(
	ctx: QueryCtx | MutationCtx,
	id: Id<"transactions"> | undefined,
) {
	if (!id) return null;
	const entry = await ctx.db.get(id);
	if (!entry) return null;
	const m = entry.date.slice(0, 7);
	const rows = [
		...(await ctx.db
			.query("contributions")
			.withIndex("by_private", (q) =>
				q.eq("privateId", entry.spaceId).eq("month", m),
			)
			.collect()),
		...(await ctx.db
			.query("contributions")
			.withIndex("by_shared", (q) =>
				q.eq("sharedId", entry.spaceId).eq("month", m),
			)
			.collect()),
	];
	return rows.find((x) => x.pairs.some((p) => p.outId === id || p.inId === id));
}
