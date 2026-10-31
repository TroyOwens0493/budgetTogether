import { expect, test } from "@playwright/test";

test("pending and uncertain classifications are visible and manual review persists", async ({
	page,
	request,
	baseURL,
}) => {
	if (!baseURL) throw new Error("Missing fixture origin.");
	const response = await request.post("/__fixture/classification");
	expect(response.ok()).toBe(true);
	const { id } = await response.json();
	await page.context().addCookies([
		{
			name: "bt-test-session",
			value: `${id}:alice`,
			url: baseURL,
			httpOnly: true,
		},
	]);
	try {
		await page.goto("/e2e/fixtures/index.html");
		await page.getByLabel("Reporting month").fill("2099-05");
		await expect(page.getByText(/Totals may change/)).toBeVisible();
		await page
			.getByRole("button", { name: "Transactions", exact: true })
			.click();
		await expect(
			page.getByText("Classification pending", { exact: true }),
		).toBeVisible();
		await expect(page.getByText("Needs review", { exact: true })).toBeVisible();
		await page
			.getByRole("button", { name: "Market purchase", exact: true })
			.click();
		await expect(
			page.getByText("Needs review. Check the type and category, then save."),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Save transaction", exact: true })
			.click();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(page.getByText("Needs review", { exact: true })).toHaveCount(
			0,
		);
		await page.reload();
		await page
			.getByRole("button", { name: "Transactions", exact: true })
			.click();
		await page.getByLabel("Reporting month").fill("2099-05");
		await expect(page.getByText("Needs review", { exact: true })).toHaveCount(
			0,
		);
		await page
			.getByRole("button", { name: "Awaiting classification", exact: true })
			.click();
		await expect(page.getByText(/Classification is pending/)).toBeVisible();
		await page
			.getByRole("button", { name: "Save transaction", exact: true })
			.click();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(
			page.getByText("Classification pending", { exact: true }),
		).toHaveCount(0);
	} finally {
		await page.close();
		await request.delete(`/__fixture/${id}`);
	}
});
