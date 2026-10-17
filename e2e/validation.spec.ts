import { expect, test } from "@playwright/test";

test("invalid email and blank names cannot send registration requests", async ({
	page,
}) => {
	const requests: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST" && request.url().includes("/api/auth/"))
			requests.push(request.url());
	});
	await page.goto("/");
	await page
		.getByRole("button", { name: "Create an account", exact: true })
		.click();
	await page.getByLabel("Name", { exact: true }).fill("   ");
	await page.getByLabel("Email", { exact: true }).fill("alice@localhost");
	await page.getByLabel("Password", { exact: true }).fill("valid-password-123");
	await page
		.getByRole("button", { name: "Create account", exact: true })
		.click();
	await expect(
		page.getByText("Enter between 1 and 100 characters.", { exact: true }),
	).toBeVisible();
	await page.getByLabel("Name", { exact: true }).fill("Alice");
	await page
		.getByRole("button", { name: "Create account", exact: true })
		.click();
	await expect(
		page.getByText("Enter a valid email address, such as name@example.com.", {
			exact: true,
		}),
	).toBeVisible();
	expect(
		await page
			.getByLabel("Name", { exact: true })
			.evaluate((input: HTMLInputElement) => input.validity.valid),
	).toBe(true);
	await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
		"maxlength",
		"128",
	);
	expect(requests).toEqual([]);
});
