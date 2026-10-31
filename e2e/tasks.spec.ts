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
	await page.getByRole("combobox", { name: "Budget space" }).selectOption({
		label: space,
	});
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
		.getByRole("button", { name: "Accounts & settings", exact: true })
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
		bob.getByRole("combobox", { name: "Budget space" }).locator("option"),
	).toHaveCount(2);
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
		const selector = page.getByRole("combobox", { name: "Budget space" });
		await expect(selector.locator("option")).toHaveCount(1);
		await expect(selector.locator("option:checked")).toHaveText("My budget");
		await page.reload();
		await expect(selector.locator("option")).toHaveCount(1);
	}
	expect(errors).toEqual([]);
});

async function saveBudget(page: Page) {
	const button = page.getByRole("button", { name: "Save budget", exact: true });
	await expect(button).toBeEnabled();
	await button.click();
	await expect(page.getByText("Budget saved.", { exact: true })).toBeVisible();
}

function allocationForm(page: Page, name = "Alice") {
	return page.locator("form").filter({
		has: page.getByLabel(`${name}'s personal amount`, { exact: true }),
	});
}

async function saveAmount(page: Page, amount: string) {
	const form = allocationForm(page);
	await form
		.getByLabel("Alice's personal amount", { exact: true })
		.fill(amount);
	await form.getByRole("button", { name: "Save amount" }).click();
	await expect(
		page.getByText("Personal funding saved.", { exact: true }),
	).toBeVisible();
}

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
		await allocationForm(alice)
			.getByRole("button", { name: "Save amount" })
			.click();
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

test("personal funding changes both budgets and requires each budget to be saved again", async ({
	household: { alice },
}) => {
	await openMonthly(alice);
	await alice
		.getByLabel("Expected take-home income", { exact: true })
		.fill("1000.00");
	await alice.getByLabel("Groceries", { exact: true }).fill("1000.00");
	await saveBudget(alice);
	await alice
		.getByRole("combobox", { name: "Budget space" })
		.selectOption({ label: "My budget" });
	await saveBudget(alice);
	await alice
		.getByRole("combobox", { name: "Budget space" })
		.selectOption({ label: "Shared" });
	await saveAmount(alice, "125.50");
	await expect(
		alice.getByRole("button", { name: "Load current plan" }),
	).toBeVisible();
	await alice.getByRole("button", { name: "Load current plan" }).click();
	await expect(
		alice.getByRole("button", { name: "Save budget", exact: true }),
	).toBeDisabled();
	await alice.getByLabel("Groceries", { exact: true }).fill("874.50");
	await saveBudget(alice);

	await alice
		.getByRole("combobox", { name: "Budget space" })
		.selectOption({ label: "My budget" });
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
	await alice
		.getByRole("combobox", { name: "Budget space" })
		.selectOption({ label: "Shared" });
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
	await expect(
		alice.getByRole("button", { name: "Load current plan" }),
	).toBeVisible();
	await alice.getByRole("button", { name: "Load current plan" }).click();
	await expect(alice.getByLabel("Groceries", { exact: true })).toHaveValue(
		"700.00",
	);
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
		bob.getByRole("alert").filter({ hasText: "Alice's funding changed" }),
	).toBeVisible();
	await expect(
		allocationForm(bob).getByLabel("Alice's personal amount", { exact: true }),
	).toHaveValue("75.00");
	await expect(
		allocationForm(bob).getByRole("button", { name: "Save amount" }),
	).toBeDisabled();
	await bob.getByRole("button", { name: "Load current amount" }).click();
	await expect(
		allocationForm(bob).getByLabel("Alice's personal amount", { exact: true }),
	).toHaveValue("125.50");
	await saveAmount(bob, "150.00");
	await expect(
		alice.getByRole("button", { name: "Load current amount" }),
	).toBeVisible();
	await alice.getByRole("button", { name: "Load current amount" }).click();
	await expect(
		allocationForm(alice).getByLabel("Alice's personal amount", {
			exact: true,
		}),
	).toHaveValue("150.00");
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
			hasText: "This record changed. Reload its current values before saving.",
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
