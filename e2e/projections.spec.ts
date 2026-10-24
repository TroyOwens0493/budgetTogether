import { expect, test } from "@playwright/test";

test("age forecasts persist, split the target once, and support a maturing bond", async ({
	browser,
	request,
	baseURL,
}) => {
	if (!baseURL) throw new Error("Missing fixture URL.");
	const response = await request.post("/__fixture");
	const { id } = await response.json();
	const context = await browser.newContext({ baseURL, timezoneId: "UTC" });
	await context.addCookies([
		{
			name: "bt-test-session",
			value: `${id}:alice`,
			url: baseURL,
			httpOnly: true,
		},
	]);
	const invoke = async (name: string, args: unknown) => {
		const result = await context.request.post("/__fixture/invoke", {
			data: { name, args },
		});
		expect(result.ok()).toBe(true);
		return (await result.json()).value;
	};
	try {
		const home = await invoke("budgets:home", {});
		const spaceId = home.spaces.find(
			(space: { type: string }) => space.type === "shared",
		)._id;
		await invoke("budgets:savePlan", {
			spaceId,
			month: new Date().toISOString().slice(0, 7),
			expectedIncome: 100000,
			savingsTarget: 100000,
			limits: [],
			revision: 0,
		});
		const page = await context.newPage();
		await page.goto("/e2e/fixtures/index.html");
		await page
			.getByRole("button", { name: "Projections", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Set up forecast", exact: true })
			.click();
		await page.getByLabel("Current age", { exact: true }).fill("33");
		await page.getByLabel("Forecast to age", { exact: true }).fill("34");
		await page.getByLabel("Additional unlinked cash savings").fill("5000");
		await page.getByRole("button", { name: "Save forecast settings" }).click();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await page
			.getByRole("button", { name: "Add investment", exact: true })
			.click();
		await page
			.getByLabel("Account name", { exact: true })
			.fill("SoFi portfolio");
		await page
			.getByLabel("Investment name", { exact: true })
			.fill("Index fund");
		await page.getByLabel("Current investment value").fill("1000");
		await page.getByLabel("Annual return override (%)").fill("0");
		await page.getByLabel("Monthly investment contribution").fill("400");
		await page
			.getByRole("button", { name: "Save investment", exact: true })
			.click();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(page.locator(".projection-cash .projection-value")).toHaveText(
			"$12,200.00",
		);
		await expect(
			page.locator(".projection-investments .projection-value"),
		).toHaveText("$5,800.00");
		await page.getByLabel("Cash savings forecast month").fill("0");
		await expect(page.locator(".projection-cash .projection-value")).toHaveText(
			"$5,000.00",
		);
		await page.reload();
		await page
			.getByRole("button", { name: "Projections", exact: true })
			.click();
		await expect(page.locator(".projection-cash .projection-value")).toHaveText(
			"$12,200.00",
		);
		await page
			.getByRole("button", { name: "Add holding", exact: true })
			.click();
		await page
			.getByLabel("Investment name", { exact: true })
			.fill("Treasury bond");
		await page
			.getByLabel("Investment type", { exact: true })
			.selectOption("bond");
		await page.getByLabel("Current investment value").fill("900");
		await page.getByLabel("Total bond face value").fill("1000");
		await page.getByLabel("Annual coupon rate (%)").fill("0");
		const maturity = new Date();
		maturity.setUTCMonth(maturity.getUTCMonth() + 1);
		await page
			.getByLabel("Maturity date")
			.fill(maturity.toISOString().slice(0, 10));
		await page
			.getByRole("button", { name: "Save investment", exact: true })
			.click();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(page.locator(".projection-cash .projection-value")).toHaveText(
			"$13,200.00",
		);
		await expect(
			page.locator(".projection-investments .projection-value"),
		).toHaveText("$5,800.00");
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(
			page.getByRole("heading", { name: "Look ahead" }),
		).toBeVisible();
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		);
		expect(overflow).toBe(false);
	} finally {
		await context.close();
		await request.delete(`/__fixture/${id}`);
	}
});
