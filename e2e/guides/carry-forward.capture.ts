import { api } from "../../convex/_generated/api";
import { expect, fixturePage, test } from "./fixture";
import { shoot } from "./shoot";

const slug = "carry-forward";
const source = "2026-10";
const destination = "2026-11";

test("capture a monthly review and an existing carry-forward", async ({
	household: { page, invoke },
}) => {
	const { spaces } = await invoke(api.budgets.home, {});
	const space = spaces.find(({ type }) => type === "shared");
	if (!space) throw new Error("The demo household needs a shared budget.");
	const spaceId = space._id;
	const [categories, [account]] = await Promise.all([
		invoke(api.budgets.categories, { spaceId }),
		invoke(api.accounts.list, { spaceId }),
	]);
	const categoryId = (name: string) => {
		const category = categories.find((row) => row.name === name);
		if (!category) throw new Error(`Missing demo category: ${name}`);
		return category._id;
	};
	const insurance = await invoke(api.budgets.saveFund, {
		spaceId,
		startMonth: source,
		effectiveMonth: source,
		name: "Car insurance",
		openingBalance: 46000,
		targetAmount: 60000,
		targetMonth: source,
		intervalMonths: 6,
		revision: 0,
	});
	await invoke(api.budgets.saveFund, {
		spaceId,
		startMonth: source,
		effectiveMonth: source,
		name: "Summer vacation",
		openingBalance: 20000,
		targetAmount: 150000,
		monthlyAmount: 10000,
		revision: 0,
	});
	const funds = await invoke(api.budgets.funds, { spaceId, month: source });
	await invoke(api.budgets.savePlan, {
		spaceId,
		month: source,
		expectedIncome: 465000,
		savingsTarget: 50000,
		limits: Object.entries({
			Housing: 220000,
			Groceries: 65000,
			"Dining out": 24000,
			Entertainment: 14000,
			Transport: 33000,
			Other: 35000,
		}).map(([name, amount]) => ({ categoryId: categoryId(name), amount })),
		fundSignature: funds.signature,
		revision: 0,
	});
	const transaction = (
		description: string,
		day: string,
		amount: number,
		category?: string,
		funded = false,
	) =>
		invoke(api.budgets.saveTransaction, {
			spaceId,
			accountId: account._id,
			description,
			amount,
			date: `${source}-${day}`,
			kind: category ? "purchase" : "income",
			splits: category
				? [
						{
							categoryId: categoryId(category),
							amount,
							...(funded ? { fundId: insurance } : {}),
						},
					]
				: [],
			pending: false,
			note: "",
			revision: 0,
		});
	await transaction("October rent", "01", 220000, "Housing");
	await transaction("October pay", "02", -465000);
	await transaction("Maple Market", "08", 37000, "Groceries");
	await transaction("Neighborhood Grill", "10", 18000, "Dining out");
	await transaction("Family movie tickets", "12", 7500, "Entertainment");
	await transaction("Westside Auto & Fuel", "15", 29000, "Transport");
	await transaction("Internet bill", "17", 9500, "Other");
	await transaction("Maple Market", "20", 33000, "Groceries");
	await transaction("Juniper Mutual", "27", 20000, "Transport", true);

	await page.setViewportSize({ width: 1280, height: 1000 });
	await page.clock.setFixedTime(new Date(`${destination}-05T12:00:00Z`));
	await page.goto(fixturePage);
	const reportingMonth = page.getByLabel("Reporting month");
	await reportingMonth.fill(source);
	const results = page.locator(".summary-grid");
	await expect(results.getByText("$910.00", { exact: true })).toBeVisible();
	await expect(
		results.getByText("$370.00 above your $500.00 target"),
	).toBeVisible();
	await shoot(page, `${slug}/month-results`, {
		clip: results,
		annotate: [
			{
				target: results.getByText("Money out", { exact: true }),
				badge: "above",
			},
			{ target: results.getByText("$910.00", { exact: true }), badge: "above" },
			{
				target: results.getByText("$370.00 above your $500.00 target"),
				badge: "right",
			},
		],
	});
	const sourcePlan = await invoke(api.budgets.dashboard, {
		spaceId,
		month: source,
	});
	expect(sourcePlan.available).toBe(37000);
	await invoke(api.budgets.review, {
		spaceId,
		month: source,
		allocations: [
			{ categoryId: categoryId("Groceries"), amount: 15000 },
			{ amount: 10000 },
		],
		revision: sourcePlan.plan?.revision ?? 0,
	});
	const reviewed = await invoke(api.budgets.dashboard, {
		spaceId,
		month: source,
	});
	expect(reviewed.available).toBe(12000);
	expect(reviewed.savings).toBe(sourcePlan.savings);
	expect(reviewed.reserved.reduce((sum, row) => sum + row.amount, 0)).toBe(
		25000,
	);

	await page
		.getByRole("button", { name: "Monthly budget", exact: true })
		.click();
	const over = page
		.getByRole("alert")
		.filter({ hasText: "Groceries: over budget" });
	const dismiss = over.getByRole("button", {
		name: "Dismiss Groceries: over budget notification",
	});
	await expect(over).toBeVisible();
	await shoot(page, `${slug}/over-budget-notice`, {
		clip: over,
		annotate: [{ target: dismiss, badge: "left" }],
	});
	await dismiss.click();
	await expect(over).toHaveCount(0);

	await reportingMonth.fill(destination);
	const summary = page.locator(".plan-summary");
	const carry = summary
		.locator("dl > div")
		.filter({ hasText: "Carry-forward" });
	await expect(carry.getByText("$250.00", { exact: true })).toBeVisible();
	await expect(page.getByLabel("Groceries", { exact: true })).toHaveValue(
		"800.00",
	);
	const target = page.getByLabel("Monthly savings target", { exact: true });
	await expect(target).toHaveValue("600.00");
	await shoot(page, `${slug}/next-month-funding`, {
		clip: summary,
		annotate: [{ target: carry.locator("dd"), badge: "left" }],
	});

	await transaction("October utility adjustment", "30", 22500, "Other");
	await page.reload();
	await expect(reportingMonth).toHaveValue(destination);
	await page
		.getByRole("button", { name: "Monthly budget", exact: true })
		.click();
	await target.fill("640");
	await page.getByRole("button", { name: "Save budget", exact: true }).click();
	await expect(
		page
			.getByRole("alert")
			.filter({ hasText: "Carry-forward from 2026-10 is invalid." }),
	).toBeVisible();

	await reportingMonth.fill(source);
	const alerts = page.getByRole("button", { name: /^Alerts, [1-9]/ });
	await alerts.click();
	const dialog = page.getByRole("dialog", { name: "Your alerts" });
	const invalid = dialog.getByText(
		"This month's available savings no longer cover what was carried forward.",
		{ exact: false },
	);
	await expect(invalid).toBeVisible();
	await shoot(page, `${slug}/carry-forward-alert`, {
		clip: dialog,
		annotate: [
			{ target: invalid, badge: "below" },
			{
				target: dialog.getByRole("button", { name: "Mark read" }).first(),
				badge: "left",
			},
		],
	});
});
