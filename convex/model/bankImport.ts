import { money } from "../../src/domain/budget";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { PlaidTransaction } from "../plaidClient";

async function ignored(
	ctx: MutationCtx,
	accountId: Id<"accounts">,
	externalId: string,
) {
	return ctx.db
		.query("ignoredBankTransactions")
		.withIndex("by_external", (q) =>
			q.eq("accountId", accountId).eq("externalId", externalId),
		)
		.unique();
}

/** Keep only import identifiers, never the deleted budget or transaction content. */
export async function forgetImport(
	ctx: MutationCtx,
	row: Pick<
		Doc<"transactions">,
		"accountId" | "externalId" | "pendingExternalId"
	>,
) {
	for (const externalId of new Set([row.externalId, row.pendingExternalId]))
		if (externalId && !(await ignored(ctx, row.accountId, externalId)))
			await ctx.db.insert("ignoredBankTransactions", {
				accountId: row.accountId,
				externalId,
			});
}

// Callers bound each batch and check the connection/run before any writes.
export async function applyChanges(
	ctx: MutationCtx,
	connectionId: Id<"connections">,
	changed: PlaidTransaction[],
) {
	for (const x of changed) {
		const account = await ctx.db
			.query("accounts")
			.withIndex("by_external", (q) =>
				q.eq("connectionId", connectionId).eq("externalId", x.account_id),
			)
			.unique();
		if (!account) continue;
		const identifiers = {
			accountId: account._id,
			externalId: x.transaction_id,
			pendingExternalId: x.pending_transaction_id ?? undefined,
		};
		if (
			(await ignored(ctx, account._id, x.transaction_id)) ||
			(x.pending_transaction_id &&
				(await ignored(ctx, account._id, x.pending_transaction_id)))
		) {
			// A posted replacement may later be replayed without its pending ID.
			await forgetImport(ctx, identifiers);
			continue;
		}
		const amount = money(Math.round(x.amount * 100));
		const old = await ctx.db
			.query("transactions")
			.withIndex("by_external", (q) =>
				q.eq("accountId", account._id).eq("externalId", x.transaction_id),
			)
			.unique();
		const pendingId = x.pending_transaction_id;
		const pending = pendingId
			? await ctx.db
					.query("transactions")
					.withIndex("by_external", (q) =>
						q.eq("accountId", account._id).eq("externalId", pendingId),
					)
					.unique()
			: null;
		// A replay of an earlier pending page must not recreate an entry that posted.
		if (
			x.pending &&
			(await ctx.db
				.query("transactions")
				.withIndex("by_pending_external", (q) =>
					q
						.eq("accountId", account._id)
						.eq("pendingExternalId", x.transaction_id),
				)
				.first())
		)
			continue;
		const prior = old?.edited
			? old
			: pending?.edited
				? pending
				: (old ?? pending);
		// Import first; Jev classifies in a separate durable job. Until it answers,
		// new entries are uncategorized purchases and updates retain their last type.
		const kind = prior?.kind ?? "purchase";
		const historicalAssignment = account.assignments
			?.filter((a) => a.startsOn <= x.date)
			.at(-1);
		if (!old && !pending && historicalAssignment?.spaceId === null) {
			await forgetImport(ctx, identifiers);
			continue;
		}
		const spaceId =
			old?.spaceId ??
			pending?.spaceId ??
			historicalAssignment?.spaceId ??
			account.spaceId;
		// Deletion can finish while bank sync has a page waiting to be applied.
		if (!(await ctx.db.get(spaceId))) {
			await forgetImport(ctx, identifiers);
			continue;
		}
		const splits =
			kind !== "purchase"
				? []
				: prior?.splits.length
					? resizeSplits(prior.splits, amount)
					: [];
		const needsClassification =
			!prior?.edited &&
			(!prior?.classificationStatus ||
				prior.removed ||
				prior.bankDescription !== x.name ||
				prior.bankMerchant !== (x.merchant_name ?? undefined) ||
				prior.amount !== amount ||
				prior.date !== x.date ||
				prior.pending !== x.pending);
		const value = {
			accountId: account._id,
			spaceId,
			externalId: x.transaction_id,
			pendingExternalId: x.pending_transaction_id ?? old?.pendingExternalId,
			source: "plaid" as const,
			description: prior?.edited
				? prior.description
				: (x.merchant_name ?? x.name),
			amount,
			date: x.date,
			pending: x.pending,
			kind,
			bankDescription: x.name,
			bankMerchant: x.merchant_name ?? undefined,
			...(needsClassification
				? {
						classificationStatus: "pending" as const,
						classificationAttempts: 0,
						classificationRetryAt: 0,
						classificationError: undefined,
						suggestedKind: undefined,
					}
				: {}),
			note: prior?.note ?? "",
			splits,
			funded: splits.some((split) => Boolean(split.fundId)),
			removed: false,
			revision: Math.max(old?.revision ?? 0, pending?.revision ?? 0) + 1,
			edited: prior?.edited ?? false,
		};
		let transactionId = old?._id ?? pending?._id;
		if (old) {
			// Retries of a committed batch do not change revisions.
			const same = Object.entries(value).every(
				([key, v]) =>
					key === "revision" ||
					JSON.stringify(old[key as keyof typeof old]) === JSON.stringify(v),
			);
			if (!same) await ctx.db.patch(old._id, value);
			if (pending && pending._id !== old._id && !pending.removed)
				await ctx.db.patch(pending._id, {
					removed: true,
					revision: pending.revision + 1,
				});
		} else if (pending) await ctx.db.patch(pending._id, value);
		else transactionId = await ctx.db.insert("transactions", value);
		if (needsClassification && transactionId)
			await ctx.scheduler.runAfter(0, internal.classification.classify, {
				id: transactionId,
			});
	}
}

export async function applyRemovals(
	ctx: MutationCtx,
	connectionId: Id<"connections">,
	removed: { account_id: string; transaction_id: string }[],
) {
	for (const x of removed) {
		const account = await ctx.db
			.query("accounts")
			.withIndex("by_external", (q) =>
				q.eq("connectionId", connectionId).eq("externalId", x.account_id),
			)
			.unique();
		if (!account) continue;
		const row = await ctx.db
			.query("transactions")
			.withIndex("by_external", (q) =>
				q.eq("accountId", account._id).eq("externalId", x.transaction_id),
			)
			.unique();
		if (row && !row.removed)
			await ctx.db.patch(row._id, {
				removed: true,
				revision: row.revision + 1,
			});
	}
}

// Preserve the user's category proportions when the bank changes the amount.
// Integer division keeps cents exact; the final category receives the remainder.
function resizeSplits(splits: Doc<"transactions">["splits"], amount: number) {
	const total = splits.reduce((sum, s) => sum + s.amount, 0);
	let allocated = 0;
	return splits.map((s, i) => {
		const value =
			i === splits.length - 1
				? amount - allocated
				: total === 0
					? 0
					: Number((BigInt(s.amount) * BigInt(amount)) / BigInt(total));
		allocated += value;
		return { ...s, amount: value };
	});
}
