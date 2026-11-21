import { api } from "../../convex/_generated/api";
import { expect, fixturePage, test } from "./fixture";
import { shoot } from "./shoot";

const slug = "settings";

test("capture the settings menu, profile, and change password form", async ({
	household: { page, invoke },
}) => {
	await invoke(api.budgets.setup, {
		name: "Alice Morgan",
		timeZone: "America/Boise",
	});
	await page.goto(fixturePage);
	const menu = page.locator(".sidebar-bottom");
	const settings = menu.getByRole("button", { name: "Settings", exact: true });
	const signOut = menu.getByRole("button", { name: "Sign out", exact: true });
	const box = await menu.boundingBox();
	if (!box) throw new Error("The settings menu is missing.");
	await shoot(page, `${slug}/settings-menu`, {
		clip: {
			x: box.x - 12,
			y: box.y,
			width: box.width + 24,
			height: box.height + 10,
		},
		annotate: [
			{
				target: settings.getByText("Settings", { exact: true }),
				badge: "right",
			},
			{
				target: signOut.getByText("Sign out", { exact: true }),
				badge: "right",
			},
		],
	});

	await settings.click();
	const profile = page.locator("form.panel.narrow");
	const name = profile.getByLabel("Name", { exact: true });
	const timeZone = profile.getByLabel("Time zone", { exact: true });
	const saveProfile = profile.getByRole("button", { name: "Save profile" });
	const changePassword = profile.getByRole("button", {
		name: "Change password",
	});
	await expect(name).toHaveValue("Alice Morgan");
	await expect(profile.getByLabel("Email", { exact: true })).toHaveAttribute(
		"readonly",
		"",
	);
	await expect(timeZone).toHaveValue("America/Boise");
	await shoot(page, `${slug}/profile`, {
		clip: profile,
		annotate: [
			{ target: name, badge: "left" },
			{ target: timeZone, badge: "left" },
			{ target: saveProfile, badge: "left" },
			{ target: changePassword, badge: "right" },
		],
	});

	await changePassword.click();
	const dialog = page.getByRole("dialog", { name: "Change password" });
	const newPassword = dialog.getByLabel("New password");
	await expect(newPassword).toHaveAttribute("minlength", "12");
	await shoot(page, `${slug}/change-password`, {
		clip: dialog,
		annotate: [
			{ target: dialog.getByLabel("Current password"), badge: "left" },
			{ target: newPassword, badge: "left" },
			{
				target: dialog.getByRole("button", { name: "Save password" }),
				badge: "right",
			},
		],
	});
});

test("capture the password reset screens", async ({ page }) => {
	await page.goto(`${fixturePage}?screen=auth`);
	const card = page.locator(".auth-card");
	const forgot = card.getByRole("button", {
		name: "Forgot password?",
		exact: true,
	});
	await shoot(page, `${slug}/sign-in`, {
		clip: card,
		annotate: [{ target: forgot, badge: "left" }],
	});
	await forgot.click();
	await expect(
		card.getByRole("heading", { name: "Reset your password" }),
	).toBeVisible();
	const email = card.getByLabel("Email");
	await email.fill("alice@example.test");
	await email.blur();
	await shoot(page, `${slug}/request-reset`, {
		clip: card,
		annotate: [
			{ target: email, badge: "left" },
			{
				target: card.getByRole("button", { name: "Send reset link" }),
				badge: "left",
			},
		],
	});

	await page.goto(`${fixturePage}?screen=auth&token=demo-reset-link`);
	await expect(
		card.getByRole("heading", { name: "Choose a new password" }),
	).toBeVisible();
	await shoot(page, `${slug}/choose-new-password`, {
		clip: card,
		annotate: [
			{ target: card.getByLabel("Password", { exact: true }), badge: "left" },
			{
				target: card.getByRole("button", { name: "Save password" }),
				badge: "left",
			},
		],
	});
});
