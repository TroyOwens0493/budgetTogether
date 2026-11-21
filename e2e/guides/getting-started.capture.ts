import { api } from "../../convex/_generated/api";
import { expect, fixturePage, test } from "./fixture";
import { shoot } from "./shoot";

const slug = "getting-started";
const month = "2026-10";

test("capture the registration form", async ({ page }) => {
	await page.goto(`${fixturePage}?screen=auth`);
	await page
		.getByRole("button", { name: "Create an account", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Create your account" }),
	).toBeVisible();
	const learn = page.getByRole("link", { name: "Learn", exact: true });
	await expect(learn).toHaveAttribute("href", "/learn");
	await shoot(page, `${slug}/create-account`, {
		clip: page.locator(".auth-card"),
		annotate: [
			{ target: page.getByLabel("Name", { exact: true }), badge: "left" },
			{ target: page.getByLabel("Email", { exact: true }), badge: "left" },
			{ target: page.getByLabel("Password", { exact: true }), badge: "left" },
			{
				target: page.getByRole("button", {
					name: "Create account",
					exact: true,
				}),
				badge: "left",
			},
			{ target: learn, badge: "below" },
		],
	});
});

test("capture the desktop sidebar", async ({ household: { page } }) => {
	await page.goto(fixturePage);
	const learn = page.getByRole("link", { name: "Learn", exact: true });
	await expect(learn).toHaveAttribute("href", "/learn");
	const labels = [
		"Overview",
		"Transactions",
		"Monthly budget",
		"Funds",
		"Projections",
		"Accounts & sharing",
		"Profile",
	];
	await shoot(page, `${slug}/sidebar`, {
		clip: { x: 0, y: 0, width: 270, height: 800 },
		annotate: [
			{
				target: page.getByRole("group", { name: "Budget space" }),
				badge: "right",
			},
			...labels.map((name) => ({
				target: page.getByRole("button", { name, exact: true }),
				badge: "right" as const,
			})),
			{ target: learn, badge: "right" },
		],
	});
});

test("capture the mobile toolbar and menu for a demo household", async ({
	household: { page, invoke },
}) => {
	const home = await invoke(api.budgets.home, {});
	const space = home.spaces.find(({ type }) => type === "shared");
	if (!space) throw new Error("The demo household needs a shared budget.");
	const spaceId = space._id;
	const [categories, accounts] = await Promise.all([
		invoke(api.budgets.categories, { spaceId }),
		invoke(api.accounts.list, { spaceId }),
	]);
	const accountId = accounts[0]._id;
	const findCategory = (name: string) => {
		const category = categories.find((entry) => entry.name === name);
		if (!category) throw new Error(`The demo needs the ${name} category.`);
		return category._id;
	};
	await invoke(api.budgets.saveFund, {
		spaceId,
		startMonth: month,
		effectiveMonth: month,
		name: "Car insurance",
		openingBalance: 8000,
		targetAmount: 48000,
		targetMonth: "2027-01",
		intervalMonths: 6,
		revision: 0,
	});
	const fund = await invoke(api.budgets.funds, { spaceId, month });
	const limits = Object.entries({
		Housing: 155000,
		Groceries: 48000,
		"Dining out": 20000,
		Transport: 34000,
		Other: 71000,
	}).map(([name, amount]) => ({ categoryId: findCategory(name), amount }));
	const expectedIncome = 425000;
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
	for (const [description, day, amount, name] of [
		["October rent", "01", 155000, "Housing"],
		["Paycheck", "03", -425000, ""],
		["Maple Market", "08", 15265, "Groceries"],
		["Corner Bistro", "10", 4890, "Dining out"],
		["Cedar Auto Repair", "14", 29840, "Transport"],
	] as const) {
		await invoke(api.budgets.saveTransaction, {
			spaceId,
			accountId,
			description,
			amount,
			date: `${month}-${day}`,
			kind: name ? "purchase" : "income",
			splits: name ? [{ categoryId: findCategory(name), amount }] : [],
			pending: false,
			note: "",
			revision: 0,
		});
	}

	await page.setViewportSize({ width: 390, height: 800 });
	await page.clock.setFixedTime(new Date(`${month}-18T12:00:00Z`));
	await page.goto(fixturePage);
	const monthPicker = page.getByLabel("Reporting month");
	const open = page.getByRole("button", { name: "Open navigation" });
	const alerts = page.getByRole("button", { name: "Alerts, 2 unread" });
	await expect(monthPicker).toHaveValue(month);
	await expect(alerts).toBeVisible();
	await expect(page.getByText("$4,250.00", { exact: true })).toBeVisible();
	await shoot(page, `${slug}/mobile-toolbar`, {
		clip: { x: 0, y: 0, width: 390, height: 313 },
		annotate: [
			{ target: open, badge: "below" },
			{ target: alerts, badge: "below" },
			{ target: monthPicker, badge: "below" },
		],
	});
	await open.click();
	await shoot(page, `${slug}/mobile-menu`, {
		clip: { x: 0, y: 0, width: 390, height: 553 },
		annotate: [
			{
				target: page.getByRole("link", { name: "Learn", exact: true }),
				badge: "above",
			},
			{
				target: page.getByRole("button", { name: "Close navigation" }),
				badge: "below",
			},
		],
	});
});
