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

test("capture reviewing a classification and splitting a purchase with a fund", async ({
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
	await invoke(api.budgets.saveFund, {
		spaceId,
		name: "Car maintenance",
		startMonth: month,
		effectiveMonth: month,
		openingBalance: 30000,
		targetAmount: 60000,
		targetMonth: "2027-03",
		intervalMonths: 12,
		revision: 0,
	});
	await invoke(seedImports, {
		accountId,
		entries: [
			{
				description: "Pine Street Superstore",
				date: `${month}-18`,
				amount: 9825,
				pending: false,
				kind: "purchase",
				splits: [{ categoryId: categoryId("Other"), amount: 9825 }],
				classificationStatus: "review",
			},
			{
				description: "Credit card payment",
				date: `${month}-16`,
				amount: 25851,
				pending: false,
				kind: "purchase",
				splits: [],
				classificationStatus: "pending",
			},
			{
				description: "Juniper Kitchen",
				date: `${month}-15`,
				amount: 4860,
				pending: false,
				kind: "purchase",
				splits: [{ categoryId: categoryId("Dining out"), amount: 4860 }],
				classificationStatus: "classified",
			},
		],
	});
	await page.setViewportSize({ width: 1280, height: 1400 });
	await page.clock.setFixedTime(new Date(`${month}-19T12:00:00Z`));
	await page.goto(fixturePage);
	await page.getByRole("button", { name: "Shared", exact: true }).click();
	await page.getByRole("button", { name: "Transactions", exact: true }).click();

	const list = page.locator(".table-panel");
	const superstore = list
		.getByRole("row")
		.filter({ hasText: "Pine Street Superstore" });
	const payment = list
		.getByRole("row")
		.filter({ hasText: "Credit card payment" });
	const needsReview = superstore.getByText("Needs review", { exact: true });
	await expect(needsReview).toBeVisible();
	await shoot(page, "review-and-split-transactions/review-status", {
		clip: list.locator(".table-scroll"),
		annotate: [
			{ target: needsReview, badge: "right" },
			{ target: payment.getByText("Classification pending"), badge: "right" },
		],
	});

	await superstore.getByRole("button", { name: "Other", exact: true }).click();
	const details = page.getByRole("dialog", { name: "Transaction details" });
	const type = details.getByLabel("Classification");
	const firstCategory = details.getByLabel("Category for split 1");
	const save = details.getByRole("button", { name: "Save transaction" });
	await expect(
		details.getByText("Needs review. Check the type and category, then save."),
	).toBeVisible();
	await firstCategory.selectOption({ label: "Groceries" });
	await shoot(page, "review-and-split-transactions/check-classification", {
		clip: details,
		annotate: [
			{ target: type, badge: "below" },
			{ target: firstCategory, badge: "above" },
			{ target: save, badge: "right" },
		],
	});
	await save.click();
	await expect(details).toHaveCount(0);
	await expect(needsReview).toHaveCount(0);

	await superstore
		.getByRole("button", { name: "Pine Street Superstore" })
		.click();
	const addSplit = details.getByRole("button", { name: "Add split" });
	await addSplit.click();
	const secondCategory = details.getByLabel("Category for split 2");
	const firstAmount = details.getByLabel("Amount for split 1");
	const secondAmount = details.getByLabel("Amount for split 2");
	const secondFund = details.getByLabel("Pay from fund for split 2");
	await secondCategory.selectOption({ label: "Transport" });
	await firstAmount.fill("65.25");
	await secondAmount.fill("32.00");
	await expect(save).toBeDisabled();
	await secondAmount.fill("33.00");
	await secondFund.selectOption({ label: "Car maintenance" });
	await secondAmount.blur();
	const splits = details
		.locator("section")
		.filter({ has: page.getByRole("heading", { name: "Category splits" }) });
	await shoot(page, "review-and-split-transactions/splits-and-fund", {
		clip: splits,
		annotate: [
			{ target: addSplit, badge: "right" },
			{ target: secondCategory, badge: "above" },
			{ target: secondAmount, badge: "above" },
			{ target: secondFund, badge: "below" },
		],
	});
	await save.click();
	await expect(
		superstore.getByRole("button", { name: "Split · 2 categories" }),
	).toBeVisible();
	const { spendingCategories: reported } = await invoke(api.budgets.dashboard, {
		spaceId,
		month,
	});
	expect(reported[categoryId("Transport")]).toBe(3300);
	const funds = await invoke(api.budgets.funds, { spaceId, month });
	expect(funds.items).toHaveLength(1);
	expect(funds.items[0].balance).toBe(26700);

	await payment.getByRole("button", { name: "Credit card payment" }).click();
	await type.selectOption({ label: "Transfer or credit card payment" });
	await expect(
		details.getByRole("heading", { name: "Category splits" }),
	).toHaveCount(0);
	await save.click();
	await expect(details).toHaveCount(0);
	await expect(payment.getByText("Classification pending")).toHaveCount(0);
	await expect(
		payment.getByRole("button", { name: "transfer", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Overview", exact: true }).click();
	const transport = page
		.locator(".category-row")
		.filter({ hasText: "Transport" });
	await expect(transport).toContainText("$0.00 of $0.00");
});
