import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { GuideImport } from "../fixtures/backend";
import { expect, fixturePage, test } from "./fixture";
import { shoot } from "./shoot";

const seedImports = makeFunctionReference<
	"mutation",
	{ accountId: Id<"accounts">; entries: GuideImport[] }
>("fixture:seedGuideImports");

test("capture the Overview for a household with a plan and six months of spending", async ({
	household: { page, invoke },
}) => {
	const today = new Date();
	const months = Array.from({ length: 6 }, (_, index) =>
		new Date(
			Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + index - 5, 1),
		)
			.toISOString()
			.slice(0, 7),
	);
	const month = months[5];
	const { spaces } = await invoke(api.budgets.home, {});
	const space = spaces.find((row) => row.type === "shared");
	if (!space) throw new Error("The demo needs a shared budget.");
	const spaceId = space._id;
	const [categories, accounts] = await Promise.all([
		invoke(api.budgets.categories, { spaceId }),
		invoke(api.accounts.list, { spaceId }),
	]);
	const accountId = accounts[0]._id;
	const category = (name: string) => {
		const row = categories.find((entry) => entry.name === name);
		if (!row) throw new Error(`Missing demo category: ${name}`);
		return row;
	};
	const plan = [
		["Housing", 160000, "#548e79"],
		["Groceries", 65000, "#82a359"],
		["Dining out", 23000, "#d28755"],
		["Entertainment", 9000, "#a380aa"],
		["Transport", 33000, "#6295bb"],
		["Other", 69000, "#969568"],
	] as const;
	for (const [name, , color] of plan) {
		const { _id, revision } = category(name);
		await invoke(api.budgets.saveCategory, {
			spaceId,
			id: _id,
			revision,
			name,
			color,
		});
	}
	await invoke(api.budgets.saveFund, {
		spaceId,
		startMonth: month,
		effectiveMonth: month,
		name: "Car insurance",
		openingBalance: 24000,
		targetAmount: 48000,
		targetMonth: month,
		intervalMonths: 6,
		revision: 0,
	});
	const fund = await invoke(api.budgets.funds, { spaceId, month });
	const expectedIncome = 460000;
	const limits = plan.map(([name, amount]) => ({
		categoryId: category(name)._id,
		amount,
	}));
	await invoke(api.budgets.savePlan, {
		spaceId,
		month,
		expectedIncome,
		savingsTarget:
			expectedIncome -
			fund.total -
			limits.reduce((sum, limit) => sum + limit.amount, 0),
		limits,
		fundSignature: fund.signature,
		revision: 0,
	});

	const entries: GuideImport[] = [];
	const purchase = (
		date: string,
		description: string,
		amount: number,
		name: string,
		pending = false,
	) => {
		entries.push({
			date,
			description,
			amount,
			pending,
			kind: "purchase",
			splits: [{ categoryId: category(name)._id, amount }],
			classificationStatus: "classified",
		});
	};
	for (const [index, period] of months.entries()) {
		purchase(`${period}-01`, `Rent · ${period}`, 160000, "Housing");
		purchase(
			`${period}-12`,
			`Groceries · ${period}`,
			[53460, 40898, 63150, 52480, 72415, 38520][index],
			"Groceries",
		);
		purchase(
			`${period}-15`,
			`Fuel and maintenance · ${period}`,
			[16540, 85120, 31670, 8540, 25110, 21890][index],
			"Transport",
		);
		if (index >= 3) {
			purchase(`${period}-06`, "Copper Internet", 6999, "Other");
			purchase(`${period}-08`, "Pine Street Yoga", 4500, "Entertainment");
		}
	}
	purchase(`${month}-17`, "Juniper Kitchen", 26340, "Dining out");
	purchase(`${month}-18`, "Maple Market", 14285, "Groceries");
	purchase(`${month}-19`, "Maple Market refund", -1249, "Groceries");
	purchase(`${month}-20`, "Northside Fuel", 4762, "Transport", true);
	entries.push({
		date: `${month}-03`,
		description: "Paycheck",
		amount: -468000,
		pending: false,
		kind: "income",
		splits: [],
		classificationStatus: "classified",
	});
	await invoke(seedImports, { accountId, entries });

	await page.setViewportSize({ width: 1280, height: 1000 });
	await page.clock.setFixedTime(new Date(`${month}-21T12:00:00Z`));
	await page.goto(fixturePage);
	await page.getByRole("button", { name: "Shared", exact: true }).click();
	await expect(page.getByLabel("Reporting month")).toHaveValue(month);

	const summary = page.locator(".summary-grid");
	await expect(summary.getByText("$4,680.00", { exact: true })).toBeVisible();
	await expect(
		summary.getByText("$47.62 pending, separate from totals"),
	).toBeVisible();
	await expect(summary.getByText("$2,712.85", { exact: true })).toBeVisible();
	await shoot(page, "overview/month-summary", {
		clip: summary,
		annotate: ["Money in", "Money out", "Saved this month"].map((name) => ({
			target: summary.getByText(name, { exact: true }),
			badge: "right",
		})),
	});

	const balances = page.locator(".panel").filter({
		has: page.getByRole("heading", { name: "Category balances" }),
	});
	const manage = balances.getByRole("button", { name: "Manage categories" });
	await expect(balances.getByText("$134.44", { exact: true })).toBeVisible();
	await expect(balances.getByText("-$33.40", { exact: true })).toBeVisible();
	await shoot(page, "overview/category-balances", {
		clip: balances,
		annotate: [
			{ target: balances.getByText("$515.56 of $650.00"), badge: "left" },
			{ target: balances.getByText("-$33.40", { exact: true }), badge: "left" },
			{ target: manage, badge: "left" },
		],
	});

	const alerts = page.getByRole("button", { name: /^Alerts, [1-9]/ });
	await alerts.click();
	const alertDialog = page.getByRole("dialog", { name: "Your alerts" });
	const diningAlert = alertDialog
		.locator(".alert-row")
		.filter({ hasText: "Dining out: over budget" });
	await diningAlert.getByRole("button", { name: "Mark read" }).click();
	await expect(
		diningAlert.getByRole("button", { name: "Mark read" }),
	).toHaveCount(0);
	await alertDialog.getByRole("button", { name: "Close dialog" }).click();

	const chart = page.locator(".panel").filter({
		has: page.getByRole("heading", { name: "Spending over time" }),
	});
	await expect(chart.getByRole("row")).toHaveCount(7);
	const shown = chart.getByLabel("Spending shown");
	await shoot(page, "overview/spending-chart", {
		clip: chart,
		annotate: [
			{ target: shown, badge: "above" },
			{ target: chart.getByRole("img"), badge: "right" },
			{
				target: chart.getByRole("columnheader", { name: "Spending" }),
				badge: "right",
			},
		],
	});
	await shown.selectOption({ label: "Groceries" });
	await expect(
		chart.getByRole("row").filter({ hasText: month }).getByText("$515.56"),
	).toBeVisible();

	const activity = page.locator(".activity");
	const transactions = activity.getByRole("button", {
		name: /All transactions/,
	});
	await expect(activity.locator(".activity-row")).toHaveCount(3);
	await shoot(page, "overview/recent-activity", {
		clip: activity,
		annotate: [
			{ target: activity.getByText(`${month}-20 · Pending`), badge: "above" },
			{ target: transactions, badge: "left" },
		],
	});

	const suggestions = page.locator(".panel").filter({
		has: page.getByRole("heading", { name: "Recurring-charge suggestions" }),
	});
	const internet = suggestions
		.locator(".alert-row")
		.filter({ hasText: "copper internet" });
	const yoga = suggestions
		.locator(".alert-row")
		.filter({ hasText: "pine street yoga" });
	await expect(internet).toContainText("$69.99");
	await expect(yoga).toContainText("$45.00");
	await shoot(page, "overview/recurring-charges", {
		clip: suggestions,
		annotate: [
			{ target: internet.getByText(/estimated.*suggested/), badge: "right" },
			{
				target: internet.getByRole("button", { name: "Confirm" }),
				badge: "left",
			},
			{ target: yoga.getByRole("button", { name: "Dismiss" }), badge: "below" },
		],
	});
	await internet.getByRole("button", { name: "Confirm" }).click();
	await expect(internet).toContainText("confirmed");
	await yoga.getByRole("button", { name: "Dismiss" }).click();
	await expect(yoga).toHaveCount(0);

	await manage.click();
	const editor = page.getByRole("dialog", { name: "Manage categories" });
	const selectCategory = editor.getByLabel("Category", { exact: true });
	const name = editor.getByLabel("Name", { exact: true });
	await expect(selectCategory).toHaveValue("");
	await name.fill("Home supplies");
	await editor.getByRole("button", { name: "Create category" }).click();
	await expect(balances.getByText("Home supplies")).toBeVisible();

	await manage.click();
	await selectCategory.selectOption({ label: "Home supplies" });
	await name.fill("Household supplies");
	await editor.getByRole("button", { name: "Save changes" }).click();
	await expect(balances.getByText("Household supplies")).toBeVisible();

	await manage.click();
	await selectCategory.selectOption({ label: "Dining out" });
	const replacement = editor.getByLabel("Replacement");
	await replacement.selectOption({ label: "Other" });
	const deleteAndReassign = editor.getByRole("button", {
		name: "Delete and reassign",
	});
	await shoot(page, "overview/manage-categories", {
		clip: editor,
		annotate: [
			{ target: selectCategory, badge: "above" },
			{ target: name, badge: "above" },
			{ target: replacement, badge: "above" },
			{ target: deleteAndReassign, badge: "right" },
		],
	});
	await deleteAndReassign.click();
	const confirmation = page.getByRole("dialog", { name: "Delete category" });
	await expect(confirmation).toContainText("Delete Dining out");
	await confirmation
		.getByRole("button", { name: "Delete and reassign" })
		.click();
	await expect(confirmation).toHaveCount(0);
	await editor.getByRole("button", { name: "Close dialog" }).click();
	await expect(balances.getByText("Dining out")).toHaveCount(0);
	await expect(balances.getByText("$333.39 of $920.00")).toBeVisible();

	await transactions.click();
	await expect(page.getByPlaceholder("Search transactions")).toBeVisible();
});
