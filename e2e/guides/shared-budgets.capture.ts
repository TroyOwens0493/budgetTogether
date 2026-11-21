import { expect, fixturePage, test } from "./fixture";
import { shoot } from "./shoot";

const slug = "shared-budgets";

test.use({ scenario: "private" });

test("capture a partner invitation from send through acceptance", async ({
	household: { page },
	browser,
	baseURL,
	request,
}) => {
	await page.goto(fixturePage);
	await page
		.getByRole("button", { name: "Accounts & sharing", exact: true })
		.click();
	const invitation = page.locator(".shared-budget-setup");
	const email = invitation.getByLabel("Partner’s email");
	const send = invitation.getByRole("button", { name: "Send invitation" });
	await email.fill("bob@example.test");
	await email.blur();
	await expect(send).toBeEnabled();
	await shoot(page, `${slug}/send-invitation`, {
		clip: invitation,
		annotate: [
			{ target: email, badge: "left" },
			{ target: send, badge: "right" },
		],
	});
	await send.click();
	const expires = invitation.getByText(/^Expires /);
	await expect(expires).toBeVisible();
	await expect(invitation.getByText("Invitation email queued.")).toBeVisible();
	await shoot(page, `${slug}/pending-invitation`, {
		clip: invitation,
		annotate: [
			{ target: expires, badge: "right" },
			{
				target: invitation.getByRole("button", { name: "Resend invitation" }),
				badge: "below",
			},
			{
				target: invitation.getByRole("button", { name: "Cancel invitation" }),
				badge: "right",
			},
		],
	});
	const session = (await page.context().cookies()).find(
		(cookie) => cookie.name === "bt-test-session",
	);
	if (!session || !baseURL)
		throw new Error("Missing invitation fixture session.");
	const [id] = session.value.split(":");
	const invite = await request.get(`/__fixture/invitation/${id}`);
	await expect(invite).toBeOK();
	const { token } = await invite.json();
	const context = await browser.newContext({ baseURL, timezoneId: "UTC" });
	try {
		await context.addCookies([{ ...session, value: `${id}:bob` }]);
		const bob = await context.newPage();
		await bob.goto(`${fixturePage}?invite=${token}`);
		const review = bob.getByRole("main").filter({
			has: bob.getByRole("heading", { name: "Shared budget invitation" }),
		});
		const signedIn = review.getByText(/^You are signed in as bob@example.test/);
		const accept = review.getByRole("button", { name: "Accept invitation" });
		await expect(review).toContainText(
			"Alice invited you to create a shared budget.",
		);
		await shoot(bob, `${slug}/review-invitation`, {
			clip: review,
			annotate: [
				{ target: signedIn, badge: "left" },
				{ target: accept, badge: "left" },
			],
		});
		await accept.click();
		const toggle = bob.getByRole("group", { name: "Budget space" });
		const shared = toggle.getByRole("button", { name: "Shared" });
		const personal = toggle.getByRole("button", { name: "Personal" });
		await expect(shared).toHaveAttribute("aria-pressed", "true");
		await expect(
			page.getByRole("button", { name: "Shared", exact: true }),
		).toBeVisible();
		const box = await toggle.boundingBox();
		if (!box) throw new Error("The budget switcher is missing.");
		await shoot(bob, `${slug}/budget-switcher`, {
			clip: {
				x: box.x - 10,
				y: box.y - 31,
				width: box.width + 20,
				height: box.height + 45,
			},
			annotate: [
				{ target: personal, badge: "above" },
				{ target: shared, badge: "above" },
			],
		});
		await personal.click();
		await expect(personal).toHaveAttribute("aria-pressed", "true");
		await shared.click();
		await bob
			.getByRole("button", { name: "Monthly budget", exact: true })
			.click();
		await expect(bob.getByLabel("Groceries", { exact: true })).toHaveValue(
			"0.00",
		);
	} finally {
		await context.close();
	}
});

test.describe("funding and leaving an active shared budget", () => {
	test.use({ scenario: "shared", viewport: { width: 1280, height: 1000 } });

	test("capture personal funding and the warning before leaving", async ({
		household: { page },
	}) => {
		const membershipMonth = new Date().toISOString().slice(0, 7);
		await page.goto(fixturePage);
		const toggle = page.getByRole("group", { name: "Budget space" });
		await toggle.getByRole("button", { name: "Shared" }).click();
		const month = page.getByLabel("Reporting month");
		await month.fill(membershipMonth);
		await page
			.getByRole("button", { name: "Monthly budget", exact: true })
			.click();
		await page.getByLabel("Expected take-home income").fill("4750.00");
		await page.getByLabel("Housing", { exact: true }).fill("2250.00");
		await page.getByLabel("Groceries", { exact: true }).fill("700.00");
		await page.getByLabel("Transport", { exact: true }).fill("350.00");
		await page.getByLabel("Monthly savings target").fill("750.00");
		const alice = page.getByLabel("Alice's personal amount");
		const bob = page.getByLabel("Bob's personal amount");
		await alice.fill("350.00");
		await bob.fill("350.00");
		await bob.blur();
		const save = page.getByRole("button", { name: "Save budget", exact: true });
		await expect(save).toBeEnabled();
		const personalFunding = page
			.getByRole("heading", { name: "Personal budget funding" })
			.locator("..");
		const fundingBox = await personalFunding.boundingBox();
		if (!fundingBox)
			throw new Error("The personal funding fields are missing.");
		await shoot(page, `${slug}/personal-funding`, {
			clip: {
				x: fundingBox.x - 14,
				y: fundingBox.y - 6,
				width: fundingBox.width + 28,
				height: fundingBox.height + 12,
			},
			annotate: [
				{ target: alice, badge: "left" },
				{ target: bob, badge: "left" },
			],
		});
		await save.click();
		await expect(
			page.getByText("Budget saved.", { exact: true }),
		).toBeVisible();
		await toggle.getByRole("button", { name: "Personal" }).click();
		await expect(
			page.getByText(/Your personal allocation is \$350\.00/),
		).toBeVisible();
		const accounts = page.getByRole("button", {
			name: "Accounts & sharing",
			exact: true,
		});
		await accounts.click();
		await expect(
			page.getByRole("heading", { name: "Personal funding", exact: true }),
		).toBeVisible();
		await month.fill("2025-10");
		await expect(
			page.getByRole("heading", {
				name: "Historical contributions for 2025-10",
			}),
		).toBeVisible();
		await month.fill(membershipMonth);
		await toggle.getByRole("button", { name: "Shared" }).click();
		await page
			.getByRole("button", { name: "Leave shared budget", exact: true })
			.click();
		const dialog = page.getByRole("dialog", { name: "Leave shared budget" });
		await expect(dialog).toContainText(
			"for both people. This cannot be undone.",
		);
		const cancel = dialog.getByRole("button", { name: "Cancel" });
		await shoot(page, `${slug}/leave-shared-budget`, {
			clip: dialog,
			annotate: [
				{ target: cancel, badge: "below" },
				{
					target: dialog.getByRole("button", {
						name: "Leave and delete shared budget",
					}),
					badge: "right",
				},
			],
		});
		await cancel.click();
		await expect(dialog).toHaveCount(0);
		await expect(toggle.getByRole("button", { name: "Shared" })).toBeVisible();
	});
});
