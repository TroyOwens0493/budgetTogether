import { money } from "../../src/domain/budget";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { PlaidTransaction } from "../plaidClient";

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
		const primary = x.personal_finance_category?.primary ?? "";
		const suggestedKind =
			primary.startsWith("TRANSFER") ||
			(x.personal_finance_category?.detailed ?? "").includes(
				"CREDIT_CARD_PAYMENT",
			)
				? ("transfer" as const)
				: primary === "INCOME"
					? ("income" as const)
					: ("purchase" as const);
		const kind = prior?.edited ? prior.kind : suggestedKind;
		const historicalAssignment = account.assignments
			?.filter((a) => a.startsOn <= x.date)
			.at(-1);
		const spaceId =
			old?.spaceId ??
			pending?.spaceId ??
			historicalAssignment?.spaceId ??
			account.spaceId;
		const detail = x.personal_finance_category?.detailed ?? "";
		const categoryName = detail.includes("GROCERIES")
			? "Groceries"
			: primary === "FOOD_AND_DRINK"
				? "Dining out"
				: detail.includes("RENT") || detail.includes("MORTGAGE")
					? "Housing"
					: primary === "TRANSPORTATION" || detail.includes("GAS")
						? "Transport"
						: primary === "ENTERTAINMENT"
							? "Entertainment"
							: "Other";
		const findCategory = (name: string) =>
			ctx.db
				.query("categories")
				.withIndex("by_space_name", (q) =>
					q.eq("spaceId", spaceId).eq("name", name),
				)
				.first();
		const category =
			kind === "purchase" && !prior?.edited
				? ((await findCategory(categoryName)) ??
					(await findCategory("Other")) ??
					(await ctx.db
						.query("categories")
						.withIndex("by_space", (q) => q.eq("spaceId", spaceId))
						.first()))
				: null;
		const splits =
			kind !== "purchase"
				? []
				: prior?.edited && prior.splits.length
					? resizeSplits(prior.splits, amount)
					: category
						? [{ categoryId: category._id, amount }]
						: [];
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
			suggestedKind,
			note: prior?.note ?? "",
			splits,
			funded: splits.some((split) => Boolean(split.fundId)),
			removed: false,
			revision: Math.max(old?.revision ?? 0, pending?.revision ?? 0) + 1,
			edited: prior?.edited ?? false,
		};
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
		else await ctx.db.insert("transactions", value);
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
