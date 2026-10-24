import { useMutation, useQuery } from "convex/react";
import { Plus, Search } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { parseTransactionAmounts } from "../domain/transaction-input";
import { categoryNameError, labelError } from "../domain/validation";
import { amount, ConfirmModal, Modal, MoneyInput, usd } from "./ui";
import { ValidatedInput } from "./ValidatedInput";
import type { ViewProps } from "./view-types";
export function TransactionsView({
	spaceId,
	month,
	active,
	run,
	categories,
}: ViewProps & { categories: Doc<"categories">[] }) {
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState("");
	const [account, setAccount] = useState("");
	const [page, setPage] = useState<{ key: string; cursor?: string }>();
	const pageKey = JSON.stringify([spaceId, month, search, category, account]);
	const cursor = page?.key === pageKey ? page.cursor : undefined;
	const setCursor = (cursor: string | undefined) =>
		setPage({ key: pageKey, cursor });
	const [editing, setEditing] = useState<
		Doc<"transactions"> | null | undefined
	>();
	const [categoryOpen, setCategoryOpen] = useState(false);
	const accounts = useQuery(api.accounts.list, { spaceId });
	const rows = useQuery(api.budgets.transactions, {
		spaceId,
		month,
		search,
		...(category ? { categoryId: category as Id<"categories"> } : {}),
		...(account ? { accountId: account as Id<"accounts"> } : {}),
		cursor,
	});
	return (
		<>
			<div className="page-actions">
				<div className="button-row">
					<button
						type="button"
						className="secondary"
						disabled={!active}
						onClick={() => setCategoryOpen(true)}
					>
						Manage categories
					</button>
					<button
						type="button"
						disabled={!active}
						onClick={() => setEditing(null)}
					>
						<Plus size={16} />
						Add transaction
					</button>
				</div>
			</div>
			<section className="panel table-panel">
				<div className="filters">
					<label className="search-input">
						<Search size={16} />
						<span className="sr-only">Search descriptions and notes</span>
						<input
							placeholder="Search transactions"
							value={search}
							onChange={(e) => {
								setSearch(e.target.value);
								setCursor(undefined);
							}}
						/>
					</label>
					<label>
						<span className="sr-only">Account filter</span>
						<select
							value={account}
							onChange={(e) => {
								setAccount(e.target.value);
								setCursor(undefined);
							}}
						>
							<option value="">All accounts</option>
							{accounts?.map((a) => (
								<option key={a._id} value={a._id}>
									{a.name}
								</option>
							))}
						</select>
					</label>
					<label>
						<span className="sr-only">Category filter</span>
						<select
							value={category}
							onChange={(e) => {
								setCategory(e.target.value);
								setCursor(undefined);
							}}
						>
							<option value="">All categories</option>
							{categories.map((c) => (
								<option key={c._id} value={c._id}>
									{c.name}
								</option>
							))}
						</select>
					</label>
				</div>
				<div className="table-scroll">
					<table>
						<thead>
							<tr>
								<th>Date</th>
								<th>Transaction</th>
								<th>Category</th>
								<th>Account</th>
								<th>Amount</th>
							</tr>
						</thead>
						<tbody>
							{rows?.rows.map((x) => (
								<tr key={x._id}>
									<td>{x.date}</td>
									<td>
										<button
											type="button"
											className="transaction-button"
											onClick={() => setEditing(x)}
										>
											{x.description}
										</button>
										<small>
											{x.pending ? "Pending · " : ""}
											{x.source === "manual" ? "Manual" : x.kind}
											{x.note ? ` · ${x.note}` : ""}
										</small>
										{!x.edited && x.classificationStatus === "pending" && (
											<small>Classification pending</small>
										)}
										{!x.edited && x.classificationStatus === "review" && (
											<span className="tag">Needs review</span>
										)}
									</td>
									<td>
										<span className="tag">
											{x.kind !== "purchase"
												? x.kind
												: x.splits.length > 1
													? `Split · ${x.splits.length} categories`
													: (categories.find(
															(c) => c._id === x.splits[0]?.categoryId,
														)?.name ?? "Uncategorized")}
										</span>
									</td>
									<td>
										{accounts?.find((a) => a._id === x.accountId)?.name ??
											"Account"}
									</td>
									<td className={x.amount < 0 ? "inflow" : ""}>
										{usd(-x.amount)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{!rows ? (
					<p className="empty-state">Loading transactions…</p>
				) : (
					<>
						{!rows.rows.length && (
							<p className="empty-state">
								{rows.next
									? "No matches on this page. Check the next page."
									: "No more transactions match these filters."}
							</p>
						)}
						<div className="pagination">
							<span>{rows.rows.length} transactions on this page</span>
							<button
								type="button"
								className="secondary"
								disabled={!cursor}
								onClick={() => setCursor(undefined)}
							>
								First page
							</button>
							<button
								type="button"
								className="secondary"
								disabled={!rows.next}
								onClick={() => setCursor(rows.next ?? undefined)}
							>
								Next page
							</button>
						</div>
					</>
				)}
			</section>
			{editing !== undefined && accounts && (
				<TransactionEditor
					key={editing?._id ?? "new"}
					{...{ spaceId, month, active, run, categories, accounts }}
					entry={editing}
					onClose={() => setEditing(undefined)}
				/>
			)}
			{categoryOpen && (
				<CategoryEditor
					{...{ spaceId, month, active, run, categories }}
					onClose={() => setCategoryOpen(false)}
				/>
			)}
		</>
	);
}
function TransactionEditor({
	spaceId,
	month,
	active,
	run,
	categories,
	accounts,
	entry,
	onClose,
}: ViewProps & {
	categories: Doc<"categories">[];
	accounts: { _id: Id<"accounts">; name: string; active: boolean }[];
	entry: Doc<"transactions"> | null;
	onClose: () => void;
}) {
	const save = useMutation(api.budgets.saveTransaction);
	const remove = useMutation(api.budgets.deleteTransaction);
	const reconcile = useMutation(api.budgets.reconcile);
	const funds = useQuery(api.budgets.funds, {
		spaceId,
		month: entry?.date.slice(0, 7) ?? month,
	});
	const [kind, setKind] = useState(entry?.kind ?? "purchase");
	const [transactionAmount, setTransactionAmount] = useState(
		entry ? amount(entry.amount) : "",
	);
	const [splits, setSplits] = useState(
		entry?.splits.length
			? entry.splits.map((x) => ({
					key: crypto.randomUUID(),
					categoryId: String(x.categoryId),
					amount: amount(x.amount),
					fundId: x.fundId ?? "",
				}))
			: [
					{
						key: crypto.randomUUID(),
						categoryId: categories[0]?._id ?? "",
						amount: "0.00",
						fundId: "",
					},
				],
	);
	const [match, setMatch] = useState("");
	const [importCursor, setImportCursor] = useState<string | undefined>();
	const [deleting, setDeleting] = useState(false);
	const amounts = parseTransactionAmounts(kind, transactionAmount, splits);
	const imports = useQuery(
		api.budgets.transactions,
		entry?.source === "manual"
			? {
					spaceId,
					month: entry.date.slice(0, 7),
					accountId: entry.accountId,
					limit: 100,
					cursor: importCursor,
				}
			: "skip",
	);
	async function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (!amounts.data) return;
		const { amount, splits: allocations } = amounts.data;
		const form = new FormData(e.currentTarget);
		if (
			await run(() =>
				save({
					spaceId,
					...(entry ? { id: entry._id } : {}),
					accountId: String(form.get("account")) as Id<"accounts">,
					description: String(form.get("description")),
					amount,
					date: String(form.get("date")),
					kind,
					pending: entry?.source === "plaid" ? entry.pending : false,
					note: String(form.get("note")),
					splits: allocations.map((split) => ({
						amount: split.amount,
						categoryId: split.categoryId as Id<"categories">,
						...(split.fundId ? { fundId: split.fundId as Id<"funds"> } : {}),
					})),
					revision: entry?.revision ?? 0,
				}),
			)
		)
			onClose();
	}
	return (
		<Modal
			title={entry ? "Transaction details" : "Add a transaction"}
			onClose={onClose}
		>
			<form onSubmit={submit}>
				{!entry?.edited && entry?.classificationStatus === "review" && (
					<p className="banner">
						Needs review. Check the type and category, then save.
					</p>
				)}
				{!entry?.edited && entry?.classificationStatus === "pending" && (
					<p className="banner">
						Classification is pending. Totals can change when it finishes. You
						can set the type and category now.
					</p>
				)}
				<fieldset disabled={!active}>
					<label>
						Account
						<select
							name="account"
							defaultValue={entry?.accountId}
							required
							disabled={Boolean(entry)}
						>
							{accounts
								.filter((x) => x.active || x._id === entry?.accountId)
								.map((x) => (
									<option key={x._id} value={x._id}>
										{x.name}
									</option>
								))}
						</select>
						{entry && (
							<input type="hidden" name="account" value={entry.accountId} />
						)}
					</label>
					{!accounts.some((x) => x.active) && !entry && (
						<p>Connect a bank in Accounts & settings first.</p>
					)}
					<label htmlFor="transactionsview-description">
						Description
						<ValidatedInput
							id="transactionsview-description"
							aria-label="Description"
							validate={(value) => labelError(value, 200)}
							name="description"
							defaultValue={entry?.description}
							required
							maxLength={200}
						/>
					</label>
					<MoneyInput
						name="amount"
						allowNegative
						value={entry?.amount}
						readOnly={entry?.source === "plaid"}
						onChange={setTransactionAmount}
						label="Amount (positive for outflow; negative for income or refund)"
					/>
					<label>
						Date
						<input
							name="date"
							type="date"
							min="0001-01-01"
							max="9999-12-31"
							defaultValue={entry?.date ?? `${month}-01`}
							required
							readOnly={entry?.source === "plaid"}
						/>
					</label>
					{entry?.source === "plaid" && (
						<p className="muted">
							Imported amount and date cannot be changed. Enter the bank amount
							shown: {usd(entry.amount)}.
						</p>
					)}
					<label>
						Classification
						<select
							value={kind}
							onChange={(e) => setKind(e.target.value as typeof kind)}
						>
							<option value="purchase">Purchase or refund</option>
							<option value="income">Income</option>
							<option value="transfer">Transfer or credit card payment</option>
						</select>
					</label>
					{kind === "purchase" && (
						<section>
							<h3>Category splits</h3>
							{splits.map((s, i) => (
								<div className="split-row funded-split-row" key={s.key}>
									<label>
										<span className="sr-only">Category for split {i + 1}</span>
										<select
											value={s.categoryId}
											required
											onChange={(e) =>
												setSplits(
													splits.map((x, j) =>
														j === i ? { ...x, categoryId: e.target.value } : x,
													),
												)
											}
										>
											{categories.map((c) => (
												<option key={c._id} value={c._id}>
													{c.name}
												</option>
											))}
										</select>
									</label>
									<label>
										<span className="sr-only">Amount for split {i + 1}</span>
										<input
											value={splits.length === 1 ? transactionAmount : s.amount}
											readOnly={splits.length === 1}
											inputMode="decimal"
											required
											onChange={(e) =>
												setSplits(
													splits.map((x, j) =>
														j === i ? { ...x, amount: e.target.value } : x,
													),
												)
											}
										/>
									</label>
									<label className="split-fund">
										<span>Pay from fund for split {i + 1}</span>
										<select
											value={s.fundId}
											aria-label={`Pay from fund for split ${i + 1}`}
											onChange={(event) =>
												setSplits(
													splits.map((row, index) =>
														index === i
															? { ...row, fundId: event.target.value }
															: row,
													),
												)
											}
										>
											<option value="">Use monthly category budget</option>
											{funds?.items.map((fund) => (
												<option key={fund._id} value={fund._id}>
													{fund.name}
												</option>
											))}
										</select>
									</label>
									<button
										type="button"
										className="text-button"
										aria-label={`Remove split ${i + 1}`}
										disabled={splits.length === 1}
										onClick={() => setSplits(splits.filter((_, j) => j !== i))}
									>
										×
									</button>
								</div>
							))}
							<button
								type="button"
								className="secondary"
								onClick={() =>
									setSplits([
										...splits.map((s) => ({
											...s,
											amount:
												splits.length === 1 ? transactionAmount : s.amount,
										})),
										{
											key: crypto.randomUUID(),
											categoryId: categories[0]?._id ?? "",
											amount: "0.00",
											fundId: "",
										},
									])
								}
							>
								Add split
							</button>
							<p className="muted">
								{splits.length === 1
									? "A single category uses the full transaction amount."
									: "Split amounts must total the transaction amount, including its sign."}
							</p>
							{splits.some((split) => split.fundId) && (
								<p className="muted">
									Fund payments reduce the fund’s reserved balance. Refunds add
									money back. Posted amounts still count in spending reports,
									but do not use the regular category limit.
								</p>
							)}
						</section>
					)}
					<label>
						Note
						<textarea name="note" maxLength={2000} defaultValue={entry?.note} />
					</label>
					{transactionAmount && amounts.error && (
						<p className="over" role="alert">
							{amounts.error}
						</p>
					)}
					<div className="button-row">
						<button type="submit" disabled={!amounts.data}>
							Save transaction
						</button>
						{entry?.source === "manual" && (
							<button
								type="button"
								className="danger"
								onClick={() => setDeleting(true)}
							>
								Delete manual entry
							</button>
						)}
					</div>
				</fieldset>
			</form>
			{entry?.source === "manual" && active && (
				<section className="reconcile">
					<h3>Match an imported entry</h3>
					<p>
						Keep the imported entry and apply this manual entry’s categories and
						note. The manual entry will stop counting.
					</p>
					<label>
						Imported transaction
						<select value={match} onChange={(e) => setMatch(e.target.value)}>
							<option value="">Choose a matching entry</option>
							{imports?.rows
								.filter(
									(x) => x.source === "plaid" && x.amount === entry.amount,
								)
								.map((x) => (
									<option key={x._id} value={x._id}>
										{x.date} · {x.description} · {usd(x.amount)}
									</option>
								))}
						</select>
					</label>
					<div className="button-row">
						<button
							type="button"
							className="secondary"
							disabled={!importCursor}
							onClick={() => {
								setImportCursor(undefined);
								setMatch("");
							}}
						>
							First page of imports
						</button>
						<button
							type="button"
							className="secondary"
							disabled={!imports?.next}
							onClick={() => {
								setImportCursor(imports?.next ?? undefined);
								setMatch("");
							}}
						>
							Next page of imports
						</button>
					</div>
					<button
						type="button"
						className="secondary"
						disabled={!match}
						onClick={async () => {
							if (
								await run(
									() =>
										reconcile({
											manualId: entry._id,
											importId: match as Id<"transactions">,
											revision: entry.revision,
										}),
									"Entries matched.",
								)
							)
								onClose();
						}}
					>
						Match entries
					</button>
				</section>
			)}
			{deleting && entry?.source === "manual" && (
				<ConfirmModal
					title="Delete manual transaction"
					confirmLabel="Delete transaction"
					onClose={() => setDeleting(false)}
					onConfirm={async () => {
						const deleted = await run(() =>
							remove({ id: entry._id, revision: entry.revision }),
						);
						if (deleted) onClose();
						return deleted;
					}}
				>
					<p>Delete this manual transaction?</p>
				</ConfirmModal>
			)}
		</Modal>
	);
}
function CategoryEditor({
	spaceId,
	run,
	categories,
	onClose,
}: ViewProps & { categories: Doc<"categories">[]; onClose: () => void }) {
	const save = useMutation(api.budgets.saveCategory);
	const remove = useMutation(api.budgets.deleteCategory);
	const [selected, setSelected] = useState("");
	const [current, setCurrent] = useState<Doc<"categories"> | undefined>();
	const [replacement, setReplacement] = useState("");
	const [deleting, setDeleting] = useState(false);
	return (
		<Modal title="Manage categories" onClose={onClose}>
			<label>
				Category
				<select
					value={selected}
					onChange={(e) => {
						setSelected(e.target.value);
						setCurrent(categories.find((x) => x._id === e.target.value));
						setReplacement("");
					}}
				>
					<option value="">Create a category</option>
					{categories.map((x) => (
						<option key={x._id} value={x._id}>
							{x.name}
						</option>
					))}
				</select>
			</label>
			<form
				key={selected}
				onSubmit={async (e) => {
					e.preventDefault();
					const data = new FormData(e.currentTarget);
					const saved = await run(() =>
						save({
							spaceId,
							...(current
								? { id: current._id, revision: current.revision }
								: {}),
							name: String(data.get("name")),
							color: String(data.get("color")),
						}),
					);
					if (saved) onClose();
				}}
			>
				<label htmlFor="transactionsview-name">
					Name
					<ValidatedInput
						id="transactionsview-name"
						aria-label="Name"
						validate={(value) =>
							categoryNameError(value, categories, current?._id)
						}
						name="name"
						defaultValue={current?.name ?? ""}
						required
						maxLength={100}
					/>
				</label>
				<label>
					Color
					<input
						name="color"
						type="color"
						defaultValue={current?.color ?? "#83aaa2"}
					/>
				</label>
				<button type="submit">
					{current ? "Save changes" : "Create category"}
				</button>
			</form>
			{current && (
				<section className="reconcile">
					<h3>Delete this category</h3>
					<p>
						Choose where to move its transactions, plan limits, and
						carry-forward allocations.
					</p>
					<label>
						Replacement
						<select
							value={replacement}
							onChange={(e) => setReplacement(e.target.value)}
						>
							<option value="">Choose a category</option>
							{categories
								.filter((x) => x._id !== current._id)
								.map((x) => (
									<option key={x._id} value={x._id}>
										{x.name}
									</option>
								))}
						</select>
					</label>
					<button
						type="button"
						className="danger"
						disabled={!replacement}
						onClick={() => setDeleting(true)}
					>
						Delete and reassign
					</button>
				</section>
			)}
			{deleting && current && (
				<ConfirmModal
					title="Delete category"
					confirmLabel="Delete and reassign"
					onClose={() => setDeleting(false)}
					onConfirm={async () => {
						const deleted = await run(() =>
							remove({
								id: current._id,
								replacementId: replacement as Id<"categories">,
								revision: current.revision,
							}),
						);
						if (deleted) {
							setSelected("");
							setCurrent(undefined);
							setReplacement("");
						}
						return deleted;
					}}
				>
					<p>
						Delete {current.name} and reassign its transactions, plan limits,
						and carry-forward allocations to{" "}
						{categories.find((x) => x._id === replacement)?.name}?
					</p>
				</ConfirmModal>
			)}
		</Modal>
	);
}
