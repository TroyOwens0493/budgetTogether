import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { categoryNameError } from "../domain/validation";
import { ConfirmModal, Modal } from "./ui";
import { ValidatedInput } from "./ValidatedInput";
import type { ViewProps } from "./view-types";

export function CategoryEditor({
	spaceId,
	run,
	categories,
	onClose,
}: Pick<ViewProps, "spaceId" | "run"> & {
	categories: Doc<"categories">[];
	onClose: () => void;
}) {
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
					aria-label="Category"
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
				<label htmlFor="category-editor-name">
					Name
					<ValidatedInput
						id="category-editor-name"
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
