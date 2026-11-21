import { api } from "../../convex/_generated/api";
import { expect, fixturePage, test } from "./fixture";
import { shoot } from "./shoot";

const slug = "funds";
const month = "2026-10";
const previous = "2026-09";

test("capture creating, reserving, and using funds", async ({
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
	await invoke(api.budgets.saveFund, {
		spaceId,
		startMonth: previous,
		effectiveMonth: previous,
		name: "Summer vacation",
		openingBalance: 30000,
		targetAmount: 150000,
		monthlyAmount: 15000,
		revision: 0,
	});
	const previousFunds = await invoke(api.budgets.funds, {
		spaceId,
		month: previous,
	});
	await invoke(api.budgets.savePlan, {
		spaceId,
		month: previous,
		expectedIncome: 450000,
		savingsTarget: 65000,
		limits: Object.entries({
			Housing: 185000,
			Groceries: 65000,
			"Dining out": 27500,
			Entertainment: 12500,
			Transport: 38000,
			Other: 42000,
		}).map(([name, amount]) => ({ categoryId: categoryId(name), amount })),
		fundSignature: previousFunds.signature,
		revision: 0,
	});
	for (const [description, date, amount, category] of [
		["September rent", "2026-09-01", 185000, "Housing"],
		["September pay", "2026-09-03", -450000, ""],
		["Maple Market", "2026-09-12", 41750, "Groceries"],
		["Westside Auto & Fuel", "2026-09-20", 31250, "Transport"],
		["Juniper Mutual", "2026-10-12", 12000, "Transport"],
		["Juniper Mutual refund", "2026-10-15", -2000, "Transport"],
	] as const) {
		await invoke(api.budgets.saveTransaction, {
			spaceId,
			accountId: account._id,
			description,
			amount,
			date,
			kind: category ? "purchase" : "income",
			splits: category ? [{ categoryId: categoryId(category), amount }] : [],
			pending: false,
			note: "",
			revision: 0,
		});
	}

	await page.setViewportSize({ width: 1280, height: 1100 });
	await page.clock.setFixedTime(new Date(`${month}-18T12:00:00Z`));
	await page.goto(fixturePage);
	const fundsPage = page.getByRole("button", { name: "Funds", exact: true });
	await fundsPage.click();
	await expect(
		page.getByRole("heading", { name: "Summer vacation" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Add fund", exact: true }).click();
	const form = page.getByRole("dialog", { name: "Add fund" });
	const fundType = form.getByLabel("Fund type");
	await expect(fundType.locator("option")).toHaveText([
		"Savings goal with a target month",
		"Savings goal with a monthly amount",
		"Repeating payment",
	]);
	await form.getByLabel("Fund name").fill("Car insurance");
	await fundType.selectOption({ label: "Repeating payment" });
	await form.getByLabel("Payment amount").fill("600");
	await form.getByLabel("Next payment month").fill("2027-01");
	await form.getByLabel("Pay every (months)").fill("6");
	await form.getByLabel("Amount already saved").fill("200");
	const saveFund = form.getByRole("button", { name: "Save fund" });
	await form.getByRole("heading", { name: "Add fund" }).click();
	await shoot(page, `${slug}/add-fund`, {
		clip: form,
		annotate: [
			{ target: fundType, badge: "left" },
			{ target: form.getByLabel("Payment amount"), badge: "left" },
			{ target: form.getByLabel("Next payment month"), badge: "left" },
			{ target: form.getByLabel("Pay every (months)"), badge: "left" },
			{ target: form.getByLabel("Amount already saved"), badge: "left" },
			{ target: saveFund, badge: "right" },
		],
	});
	await saveFund.click();
	await expect(form).toHaveCount(0);
	const insurance = page
		.locator(".fund-card")
		.filter({ hasText: "Car insurance" });
	await expect(insurance.locator(".fund-monthly strong")).toHaveText("$100.00");
	const totals = page.locator(".funds-summary");
	const required = totals.getByText("Required this month", { exact: true });
	const reserved = totals.getByText("Reserved in this budget", { exact: true });
	await expect(totals.getByText("$250.00", { exact: true })).toBeVisible();
	await expect(
		totals.getByText(
			"Save the monthly budget to reserve its current fund amounts.",
		),
	).toBeVisible();
	await shoot(page, `${slug}/reserve-funds`, {
		clip: totals,
		annotate: [
			{ target: required, badge: "right" },
			{ target: reserved, badge: "right" },
		],
	});

	await page
		.getByRole("button", { name: "Monthly budget", exact: true })
		.click();
	await expect(
		page.getByRole("textbox", { name: "Funds", exact: true }),
	).toHaveValue("250.00");
	await page.getByLabel("Monthly savings target", { exact: true }).fill("550");
	const save = page.getByRole("button", { name: "Save budget", exact: true });
	await save.click();
	await expect(page.getByText("Budget saved.", { exact: true })).toBeVisible();
	await save.click();
	await expect(page.getByText("Budget saved.", { exact: true })).toBeVisible();

	await fundsPage.click();
	const balance = insurance
		.locator(".fund-details > div")
		.filter({ hasText: "Reserved balance" })
		.locator("dd");
	const contributed = insurance
		.locator(".fund-details > div")
		.filter({ hasText: "Reserved in 2026-10" })
		.locator("dd");
	const edit = insurance.getByRole("button", { name: "Edit Car insurance" });
	await expect(balance).toHaveText("$300.00");
	await expect(contributed).toHaveText("$100.00");
	await shoot(page, `${slug}/fund-balance`, {
		clip: insurance,
		annotate: [
			{
				target: insurance.getByText("required per month", { exact: true }),
				badge: "right",
			},
			{ target: balance, badge: "left" },
			{ target: contributed, badge: "left" },
			{ target: edit, badge: "left" },
		],
	});
	await edit.click();
	const fundEditor = page.getByRole("dialog", { name: "Edit fund" });
	await expect(
		fundEditor.getByText("Started 2026-10 with $200.00 already saved."),
	).toBeVisible();
	await expect(fundEditor.getByRole("button", { name: /delete/i })).toHaveCount(
		0,
	);
	await fundEditor.getByRole("button", { name: "Cancel", exact: true }).click();

	const transactionPage = page.getByRole("button", {
		name: "Transactions",
		exact: true,
	});
	const linkTransaction = async (description: string, capture = false) => {
		await transactionPage.click();
		await page.getByRole("button", { name: description, exact: true }).click();
		const editor = page.getByRole("dialog", { name: "Transaction details" });
		const fund = editor.getByLabel("Pay from fund for split 1");
		const saveTransaction = editor.getByRole("button", {
			name: "Save transaction",
		});
		await fund.selectOption({ label: "Car insurance" });
		if (capture) {
			const [dialog, classification, saveButton] = await Promise.all([
				editor.boundingBox(),
				editor.getByLabel("Classification").boundingBox(),
				saveTransaction.boundingBox(),
			]);
			if (!dialog || !classification || !saveButton)
				throw new Error("The transaction form must be visible.");
			const top = Math.floor(classification.y) - 32;
			await shoot(page, `${slug}/link-a-payment`, {
				clip: {
					x: Math.floor(dialog.x),
					y: top,
					width: Math.ceil(dialog.width),
					height: Math.ceil(saveButton.y + saveButton.height) - top,
				},
				annotate: [
					{ target: fund, badge: "left" },
					{ target: saveTransaction, badge: "left" },
				],
			});
		}
		await saveTransaction.click();
		await expect(editor).toHaveCount(0);
	};
	await linkTransaction("Juniper Mutual", true);
	await fundsPage.click();
	await expect(balance).toHaveText("$180.00");
	await linkTransaction("Juniper Mutual refund");
	await fundsPage.click();
	await expect(balance).toHaveText("$200.00");
	await edit.click();
	await fundEditor.getByLabel("Payment amount").fill("650");
	await fundEditor.getByRole("button", { name: "Save fund" }).click();
	await expect(insurance.locator(".fund-monthly strong")).toHaveText("$112.50");
	await expect(balance).toHaveText("$200.00");
});
