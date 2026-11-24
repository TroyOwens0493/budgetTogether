import { test as base, expect, type Page } from "@playwright/test";

const month = "2099-05";
const test = base.extend<{
	household: { alice: Page; bob: Page };
	overspending: boolean;
}>({
	overspending: [false, { option: true }],
	household: async ({ browser, request, baseURL, overspending }, use) => {
		if (!baseURL) throw new Error("The task fixture needs a base URL.");
		const response = await request.post(
			overspending ? "/__fixture/overspending" : "/__fixture",
		);
		expect(response.ok()).toBe(true);
		const { id } = await response.json();
		const contexts = await Promise.all(
			["alice", "bob"].map(async (actor) => {
				const context = await browser.newContext({
					baseURL,
					timezoneId: "UTC",
				});
				await context.addCookies([
					{
						name: "bt-test-session",
						value: `${id}:${actor}`,
						url: baseURL,
						httpOnly: true,
					},
				]);
				return context;
			}),
		);
		try {
			const [alice, bob] = await Promise.all(contexts.map((c) => c.newPage()));
			await use({ alice, bob });
		} finally {
			await Promise.all(contexts.map((context) => context.close()));
			const cleanup = await request.delete(`/__fixture/${id}`);
			expect(cleanup.ok()).toBe(true);
		}
	},
});

