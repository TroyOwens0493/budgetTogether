import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { GuideImport } from "../fixtures/backend";
import { expect, fixturePage, test } from "./fixture";
import { shoot } from "./shoot";

const month = "2026-10";
const seedImports = makeFunctionReference<
	"mutation",
	{ accountId: Id<"accounts">; entries: GuideImport[] }
>("fixture:seedGuideImports");

test("capture finding, adding, editing, matching, and deleting transactions", async ({
	household: { page, invoke },
}) => {
	const { spaces } = await invoke(api.budgets.home, {});
	const space = spaces.find((row) => row.type === "shared");
	if (!space) throw new Error("The demo needs a shared budget.");
	const spaceId = space._id;
	const [categories, accounts] = await Promise.all([
		invoke(api.budgets.categories, { spaceId }),
		invoke(api.accounts.list, { spaceId }),
	]);
	const accountId = accounts[0]._id;
	const categoryId = (name: string) => {
		const row = categories.find((entry) => entry.name === name);
		if (!row) throw new Error(`Missing demo category: ${name}`);
		return row._id;
	};

	await invoke(seedImports, {
		accountId,
		entries: (
			[
				["Northside Fuel", "18", 4762, "Transport", true],
				["Maple Market", "17", 8642, "Groceries", false],
				["Juniper Kitchen", "14", 4860, "Dining out", false],
				["Copper Internet", "11", 6999, "Other", false],
				["Property rent", "01", 160000, "Housing", false],
				["Paycheck", "03", -234000, "", false],
			] as const
		).map<GuideImport>(([description, day, amount, category, pending]) => ({
			description,
			date: `${month}-${day}`,
			amount,
			pending,
			kind: category ? "purchase" : "income",
			splits: category ? [{ categoryId: categoryId(category), amount }] : [],
			classificationStatus: "classified",
		})),
	});
	await page.setViewportSize({ width: 1280, height: 1520 });
	await page.clock.setFixedTime(new Date(`${month}-19T12:00:00Z`));
	await page.goto(fixturePage);
	await page.getByRole("button", { name: "Shared", exact: true }).click();
	await page.getByRole("button", { name: "Transactions", exact: true }).click();
	await expect(page.getByLabel("Reporting month")).toHaveValue(month);

	const list = page.locator(".table-panel");
	const search = page.getByPlaceholder("Search transactions");
	const account = page.getByLabel("Account filter");
	const category = page.getByLabel("Category filter");
	const fuel = list.getByRole("row").filter({ hasText: "Northside Fuel" });
	await expect(list.getByRole("row")).toHaveCount(7);
	await shoot(page, "transactions/find-transactions", {
		clip: list,
		annotate: [
			{ target: search, badge: "below" },
			{ target: account, badge: "below" },
			{ target: category, badge: "below" },
			{ target: fuel.getByText("Pending · purchase"), badge: "right" },
		],
	});
	await search.fill("maple");
	await expect(list.getByRole("row")).toHaveCount(2);
	await expect(
		list.getByRole("button", { name: "Maple Market" }),
	).toBeVisible();
	await account.selectOption({ label: "Checking" });
	await category.selectOption({ label: "Dining out" });
	await expect(
		list.getByText("No more transactions match these filters."),
	).toBeVisible();
	await search.clear();
	await expect(
		list.getByRole("button", { name: "Juniper Kitchen" }),
	).toBeVisible();
	await category.selectOption({ label: "All categories" });
	await account.selectOption({ label: "All accounts" });

	await page
		.getByRole("button", { name: "Add transaction", exact: true })
		.click();
	const add = page.getByRole("dialog", { name: "Add a transaction" });
	const entryAccount = add.locator('select[name="account"]');
	const description = add.getByLabel("Description");
	const amount = add.getByLabel(/^Amount \(positive/);
	const date = add.getByLabel("Date", { exact: true });
	const type = add.getByLabel("Classification");
	const note = add.getByLabel("Note");
	const save = add.getByRole("button", { name: "Save transaction" });
	await entryAccount.selectOption({ label: "Checking" });
	await description.fill("Maple Market receipt");
	await amount.fill("86.42");
	await date.fill(`${month}-16`);
	await type.selectOption({ label: "Purchase or refund" });
	await add
		.getByLabel("Category for split 1")
		.selectOption({ label: "Groceries" });
	await note.fill("Saturday groceries");
	await note.blur();
	await shoot(page, "transactions/add-manual-entry", {
		clip: add,
		annotate: [
			{ target: entryAccount, badge: "above" },
			{ target: description, badge: "above" },
			{ target: amount, badge: "right" },
			{ target: date, badge: "above" },
			{ target: type, badge: "above" },
			{ target: save, badge: "right" },
		],
	});
	await save.click();
	await expect(add).toHaveCount(0);
	await search.fill("saturday groceries");
	const receipt = list.getByRole("button", { name: "Maple Market receipt" });
	await receipt.click();

	const details = page.getByRole("dialog", { name: "Transaction details" });
	await expect(details.locator('select[name="account"]')).toBeDisabled();
	await details.getByLabel("Note").fill("Weekly grocery run");
	await details.getByRole("button", { name: "Save transaction" }).click();
	await expect(details).toHaveCount(0);
	await search.clear();
	await receipt.click();

	const match = details.locator(".reconcile");
	const imported = match.getByLabel("Imported transaction");
	await imported.selectOption({ label: `${month}-17 · Maple Market · $86.42` });
	const matchButton = match.getByRole("button", { name: "Match entries" });
	await match.scrollIntoViewIfNeeded();
	const matchBounds = await match.boundingBox();
	if (!matchBounds) throw new Error("The matching section is missing.");
	const margin = 12;
	await shoot(page, "transactions/match-imported-entry", {
		clip: {
			x: matchBounds.x - margin,
			y: matchBounds.y - margin,
			width: matchBounds.width + 2 * margin,
			height: matchBounds.height + 2 * margin,
		},
		annotate: [
			{ target: imported, badge: "above" },
			{ target: matchButton, badge: "right" },
		],
	});
	await matchButton.click();
	await expect(details).toHaveCount(0);
	await expect(receipt).toHaveCount(0);
	const maple = list.getByRole("row").filter({ hasText: "Maple Market" });
	await expect(maple).toContainText("Weekly grocery run");
	await expect(maple).toContainText("Groceries");

	await page
		.getByRole("button", { name: "Add transaction", exact: true })
		.click();
	await description.fill("Duplicate parking receipt");
	await amount.fill("6.00");
	await save.click();
	const duplicate = list.getByRole("button", {
		name: "Duplicate parking receipt",
	});
	await duplicate.click();
	await details.getByRole("button", { name: "Delete manual entry" }).click();
	const confirm = page.getByRole("dialog", {
		name: "Delete manual transaction",
	});
	await confirm.getByRole("button", { name: "Delete transaction" }).click();
	await expect(duplicate).toHaveCount(0);
});
