import { expect, fixturePage, test } from "./fixture";
import { shoot } from "./shoot";

const slug = "bank-accounts";

test.use({ scenario: "projections", viewport: { width: 1220, height: 1080 } });

const banks = [
	{ institution: "Cedar Bank", account: "Emergency Savings", mask: "6182" },
	{
		institution: "Maple Credit Union",
		account: "Vacation Savings",
		mask: "7405",
	},
];

test("capture account assignments and bank connection states", async ({
	household: { page },
}) => {
	await page.route("**/__fixture/invoke", async (route) => {
		const { name } = route.request().postDataJSON();
		if (name !== "accounts:connections" && name !== "accounts:list") {
			await route.continue();
			return;
		}
		// Use the projection fixture's checking and savings accounts for the
		// demo. Its connected banks have no import history, so add example
		// timestamps and simulate one paused import in the browser response.
		const response = await route.fetch();
		const { value } = await response.json();
		if (name === "accounts:list") {
			const checking = value.find(
				(account: { type: string }) => account.type === "checking",
			);
			const savings = value.filter(
				(account: { type: string }) => account.type === "savings",
			);
			await route.fulfill({
				response,
				json: {
					value: [
						checking,
						...savings.map((account: object, index: number) => ({
							...account,
							name: banks[index].account,
							mask: banks[index].mask,
						})),
					].filter(Boolean),
				},
			});
			return;
		}
		await route.fulfill({
			response,
			json: {
				value: value.slice(0, 2).map((connection: object, index: number) => ({
					...connection,
					institution: banks[index].institution,
					status: index === 0 ? "connected" : "stale",
					lastSync: Date.UTC(2026, 10, index === 0 ? 18 : 15, 9, 30),
					error: index === 0 ? undefined : "INSTITUTION_DOWN",
				})),
			},
		});
	});
	await page.goto(fixturePage);
	await page.getByRole("button", { name: "Shared", exact: true }).click();
	await page
		.getByRole("button", { name: "Accounts & sharing", exact: true })
		.click();
	const connect = page.getByRole("button", { name: "Connect a bank" });
	const accountPanel = page.locator("section").filter({
		has: page.getByRole("heading", { name: "Accounts in this budget" }),
	});
	const checking = accountPanel.locator("article").filter({
		has: page.getByText("Checking", { exact: true }),
	});
	const options = checking.getByRole("button", { name: "Options" });
	await expect(checking).toContainText("1234 · Current assignment");
	await expect(connect).toBeEnabled();
	const panel = await accountPanel.boundingBox();
	const action = await connect.boundingBox();
	if (!panel || !action) throw new Error("The account controls are missing.");
	await shoot(page, `${slug}/accounts`, {
		clip: {
			x: panel.x - 8,
			y: action.y - 10,
			width: panel.width + 16,
			height: panel.y + panel.height - action.y + 20,
		},
		annotate: [
			{ target: connect, badge: "left" },
			{ target: options, badge: "right" },
		],
	});

	await options.click();
	const move = page.getByRole("dialog", { name: "Account options" });
	const destination = move.getByLabel("Destination budget");
	await destination.selectOption({ label: "My budget · private" });
	const save = move.getByRole("button", { name: "Save", exact: true });
	await expect(save).toBeEnabled();
	await shoot(page, `${slug}/account-options`, {
		clip: move,
		annotate: [
			{ target: move.getByLabel("Account name"), badge: "left" },
			{ target: destination, badge: "left" },
			{ target: save, badge: "right" },
		],
	});
	await move.getByRole("button", { name: "Close dialog" }).click();

	const connections = page.locator("section").filter({
		has: page.getByRole("heading", { name: "Your bank connections" }),
	});
	const paused = connections.locator(".connection-row").filter({
		hasText: "Maple Credit Union",
	});
	const importStatus = paused.getByText(
		/^Import paused · Last successful import:/,
	);
	await expect(importStatus).toBeVisible();
	await expect(paused.getByText(/Your imported history is kept/)).toBeVisible();
	const sync = paused.getByRole("button", { name: "Sync", exact: true });
	const reconnect = paused.getByRole("button", { name: "Reconnect" });
	const disconnect = paused.getByRole("button", { name: "Disconnect" });
	const connectionBox = await connections.boundingBox();
	if (!connectionBox) throw new Error("The bank connections are missing.");
	await shoot(page, `${slug}/bank-connections`, {
		clip: {
			x: connectionBox.x - 14,
			y: connectionBox.y,
			width: connectionBox.width + 28,
			height: connectionBox.height,
		},
		annotate: [
			{ target: importStatus, badge: "left" },
			{ target: sync, badge: "above" },
			{ target: reconnect, badge: "above" },
			{ target: disconnect, badge: "right" },
		],
	});

	await disconnect.click();
	const dialog = page.getByRole("dialog", { name: "Disconnect bank" });
	await expect(dialog).toContainText("Imported history will be kept.");
	await shoot(page, `${slug}/disconnect`, {
		clip: dialog,
		annotate: [
			{
				target: dialog.getByRole("button", { name: "Disconnect bank" }),
				badge: "right",
			},
		],
	});
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(dialog).toHaveCount(0);
});
