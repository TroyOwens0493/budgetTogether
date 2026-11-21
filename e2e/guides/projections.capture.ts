import { api } from "../../convex/_generated/api";
import { addMonths } from "../../src/domain/projections";
import { expect, fixturePage, test } from "./fixture";
import { shoot } from "./shoot";

const slug = "projections";

test.use({ scenario: "projections" });

test("capture forecast setup, warnings, and results", async ({
	household: { page, invoke },
}) => {
	const home = await invoke(api.budgets.home, {});
	const spaceId = home.spaces.find(({ type }) => type === "shared")?._id;
	if (!spaceId) throw new Error("The forecast demo needs a shared budget.");
	const { month, startsOn } = await invoke(api.projections.list, { spaceId });
	const categories = await invoke(api.budgets.categories, { spaceId });
	const limits = Object.entries({
		Housing: 180000,
		Groceries: 65000,
		"Dining out": 20000,
		Entertainment: 15000,
		Transport: 45000,
		Other: 110000,
	}).map(([name, amount]) => {
		const category = categories.find((entry) => entry.name === name);
		if (!category) throw new Error(`The demo needs the ${name} category.`);
		return { categoryId: category._id, amount };
	});
	await invoke(api.budgets.savePlan, {
		spaceId,
		month,
		expectedIncome: 520000,
		savingsTarget: 85000,
		limits,
		revision: 0,
	});
	const holding = {
		spaceId,
		accountName: "Maple Brokerage",
		accountType: "brokerage",
		ticker: "",
		excluded: false,
		revision: 0,
	};
	await invoke(api.projections.saveHolding, {
		...holding,
		name: "Total Market Index Fund",
		type: "etf",
		balance: 3400000,
		annualReturnOverride: 7,
		monthlyContribution: 40000,
	});
	const { accounts } = await invoke(api.projections.list, { spaceId });
	const accountId = accounts.find(
		({ name }) => name === holding.accountName,
	)?._id;
	if (!accountId) throw new Error("The demo needs a manual brokerage.");
	await invoke(api.projections.saveHolding, {
		...holding,
		accountId,
		name: "Cedar Rail Stock",
		type: "stock",
		balance: 600000,
		annualReturnOverride: 5,
		monthlyContribution: 10000,
	});
	await invoke(api.projections.saveHolding, {
		...holding,
		accountId,
		name: "Two-year CD",
		type: "cd",
		balance: 500000,
		annualReturnOverride: 4.25,
		monthlyContribution: 0,
		fixedIncome: { maturityDate: addMonths(startsOn, 24) },
	});

	await page.setViewportSize({ width: 1280, height: 1000 });
	await page.goto(fixturePage);
	await page.getByRole("button", { name: "Projections", exact: true }).click();
	await page
		.getByRole("button", { name: "Set up forecast", exact: true })
		.click();
	const dialog = page.getByRole("dialog", { name: "Forecast settings" });
	const currentAge = dialog.getByLabel("Current age", { exact: true });
	const targetAge = dialog.getByLabel("Forecast to age", { exact: true });
	const unlinked = dialog.getByLabel("Additional unlinked cash savings");
	const interest = dialog.getByLabel("Cash annual interest (%)", {
		exact: true,
	});
	const save = dialog.getByRole("button", { name: "Save forecast settings" });
	await currentAge.fill("34");
	await targetAge.fill("39");
	await unlinked.fill("18500");
	await interest.fill("3.5");
	await interest.blur();
	await shoot(page, `${slug}/forecast-settings`, {
		clip: dialog,
		annotate: [
			{ target: currentAge, badge: "left" },
			{ target: targetAge, badge: "right" },
			{ target: unlinked, badge: "right" },
			{ target: interest, badge: "left" },
			{ target: save, badge: "right" },
		],
	});
	await save.click();
	await expect(dialog).toHaveCount(0);

	const attention = page.getByRole("region", {
		name: "Forecast needs attention",
	});
	await expect(attention.getByRole("listitem")).toHaveCount(3);
	await expect(page.locator(".projection-chart")).toHaveCount(0);
	const cashWarning = attention
		.getByRole("listitem")
		.filter({ hasText: "usable cash balance" });
	const mismatch = attention
		.getByRole("listitem")
		.filter({ hasText: "don't add up to the account balance" });
	const missingReturn = attention
		.getByRole("listitem")
		.filter({ hasText: "This holding has no trading symbol" });
	await shoot(page, `${slug}/forecast-warnings`, {
		clip: attention,
		annotate: [
			{
				target: attention.getByText("Complete your forecast", { exact: true }),
				badge: "right",
			},
			{ target: cashWarning, badge: "right" },
			{ target: mismatch, badge: "right" },
			{ target: missingReturn, badge: "right" },
		],
	});
	const cashAccounts = page.locator("section.panel").filter({
		has: page.getByRole("heading", {
			name: "Cash savings accounts",
			exact: true,
		}),
	});
	const checking = cashAccounts.getByRole("checkbox", {
		name: "Include Checking ending in 1234",
	});
	const savings = cashAccounts.getByRole("checkbox", {
		name: /at First Sandbox Bank$/,
	});
	await expect(checking).not.toBeChecked();
	await expect(savings).toBeChecked();
	await cashAccounts.evaluate((panel) =>
		panel.scrollIntoView({ block: "center", behavior: "instant" }),
	);
	await shoot(page, `${slug}/cash-accounts`, {
		clip: cashAccounts,
		annotate: [
			{ target: savings, badge: "below" },
			{ target: checking, badge: "below" },
			{
				target: cashAccounts.getByText("Starting cash: $18,500.00"),
				badge: "left",
			},
		],
	});
	await savings.click();
	const investments = page.getByRole("checkbox", { name: /Include .*401k/ });
	await investments.click();
	await expect(attention).toHaveCount(0);

	const funding = page.locator(".projection-funding");
	await expect(funding.getByText("$850.00", { exact: true })).toBeVisible();
	await expect(funding.getByText("$500.00", { exact: true })).toBeVisible();
	await expect(funding.getByText("$350.00", { exact: true })).toBeVisible();
	const editBudget = funding.getByRole("button", {
		name: "Edit monthly budget",
	});
	await shoot(page, `${slug}/monthly-target`, {
		clip: funding,
		annotate: [
			{ target: funding.getByText("$850.00", { exact: true }), badge: "below" },
			{
				target: funding.getByText("To investments", { exact: true }),
				badge: "above",
			},
			{
				target: funding.getByText("To cash savings", { exact: true }),
				badge: "above",
			},
			{ target: editBudget, badge: "right" },
		],
	});

	const cashChart = page.locator(".projection-cash");
	const cashMonth = page.getByRole("slider", {
		name: "Cash savings forecast month",
	});
	const investmentMonth = page.getByRole("slider", {
		name: "Investments forecast month",
	});
	await expect(cashMonth).toHaveValue("60");
	await expect(investmentMonth).toHaveValue("60");
	await cashMonth.fill("0");
	await expect(cashChart.locator(".projection-value")).toHaveText("$18,500.00");
	await cashMonth.fill("30");
	await investmentMonth.fill("30");
	await expect(page.getByText("At age 36.5", { exact: true })).toHaveCount(2);
	const charts = page.locator(".dashboard-grid").filter({ has: cashMonth });
	await charts.evaluate((panel) =>
		panel.scrollIntoView({ block: "center", behavior: "instant" }),
	);
	await shoot(page, `${slug}/month-sliders`, {
		clip: charts,
		annotate: [
			{ target: cashMonth, badge: "below" },
			{ target: investmentMonth, badge: "below" },
			{
				target: cashChart.getByText("At age 36.5", { exact: true }),
				badge: "left",
			},
		],
	});

	const yearly = page.getByText("Yearly forecast values", { exact: true });
	await yearly.click();
	const table = page.getByRole("table", {
		name: "Yearly forecast in US dollars",
	});
	await expect(table.getByRole("row")).toHaveCount(7);
	await expect(table.getByRole("row").nth(1)).toContainText("$63,500.00");
	const yearlyValues = page.locator(".projection-notes");
	await yearlyValues.evaluate((panel) =>
		panel.scrollIntoView({ block: "center", behavior: "instant" }),
	);
	await shoot(page, `${slug}/yearly-values`, {
		clip: yearlyValues,
		annotate: [
			{ target: yearly, badge: "above" },
			{
				target: table.getByRole("cell", { name: "39", exact: true }),
				badge: "below",
			},
		],
	});
	await editBudget.click();
	await expect(page.getByLabel("Reporting month")).toHaveValue(month);
	await page
		.getByRole("button", { name: "Accounts & sharing", exact: true })
		.click();
	const connection = page
		.locator(".connection-row")
		.filter({ hasText: "First Sandbox Bank" });
	await expect(
		connection.getByRole("button", { name: "Sync", exact: true }),
	).toBeEnabled();
});