async function openMonthly(page: Page, space = "Shared") {
	await page.goto("/e2e/fixtures/index.html");
	await page
		.getByRole("button", {
			name: space === "Shared" ? "Shared" : "Personal",
			exact: true,
		})
		.click();
	await page.getByLabel("Reporting month").fill(month);
	await page
		.getByRole("button", { name: "Monthly budget", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Monthly spending" }),
	).toBeVisible();
}

test("leaving deletes the shared budget for both open sessions and cancel keeps it", async ({
	household: { alice, bob },
}) => {
	const errors: string[] = [];
	for (const page of [alice, bob])
		page.on("pageerror", (error) => errors.push(error.message));
	await openMonthly(alice);
	await openMonthly(bob);
	await alice
		.getByRole("button", { name: "Accounts & sharing", exact: true })
		.click();
	await alice
		.getByRole("button", { name: "Leave shared budget", exact: true })
		.click();
	const dialog = alice.getByRole("dialog", {
		name: "Leave shared budget",
		exact: true,
	});
	await expect(dialog).toContainText("for both people");
	await expect(dialog).toContainText("This cannot be undone");
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(
		bob.getByRole("button", { name: "Shared", exact: true }),
	).toHaveCount(1);
	await alice
		.getByRole("button", { name: "Leave shared budget", exact: true })
		.click();
	await dialog
		.getByRole("button", {
			name: "Leave and delete shared budget",
			exact: true,
		})
		.click();
	for (const page of [alice, bob]) {
		const toggle = page.getByRole("button", { name: "Shared", exact: true });
		await expect(toggle).toHaveCount(0);
		await expect(page.locator(".topbar")).toContainText("Personal");
		await page.reload();
		await expect(toggle).toHaveCount(0);
	}
	expect(errors).toEqual([]);
});

async function saveBudget(page: Page) {
	const button = page.getByRole("button", { name: "Save budget", exact: true });
	await expect(button).toBeEnabled();
	await button.click();
	await expect(page.getByText("Budget saved.", { exact: true })).toBeVisible();
}

async function addInsuranceFund(page: Page, opening = "0.00") {
	await page.getByRole("button", { name: "Funds", exact: true }).click();
	await page.getByRole("button", { name: "Add fund", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Add fund", exact: true });
	await dialog.getByLabel("Fund name", { exact: true }).fill("Insurance");
	await dialog
		.getByLabel("Fund type", { exact: true })
		.selectOption("repeating");
	await dialog.getByLabel("Payment amount", { exact: true }).fill("600.00");
	await dialog
		.getByLabel("Next payment month", { exact: true })
		.fill("2099-07");
	await dialog.getByLabel("Pay every (months)").fill("6");
	await dialog
		.getByLabel("Amount already saved", { exact: false })
		.fill(opening);
	await dialog.getByRole("button", { name: "Save fund", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	return page.getByRole("article").filter({
		has: page.getByRole("heading", { name: "Insurance", exact: true }),
	});
}

test("funds set automatic monthly amounts, share updates, and reserve each saved month once", async ({
	household: { alice, bob },
}) => {
	await openMonthly(alice);
	await expect(alice.getByLabel("Funds", { exact: true })).toHaveCount(0);
	let card = await addInsuranceFund(alice);
	await expect(card.locator(".fund-monthly")).toHaveText(
		"$200.00required per month",
	);
	await alice.getByRole("button", { name: "Add fund", exact: true }).click();
	const dialog = alice.getByRole("dialog", { name: "Add fund", exact: true });
	await dialog.getByLabel("Fund name", { exact: true }).fill("Vehicle");
	await dialog.getByLabel("Goal amount", { exact: true }).fill("15000");
	await dialog
		.getByLabel("Amount already saved", { exact: false })
		.fill("2000");
	await dialog.getByLabel("Target month", { exact: true }).fill("2099-10");
	await dialog.getByRole("button", { name: "Save fund", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await alice
		.getByRole("button", { name: "Monthly budget", exact: true })
		.click();
	await expect(alice.getByLabel("Funds", { exact: true })).toHaveValue(
		"2366.67",
	);
	await expect(alice.getByLabel("Funds", { exact: true })).toHaveAttribute(
		"readonly",
		"",
	);
	await alice
		.getByLabel("Expected take-home income", { exact: true })
		.fill("5000");
	await alice.getByLabel("Housing", { exact: true }).fill("2000");
	await alice
		.getByLabel("Monthly savings target", { exact: true })
		.fill("633.33");
	await saveBudget(alice);
	await saveBudget(alice);
	await alice.getByRole("button", { name: "Funds", exact: true }).click();
	card = alice.getByRole("article").filter({
		has: alice.getByRole("heading", { name: "Insurance", exact: true }),
	});
	await expect(card.locator(".fund-details")).toContainText(
		"Reserved balance$200.00",
	);
	await openMonthly(bob);
	await expect(bob.getByLabel("Funds", { exact: true })).toHaveValue("2366.67");
	await bob.getByRole("button", { name: "Funds", exact: true }).click();
	await bob
		.getByRole("button", { name: "Edit Insurance", exact: true })
		.click();
	const edit = bob.getByRole("dialog", { name: "Edit fund", exact: true });
	await edit.getByLabel("Payment amount", { exact: true }).fill("900");
	await edit.getByRole("button", { name: "Save fund", exact: true }).click();
	await expect(edit).toHaveCount(0);
	await alice
		.getByRole("button", { name: "Monthly budget", exact: true })
		.click();
	await expect(alice.getByLabel("Funds", { exact: true })).toHaveValue(
		"2466.67",
	);
	await expect(
		alice.getByRole("button", { name: "Save budget", exact: true }),
	).toBeDisabled();
	await alice
		.getByLabel("Monthly savings target", { exact: true })
		.fill("533.33");
	await saveBudget(alice);
	await alice.reload();
	await alice.getByLabel("Reporting month").fill(month);
	await alice.getByRole("button", { name: "Funds", exact: true }).click();
	await expect(card.locator(".fund-details")).toContainText(
		"Reserved balance$300.00",
	);
	await alice.getByLabel("Reporting month").fill("2099-06");
	await expect(card.locator(".fund-monthly")).toHaveText(
		"$300.00required per month",
	);
	await expect(card.locator(".fund-details")).toContainText(
		"Reserved balance$300.00",
	);
	await expect(alice.getByRole("checkbox", { name: /pause/i })).toHaveCount(0);
});

test("linking a purchase to a fund updates its balance and keeps the category budget available", async ({
	household: { alice },
}) => {
	await openMonthly(alice);
	const card = await addInsuranceFund(alice, "600");
	await expect(card.locator(".fund-details")).toContainText(
		"Reserved balance$600.00",
	);
	await alice
		.getByRole("button", { name: "Transactions", exact: true })
		.click();
	await alice
		.getByRole("button", { name: "Add transaction", exact: true })
		.click();
	const dialog = alice.getByRole("dialog", { name: "Add a transaction" });
	await dialog
		.getByLabel("Description", { exact: true })
		.fill("Insurance premium");
	await dialog
		.getByLabel(
			"Amount (positive for outflow; negative for income or refund)",
			{ exact: true },
		)
		.fill("600");
	await dialog
		.getByLabel("Pay from fund for split 1", { exact: true })
		.selectOption({ label: "Insurance" });
	await dialog
		.getByRole("button", { name: "Save transaction", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);
	await alice.getByRole("button", { name: "Funds", exact: true }).click();
	await expect(card.locator(".fund-details")).toContainText(
		"Reserved balance$0.00",
	);
	await alice.getByRole("button", { name: "Overview", exact: true }).click();
	await expect(alice.locator(".category-row").first()).toContainText(
		"$0.00 of $0.00",
	);
	await expect(
		alice.locator(".summary-card").filter({ hasText: "Money out" }),
	).toContainText("$600.00");
});

function allocationForm(page: Page, name = "Alice") {
	return page.locator("form").filter({
		has: page.getByLabel(`${name}'s personal amount`, { exact: true }),
	});
}

async function saveAmount(page: Page, amount: string) {
	const input = page.getByLabel("Alice's personal amount", { exact: true });
	const previous = Number(await input.inputValue());
	const income = page.getByLabel("Expected take-home income", { exact: true });
	await income.fill(
		(Number(await income.inputValue()) + Number(amount) - previous).toFixed(2),
	);
	await input.fill(amount);
	await saveBudget(page);
}

test("personal funding is part of the budget form and only saves with the budget", async ({
	household: { alice, bob },
}) => {
	await openMonthly(alice);
	await openMonthly(bob);
	const input = alice.getByLabel("Alice's personal amount", { exact: true });
	await alice.getByLabel("Groceries", { exact: true }).fill("100.00");
	await expect(
		allocationForm(alice).getByRole("button", {
			name: "Save budget",
			exact: true,
		}),
	).toBeVisible();
	await expect(alice.getByRole("button", { name: "Save amount" })).toHaveCount(
		0,
	);
	await input.fill("125.50");
	await input.blur();
	await expect(
		bob.getByLabel("Alice's personal amount", { exact: true }),
	).toHaveValue("0.00");
	await expect(
		alice.getByRole("button", { name: "Save budget", exact: true }),
	).toBeDisabled();
	await alice
		.getByLabel("Expected take-home income", { exact: true })
		.fill("225.50");
	await saveBudget(alice);
	await openMonthly(alice);
	await expect(input).toHaveValue("125.50");
	await expect(
		alice.getByLabel("Expected take-home income", { exact: true }),
	).toHaveValue("225.50");
});

test("failed budget saves retain personal funding edits for a retry", async ({
	household: { alice },
}) => {
	await openMonthly(alice);
	let writes = 0;
	await alice.route("**/__fixture/invoke", async (route) => {
		if (route.request().postDataJSON()?.name === "budgets:savePlan") {
			writes++;
			if (writes === 1) {
				await route.fulfill({
					status: 503,
					json: { error: "Save unavailable." },
				});
				return;
			}
		}
		await route.continue();
	});
	const input = alice.getByLabel("Alice's personal amount", { exact: true });
	await alice.getByLabel("Groceries", { exact: true }).fill("100.00");
	await input.fill("125.50");
	await alice
		.getByLabel("Expected take-home income", { exact: true })
		.fill("225.50");
	await alice.getByRole("button", { name: "Save budget", exact: true }).click();
	await expect(
		alice.getByText("Save unavailable.", { exact: true }),
	).toBeVisible();
	await expect(input).toHaveValue("125.50");
	await saveBudget(alice);
	expect(writes).toBe(2);
	await openMonthly(alice);
	await expect(input).toHaveValue("125.50");
});

test("category management opens from the Overview card and updates transaction filters", async ({
	household: { alice },
}) => {
	await openMonthly(alice);
	await alice.getByRole("button", { name: "Overview", exact: true }).click();
	const card = alice.locator("section").filter({
		has: alice.getByRole("heading", {
			name: "Category balances",
			exact: true,
		}),
	});
	await card
		.getByRole("button", { name: "Manage categories", exact: true })
		.click();
	const dialog = alice.getByRole("dialog", {
		name: "Manage categories",
		exact: true,
	});
	await dialog.getByLabel("Name", { exact: true }).fill("Pets");
	await dialog
		.getByRole("button", { name: "Create category", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);
	await expect(card.getByText("Pets", { exact: true })).toBeVisible();
	await card
		.getByRole("button", { name: "Manage categories", exact: true })
		.click();
	await dialog
		.getByLabel("Category", { exact: true })
		.selectOption({ label: "Pets" });
	await dialog.getByLabel("Name", { exact: true }).fill("Pet care");
	await dialog
		.getByRole("button", { name: "Save changes", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);
	await expect(card.getByText("Pet care", { exact: true })).toBeVisible();
	await alice
		.getByRole("button", { name: "Transactions", exact: true })
		.click();
	await expect(
		alice.getByRole("button", { name: "Manage categories", exact: true }),
	).toHaveCount(0);
	await expect(
		alice
			.getByRole("combobox", { name: "Category filter", exact: true })
			.locator("option")
			.filter({ hasText: "Pet care" }),
	).toHaveCount(1);
});

test("Overview opens the monthly plan and saves edits", async ({
	household: { alice },
}) => {
	await openMonthly(alice);
	await alice.getByRole("button", { name: "Overview", exact: true }).click();
	await alice
		.getByRole("button", { name: "Edit monthly plan", exact: true })
		.click();
	await expect(
		alice.getByRole("heading", { name: "Monthly spending", exact: true }),
	).toBeVisible();
	await alice
		.getByLabel("Expected take-home income", { exact: true })
		.fill("100.00");
	await alice.getByLabel("Groceries", { exact: true }).fill("100.00");
	await saveBudget(alice);
	await openMonthly(alice);
	await expect(alice.getByLabel("Groceries", { exact: true })).toHaveValue(
		"100.00",
	);
});

test("Overview can edit an older dashboard response without losing existing funding", async ({
	household: { alice },
}) => {
	await openMonthly(alice);
	await saveAmount(alice, "125.50");
	let legacyResponse = true;
	const savedArguments: Record<string, unknown>[] = [];
	await alice.route("**/__fixture/invoke", async (route) => {
		const request = route.request().postDataJSON();
		if (request.name === "budgets:savePlan") savedArguments.push(request.args);
		if (request.name === "budgets:dashboard" && legacyResponse) {
			const response = await route.fetch();
			const result = await response.json();
			delete result.value.personalFunding;
			await route.fulfill({ response, json: result });
			return;
		}
		await route.continue();
	});
	await openMonthly(alice);
	await alice.getByRole("button", { name: "Overview", exact: true }).click();
	await alice
		.getByRole("button", { name: "Edit monthly plan", exact: true })
		.click();
	await expect(
		alice.getByRole("heading", { name: "Monthly spending", exact: true }),
	).toBeVisible();
	await expect(
		alice.getByLabel("Alice's personal amount", { exact: true }),
	).toHaveCount(0);
	await saveBudget(alice);
	expect(savedArguments).toHaveLength(1);
	expect(savedArguments[0]).not.toHaveProperty("personalFunding");
	await alice.getByLabel("Groceries", { exact: true }).fill("50.00");
	legacyResponse = false;
	await expect(
		alice.getByLabel("Alice's personal amount", { exact: true }),
	).toHaveValue("125.50");
	await expect(alice.getByLabel("Groceries", { exact: true })).toHaveValue(
		"50.00",
	);
	await alice
		.getByLabel("Expected take-home income", { exact: true })
		.fill("175.50");
	await saveBudget(alice);
	await openMonthly(alice);
	await expect(
		alice.getByLabel("Alice's personal amount", { exact: true }),
	).toHaveValue("125.50");
	await expect(alice.getByLabel("Groceries", { exact: true })).toHaveValue(
		"50.00",
	);
});

test.describe("budget overspending notifications", () => {
	test.use({ overspending: true });

	test("stays until dismissed and saves dismissal separately for each partner", async ({
		household: { alice, bob },
	}) => {
		await openMonthly(alice);
		const notice = alice.getByRole("alert").filter({
			hasText: "Groceries: over budget",
		});
		await expect(notice).toBeVisible();
		await expect(notice).toHaveClass(/\berror\b/);
		// Housing is exactly at its limit; pending spending must not trigger a notice.
		await expect(alice.locator(".dismissible-banner")).toHaveCount(1);
		await alice.clock.install();
		await alice.clock.fastForward("01:00");
		await expect(notice).toBeVisible();
		await alice.getByRole("button", { name: "Overview", exact: true }).click();
		await expect(notice).toHaveCount(0);
		await alice
			.getByRole("button", { name: "Monthly budget", exact: true })
			.click();
		await expect(notice).toBeVisible();
		await notice.getByRole("button", { name: /Dismiss/ }).click();
		await expect(notice).toHaveCount(0);
		await alice.clock.resume();
		await openMonthly(alice);
		await expect(
			alice.getByRole("button", { name: "Alerts, 1 unread" }),
		).toBeVisible();
		await expect(notice).toHaveCount(0);
		await openMonthly(bob);
		await expect(
			bob.getByRole("alert").filter({ hasText: "Groceries: over budget" }),
		).toBeVisible();
	});
});

test("a balanced monthly plan saves in one step and survives reopening and reload", async ({
	household: { alice },
}) => {
	await openMonthly(alice);
	await expect(
		alice.getByRole("button", { name: /activate|save draft/i }),
	).toHaveCount(0);
	await alice
		.getByLabel("Expected take-home income", { exact: true })
		.fill("1500.25");
	await expect(
		alice.getByRole("button", { name: "Save budget", exact: true }),
	).toBeDisabled();
	await alice.getByLabel("Housing", { exact: true }).fill("1000.00");
	await alice.getByLabel("Groceries", { exact: true }).fill("250.00");
	await alice
		.getByLabel("Monthly savings target", { exact: true })
		.fill("250.25");
	await saveBudget(alice);
	await expect(alice.getByLabel("Groceries", { exact: true })).toHaveValue(
		"250.00",
	);

	await alice.reload();
	await alice.getByLabel("Reporting month").fill(month);
	await alice
		.getByRole("button", { name: "Monthly budget", exact: true })
		.click();
	for (const [label, value] of [
		["Expected take-home income", "1500.25"],
		["Housing", "1000.00"],
		["Groceries", "250.00"],
		["Monthly savings target", "250.25"],
	])
		await expect(alice.getByLabel(label, { exact: true })).toHaveValue(value);
	// A second save must use the new revision rather than the original one.
	await alice.getByLabel("Housing", { exact: true }).fill("950.00");
	await alice.getByLabel("Groceries", { exact: true }).fill("300.00");
	await saveBudget(alice);
	await openMonthly(alice);
	await expect(alice.getByLabel("Groceries", { exact: true })).toHaveValue(
		"300.00",
	);
});

test("invalid plan and funding amounts cannot save the last valid total", async ({
	household: { alice },
}) => {
	await openMonthly(alice);
	await alice
		.getByLabel("Expected take-home income", { exact: true })
		.fill("100.00");
	await alice.getByLabel("Groceries", { exact: true }).fill("100.00");
	await saveBudget(alice);
	const writes: string[] = [];
	alice.on("request", (request) => {
		if (
			["budgets:savePlan", "personalAllocations:save"].includes(
				request.postDataJSON()?.name,
			)
		)
			writes.push(request.url());
	});
	for (const [label, invalid] of [
		["Expected take-home income", "100.001"],
		["Groceries", "oops"],
		["Monthly savings target", "-1.00"],
	]) {
		const input = alice.getByLabel(label, { exact: true });
		const previous = await input.inputValue();
		await input.fill(invalid);
		const save = alice.getByRole("button", {
			name: "Save budget",
			exact: true,
		});
		if (await save.isEnabled()) await save.click();
		else await expect(save).toBeDisabled();
		await expect(input).toHaveAttribute("aria-invalid", "true");
		await expect(
			alice
				.getByRole("alert")
				.filter({ hasText: "Enter zero or a positive amount" }),
		).toBeVisible();
		await input.fill(previous);
	}
	const personal = alice.getByLabel("Alice's personal amount", { exact: true });
	for (const invalid of ["12.345", "-1.00", ""]) {
		await personal.fill(invalid);
		await personal.blur();
		await expect(personal).toHaveAttribute("aria-invalid", "true");
	}
	expect(writes).toEqual([]);
	await openMonthly(alice);
	await expect(alice.getByLabel("Groceries", { exact: true })).toHaveValue(
		"100.00",
	);
	await expect(
		alice.getByLabel("Monthly savings target", { exact: true }),
	).toHaveValue("0.00");
	await expect(personal).toHaveValue("0.00");
});

test("personal funding saves with the shared budget and requires the personal budget to be saved again", async ({
	household: { alice },
}) => {
	await openMonthly(alice);
	await alice
		.getByLabel("Expected take-home income", { exact: true })
		.fill("1000.00");
	await alice.getByLabel("Groceries", { exact: true }).fill("1000.00");
	await saveBudget(alice);
	await alice.getByRole("button", { name: "Personal", exact: true }).click();
	await saveBudget(alice);
	await alice.getByRole("button", { name: "Shared", exact: true }).click();
	await alice
		.getByLabel("Alice's personal amount", { exact: true })
		.fill("125.50");
	await expect(
		alice.getByRole("button", { name: "Save budget", exact: true }),
	).toBeDisabled();
	await alice.getByLabel("Groceries", { exact: true }).fill("874.50");
	await saveBudget(alice);
	await expect(
		alice.getByRole("button", { name: "Load current plan" }),
	).toHaveCount(0);

	await alice.getByRole("button", { name: "Personal", exact: true }).click();
	await expect(
		alice.getByLabel("Expected take-home income", { exact: true }),
	).toHaveCount(0);
	await expect(
		alice.getByText(/Your personal allocation is \$125\.50/),
	).toBeVisible();
	await alice.getByLabel("Groceries", { exact: true }).fill("100.00");
	await alice
		.getByLabel("Monthly savings target", { exact: true })
		.fill("25.50");
	await saveBudget(alice);
	await openMonthly(alice, "My budget");
	await expect(alice.getByLabel("Groceries", { exact: true })).toHaveValue(
		"100.00",
	);
	await alice.getByRole("button", { name: "Shared", exact: true }).click();
	await expect(
		alice.getByLabel("Alice's personal amount", { exact: true }),
	).toHaveValue("125.50");
	await expect(alice.getByLabel("Groceries", { exact: true })).toHaveValue(
		"874.50",
	);
});

test("two members keep unsaved plan edits until they load the current revision", async ({
	household: { alice, bob },
}) => {
	await openMonthly(alice);
	await alice
		.getByLabel("Expected take-home income", { exact: true })
		.fill("1000.00");
	await alice.getByLabel("Groceries", { exact: true }).fill("1000.00");
	await saveBudget(alice);
	await openMonthly(bob);
	await bob.getByLabel("Groceries", { exact: true }).fill("900.00");
	await bob
		.getByLabel("Monthly savings target", { exact: true })
		.fill("100.00");
	await alice.getByLabel("Groceries", { exact: true }).fill("800.00");
	await alice
		.getByLabel("Monthly savings target", { exact: true })
		.fill("200.00");
	await saveBudget(alice);
	await expect(
		bob.getByRole("alert").filter({ hasText: "This plan changed" }),
	).toBeVisible();
	await expect(bob.getByLabel("Groceries", { exact: true })).toHaveValue(
		"900.00",
	);
	await expect(
		bob.getByRole("button", { name: "Save budget", exact: true }),
	).toBeDisabled();
	await bob.getByRole("button", { name: "Load current plan" }).click();
	await expect(bob.getByLabel("Groceries", { exact: true })).toHaveValue(
		"800.00",
	);
	await expect(
		bob.getByLabel("Monthly savings target", { exact: true }),
	).toHaveValue("200.00");
	await bob.getByLabel("Groceries", { exact: true }).fill("700.00");
	await bob
		.getByLabel("Monthly savings target", { exact: true })
		.fill("300.00");
	await saveBudget(bob);
	// Alice has no unsaved entries, so her open editor follows Bob's save.
	await expect(alice.getByLabel("Groceries", { exact: true })).toHaveValue(
		"700.00",
	);
	await expect(
		alice.getByRole("button", { name: "Load current plan" }),
	).toHaveCount(0);
	await expect(
		alice.getByRole("button", { name: "Save budget", exact: true }),
	).toBeEnabled();
	await openMonthly(bob);
	await expect(
		bob.getByLabel("Monthly savings target", { exact: true }),
	).toHaveValue("300.00");
});

test("two members must load changed personal funding before saving their own amount", async ({
	household: { alice, bob },
}) => {
	await openMonthly(alice);
	await openMonthly(bob);
	await allocationForm(bob)
		.getByLabel("Alice's personal amount", { exact: true })
		.fill("75.00");
	await saveAmount(alice, "125.50");
	await expect(
		bob.getByRole("alert").filter({ hasText: "This plan changed" }),
	).toBeVisible();
	await expect(
		allocationForm(bob).getByLabel("Alice's personal amount", { exact: true }),
	).toHaveValue("75.00");
	await allocationForm(bob)
		.getByLabel("Alice's personal amount", { exact: true })
		.blur();
	await expect(
		allocationForm(alice).getByLabel("Alice's personal amount", {
			exact: true,
		}),
	).toHaveValue("125.50");
	await bob.getByRole("button", { name: "Load current plan" }).click();
	await expect(
		allocationForm(bob).getByLabel("Alice's personal amount", { exact: true }),
	).toHaveValue("125.50");
	await saveAmount(bob, "150.00");
	await expect(
		allocationForm(alice).getByLabel("Alice's personal amount", {
			exact: true,
		}),
	).toHaveValue("150.00");
	await expect(
		alice.getByRole("button", { name: "Load current plan" }),
	).toHaveCount(0);
	await openMonthly(bob);
	await expect(
		allocationForm(bob).getByLabel("Alice's personal amount", { exact: true }),
	).toHaveValue("150.00");
});

test("a delayed save cannot overwrite a newer plan and can recover in the editor", async ({
	household: { alice, bob },
}) => {
	await openMonthly(alice);
	await alice
		.getByLabel("Expected take-home income", { exact: true })
		.fill("1000.00");
	await alice.getByLabel("Groceries", { exact: true }).fill("1000.00");
	await saveBudget(alice);
	await openMonthly(bob);
	await bob.getByLabel("Groceries", { exact: true }).fill("900.00");
	await bob
		.getByLabel("Monthly savings target", { exact: true })
		.fill("100.00");
	let releaseSave = () => {};
	let saveStarted = () => {};
	const held = new Promise<void>((resolve) => {
		releaseSave = resolve;
	});
	const started = new Promise<void>((resolve) => {
		saveStarted = resolve;
	});
	await bob.route("**/__fixture/invoke", async (route) => {
		if (route.request().postDataJSON()?.name === "budgets:savePlan") {
			saveStarted();
			await held;
		}
		await route.continue();
	});
	try {
		// Hold an actual UI request, rather than call the backend from the test.
		await bob.getByRole("button", { name: "Save budget", exact: true }).click();
		await started;
		await alice.getByLabel("Groceries", { exact: true }).fill("800.00");
		await alice
			.getByLabel("Monthly savings target", { exact: true })
			.fill("200.00");
		await saveBudget(alice);
	} finally {
		releaseSave();
	}
	await expect(
		bob.getByRole("alert").filter({
			hasText: "This changed while you were editing",
		}),
	).toBeVisible();
	await expect(bob.getByLabel("Groceries", { exact: true })).toHaveValue(
		"900.00",
	);
	await bob.getByRole("button", { name: "Load current plan" }).click();
	await expect(bob.getByLabel("Groceries", { exact: true })).toHaveValue(
		"800.00",
	);
	await expect(
		bob.getByLabel("Monthly savings target", { exact: true }),
	).toHaveValue("200.00");
	await bob.getByRole("button", { name: "Dismiss error notification" }).click();
	await saveBudget(bob);
	await openMonthly(alice);
	await expect(alice.getByLabel("Groceries", { exact: true })).toHaveValue(
		"800.00",
	);
});

test("an untouched plan shows a partner's saved changes without loading", async ({
	household: { alice, bob },
}) => {
	await openMonthly(alice);
	await openMonthly(bob);
	await alice
		.getByLabel("Expected take-home income", { exact: true })
		.fill("1000.00");
	await alice.getByLabel("Groceries", { exact: true }).fill("1000.00");
	await saveBudget(alice);
	await expect(bob.getByLabel("Groceries", { exact: true })).toHaveValue(
		"1000.00",
	);
	await expect(
		bob.getByLabel("Expected take-home income", { exact: true }),
	).toHaveValue("1000.00");
	await expect(
		bob.getByRole("alert").filter({ hasText: "This plan changed" }),
	).toHaveCount(0);
	await expect(
		bob.getByRole("button", { name: "Save budget", exact: true }),
	).toBeEnabled();
});

test("a rejected transaction save shows its error inside the open editor", async ({
	household: { alice, bob },
}) => {
	await openMonthly(alice);
	await alice
		.getByRole("button", { name: "Transactions", exact: true })
		.click();
	await alice
		.getByRole("button", { name: "Add transaction", exact: true })
		.click();
	const added = alice.getByRole("dialog", { name: "Add a transaction" });
	await added.getByLabel("Description", { exact: true }).fill("Market");
	await added
		.getByLabel(
			"Amount (positive for outflow; negative for income or refund)",
			{ exact: true },
		)
		.fill("40");
	await added
		.getByRole("button", { name: "Save transaction", exact: true })
		.click();
	await expect(added).toHaveCount(0);
	await openMonthly(bob);
	await bob.getByRole("button", { name: "Transactions", exact: true }).click();
	const editors = await Promise.all(
		[alice, bob].map(async (page) => {
			await page
				.getByRole("button", { name: /Market/ })
				.first()
				.click();
			const dialog = page.getByRole("dialog");
			await dialog
				.getByLabel("Note", { exact: true })
				.fill(`${page === alice ? "Alice" : "Bob"} note`);
			return dialog;
		}),
	);
	await editors[0]
		.getByRole("button", { name: "Save transaction", exact: true })
		.click();
	await expect(editors[0]).toHaveCount(0);
	await editors[1]
		.getByRole("button", { name: "Save transaction", exact: true })
		.click();
	const error = editors[1]
		.getByRole("alert")
		.filter({ hasText: "This changed while you were editing" });
	await expect(error).toBeInViewport();
	await expect(editors[1].getByLabel("Note", { exact: true })).toHaveValue(
		"Bob note",
	);
	// The error stays on the page after closing, and a new dialog starts clean.
	await editors[1]
		.getByRole("button", { name: "Close dialog", exact: true })
		.click();
	const pageError = bob
		.getByRole("alert")
		.filter({ hasText: "This changed while you were editing" });
	await expect(pageError).toBeVisible();
	await bob
		.getByRole("button", { name: "Add transaction", exact: true })
		.click();
	await expect(
		bob.getByRole("dialog", { name: "Add a transaction" }).getByRole("alert"),
	).toHaveCount(0);
	await bob.getByRole("button", { name: "Close dialog", exact: true }).click();
	await pageError
		.getByRole("button", { name: "Dismiss error notification" })
		.click();
	await expect(pageError).toHaveCount(0);
});
