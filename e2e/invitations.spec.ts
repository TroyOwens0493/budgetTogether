import { test as base, expect, type Page } from "@playwright/test";

const test = base.extend<{
	invites: { alice: Page; bob: Page; link: () => Promise<string> };
}>({
	invites: async ({ browser, request, baseURL }, use) => {
		if (!baseURL) throw new Error("Missing fixture URL.");
		const response = await request.post("/__fixture/invitations");
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
			const [alice, bob] = await Promise.all(
				contexts.map((context) => context.newPage()),
			);
			await use({
				alice,
				bob,
				link: async () => {
					const response = await request.get(`/__fixture/invitation/${id}`);
					const { token } = await response.json();
					return `/e2e/fixtures/index.html?invite=${token}`;
				},
			});
		} finally {
			await Promise.all(contexts.map((context) => context.close()));
			await request.delete(`/__fixture/${id}`);
		}
	},
});
async function openInvites(page: Page) {
	await page.goto("/e2e/fixtures/index.html");
	await page
		.getByRole("button", { name: "Accounts & settings", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Start a shared budget" }),
	).toBeVisible();
}

test("self-invites show a clear error and cannot be submitted", async ({
	invites: { alice },
}) => {
	await openInvites(alice);
	const recipient = alice.getByLabel("Partner’s email");
	const send = alice.getByRole("button", {
		name: "Send invitation",
		exact: true,
	});
	for (const address of [
		"alice@example.test",
		"ALICE@EXAMPLE.TEST",
		" alice@example.test ",
	]) {
		await recipient.fill(address);
		await expect(
			alice.getByText("You cannot invite yourself.", { exact: true }),
		).toBeVisible();
		await expect(send).toBeDisabled();
	}
	await expect(
		alice.getByRole("button", { name: "Resend invitation", exact: true }),
	).toHaveCount(0);
	await expect(alice.getByLabel("Budget space").locator("option")).toHaveCount(
		1,
	);
	await recipient.fill("bob@example.test");
	await expect(send).toBeEnabled();
	await expect(
		alice.getByText("You cannot invite yourself.", { exact: true }),
	).toHaveCount(0);
});

test("send, review and accept creates a shared budget for both sessions with default categories", async ({
	invites: { alice, bob, link },
}) => {
	await openInvites(alice);
	await alice.getByLabel("Partner’s email").fill("bob@example.test");
	await alice
		.getByRole("button", { name: "Send invitation", exact: true })
		.click();
	await expect(
		alice.getByText("Invitation email sent. Expires", { exact: false }),
	).toBeVisible();
	await expect(alice.getByLabel("Budget space").locator("option")).toHaveCount(
		1,
	);
	await bob.goto(await link());
	await expect(
		bob.getByRole("heading", { name: "Shared budget invitation" }),
	).toBeVisible();
	await expect(bob.getByText("Alice", { exact: true })).toBeVisible();
	await expect(alice.getByLabel("Budget space").locator("option")).toHaveCount(
		1,
	);
	await bob
		.getByRole("button", { name: "Accept invitation", exact: true })
		.click();
	await expect(bob.getByLabel("Budget space").locator("option")).toHaveCount(2);
	await expect(
		bob.getByLabel("Budget space").locator("option:checked"),
	).toHaveText("Shared");
	await expect(bob).not.toHaveURL(/invite=/);
	await expect(alice.getByLabel("Budget space").locator("option")).toHaveCount(
		2,
	);
	await bob
		.getByRole("button", { name: "Monthly budget", exact: true })
		.click();
	for (const name of [
		"Housing",
		"Groceries",
		"Dining out",
		"Entertainment",
		"Transport",
		"Other",
	])
		await expect(bob.getByLabel(name, { exact: true })).toHaveValue("0.00");
	await bob.reload();
	await expect(bob.getByLabel("Budget space").locator("option")).toHaveCount(2);
});

test("resend and cancel invalidate old links and a mismatched account cannot accept", async ({
	invites: { alice, bob, link },
}) => {
	await openInvites(alice);
	await alice.getByLabel("Partner’s email").fill("bob@example.test");
	await alice
		.getByRole("button", { name: "Send invitation", exact: true })
		.click();
	await expect(
		alice.getByRole("button", { name: "Resend invitation", exact: true }),
	).toBeVisible();
	const oldLink = await link();
	await alice
		.getByRole("button", { name: "Resend invitation", exact: true })
		.click();
	await expect.poll(link).not.toBe(oldLink);
	const newLink = await link();
	await bob.goto(oldLink);
	await expect(
		bob.getByText("This invitation has expired", { exact: false }),
	).toBeVisible();
	await expect(
		bob.getByRole("button", { name: "Accept invitation", exact: true }),
	).toHaveCount(0);
	await alice.goto(newLink);
	await expect(
		alice.getByRole("button", { name: "Use a different account", exact: true }),
	).toBeVisible();
	await expect(
		alice.getByRole("button", { name: "Accept invitation", exact: true }),
	).toHaveCount(0);
	await alice
		.getByRole("button", { name: "Continue to my budget", exact: true })
		.click();
	await alice
		.getByRole("button", { name: "Accounts & settings", exact: true })
		.click();
	await alice
		.getByRole("button", { name: "Cancel invitation", exact: true })
		.click();
	await expect(
		alice.getByRole("button", { name: "Send invitation", exact: true }),
	).toBeVisible();
	await bob.goto(newLink);
	await expect(
		bob.getByText("This invitation has expired", { exact: false }),
	).toBeVisible();
	await expect(
		bob.getByRole("button", { name: "Accept invitation", exact: true }),
	).toHaveCount(0);
});
