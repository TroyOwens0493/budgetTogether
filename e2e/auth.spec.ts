import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "Sign in", exact: true }),
	).toBeVisible();
});

test("opens registration and returns to sign in", async ({ page }) => {
	await expect(
		page.getByRole("textbox", { name: "Email", exact: true }),
	).toBeVisible();
	await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
	await page
		.getByRole("button", { name: "Create an account", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Create your account" }),
	).toBeVisible();
	await expect(
		page.getByRole("textbox", { name: "Name", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Back to sign in" }).click();
	await expect(
		page.getByRole("button", { name: "Sign in", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("textbox", { name: "Name", exact: true }),
	).toHaveCount(0);
});

test("opens password reset and returns to sign in", async ({ page }) => {
	await page.getByRole("button", { name: "Forgot password?" }).click();
	await expect(
		page.getByRole("heading", { name: "Reset your password" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Send reset link" }),
	).toBeVisible();
	await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Back to sign in" }).click();
	await expect(
		page.getByRole("button", { name: "Sign in", exact: true }),
	).toBeVisible();
});
