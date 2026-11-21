import { api } from "../../convex/_generated/api";
import { expect, fixturePage, test } from "./fixture";
import { shoot } from "./shoot";

const slug = "monthly-budget";
const month = "2026-10";

test("capture planning and saving a monthly budget", async ({
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
	for (const fund of [
		{
			name: "Car insurance",
			targetAmount: 60000,
			openingBalance: 20000,
			targetMonth: "2027-01",
			intervalMonths: 6,
		},
		{
			name: "Summer vacation",
			targetAmount: 120000,
			openingBalance: 30000,
			monthlyAmount: 15000,
		},
	]) {
		await invoke(api.budgets.saveFund, {
			spaceId,
			startMonth: month,
			effectiveMonth: month,
			revision: 0,
			...fund,
		});
	}
	for (const [description, amount, name] of [
		["October rent", 180000, "Housing"],
		["Paycheck", -475000, ""],
		["Maple Market", 11842, "Groceries"],
		["Cedar Auto Repair", 14863, "Transport"],
	] as const) {
		await invoke(api.budgets.saveTransaction, {
			spaceId,
			accountId: account._id,
			description,
			amount,
			date: `${month}-03`,
			kind: name ? "purchase" : "income",
			splits: name ? [{ categoryId: categoryId(name), amount }] : [],
			pending: false,
			note: "",
			revision: 0,
		});
	}

	await page.setViewportSize({ width: 1280, height: 1100 });
	await page.clock.setFixedTime(new Date(`${month}-18T12:00:00Z`));
	await page.goto(fixturePage);
	await page
		.getByRole("button", { name: "Monthly budget", exact: true })
		.click();
	const spending = page.locator(".plan-grid > section");
	const summary = page.locator(".plan-summary");
	const income = page.getByLabel("Expected take-home income", { exact: true });
	const target = page.getByLabel("Monthly savings target", { exact: true });
	const funds = page.getByRole("textbox", { name: "Funds", exact: true });
	const save = page.getByRole("button", { name: "Save budget", exact: true });
	const left = summary.locator(".total dd");
	await income.fill("4750");
	for (const [name, value] of Object.entries({
		Housing: "1800",
		Groceries: "650",
		"Dining out": "350",
		Entertainment: "150",
		Transport: "425",
		Other: "475",
	})) {
		await page.getByLabel(name, { exact: true }).fill(value);
	}
	await expect(funds).toHaveValue("250.00");
	await target.fill("650");
	await expect(left).toHaveText("$0.00");
	await expect(save).toBeEnabled();
	await spending.getByRole("heading", { name: "Monthly spending" }).click();
	await shoot(page, `${slug}/monthly-spending`, {
		clip: spending,
		annotate: [
			{ target: income, badge: "above" },
			{ target: page.getByLabel("Groceries", { exact: true }), badge: "left" },
			{ target: funds, badge: "left" },
			{ target, badge: "left" },
		],
	});
	await shoot(page, `${slug}/balanced-plan`, {
		clip: summary,
		annotate: [
			{ target: summary.locator(".big-number"), badge: "right" },
			{ target: left, badge: "left" },
			{ target: save, badge: "left" },
		],
	});

	await income.fill("4750.123");
	await expect(
		page.getByText(
			"Enter zero or a positive amount with at most two decimal places.",
		),
	).toBeVisible();
	await expect(left).toHaveText("Check amounts");
	await expect(save).toBeDisabled();
	await shoot(page, `${slug}/check-amounts`, {
		clip: summary,
		annotate: [
			{ target: left, badge: "left" },
			{
				target: summary.getByText(
					"Check the amounts before saving your budget.",
				),
				badge: "above",
			},
		],
	});
	await income.fill("4650");
	await expect(left).toHaveText("-$100.00");
	await expect(save).toBeDisabled();
	await income.fill("4750");
	await save.click();
	await expect(page.getByText("Budget saved.", { exact: true })).toBeVisible();

	const reportingMonth = page.getByLabel("Reporting month");
	await reportingMonth.fill("2026-11");
	await expect(
		page.getByRole("button", { name: "Copy limits to 2026-12" }),
	).toBeVisible();
	const loadCurrent = page.getByRole("button", { name: "Load current plan" });
	if (await loadCurrent.isVisible()) await loadCurrent.click();
	await expect(page.getByLabel("Groceries", { exact: true })).toHaveValue(
		"650.00",
	);
	await expect(target).toHaveValue("650.00");
	await expect(funds).toHaveValue("250.00");
	await expect
		.poll(async () => {
			const { plan, fundPlan } = await invoke(api.budgets.dashboard, {
				spaceId,
				month: "2026-11",
			});
			return [plan?.saved, fundPlan.contributed];
		})
		.toEqual([false, 0]);
	await reportingMonth.fill(month);
	await page.getByRole("button", { name: "Copy limits to 2026-11" }).click();
	await expect(
		page.getByText(
			"Next month already has a budget. Open it to make changes there.",
		),
	).toBeVisible();
	await reportingMonth.fill("2026-11");
	await page.getByRole("button", { name: "Copy limits to 2026-12" }).click();
	await expect(
		page.getByText(
			"Limits copied. Open next month to finish and save your budget.",
		),
	).toBeVisible();
});
