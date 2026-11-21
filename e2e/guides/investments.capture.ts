import {
	type FunctionArgs,
	type FunctionReference,
	type FunctionReturnType,
	getFunctionName,
	makeFunctionReference,
} from "convex/server";
import { api, internal } from "../../convex/_generated/api";
import { addMonths } from "../../src/domain/projections";
import { expect, fixturePage, test } from "./fixture";
import { shoot } from "./shoot";

const slug = "investments";

// The test backend explicitly registers these internal mutations for seeding.
function fixtureMutation<F extends FunctionReference<"mutation", "internal">>(
	operation: F,
) {
	return makeFunctionReference<
		"mutation",
		FunctionArgs<F>,
		FunctionReturnType<F>
	>(getFunctionName(operation));
}

test("capture investment accounts and forecast assumptions", async ({
	household: { page, invoke },
}) => {
	const home = await invoke(api.budgets.home, {});
	const spaceId = home.spaces.find(({ type }) => type === "shared")?._id;
	if (!spaceId) throw new Error("The investment demo needs a shared budget.");
	const { month, startsOn } = await invoke(api.projections.list, { spaceId });
	await invoke(api.budgets.savePlan, {
		spaceId,
		month,
		expectedIncome: 85000,
		savingsTarget: 85000,
		limits: [],
		revision: 0,
	});
	await invoke(api.projections.saveSettings, {
		spaceId,
		currentAge: 34,
		targetAge: 35,
		cashBalance: 1850000,
		cashAnnualReturn: 3.5,
		revision: 0,
	});

	await page.setViewportSize({ width: 1280, height: 1240 });
	await page.goto(fixturePage);
	await page.getByRole("button", { name: "Projections", exact: true }).click();
	await page
		.getByRole("button", { name: "Add investment", exact: true })
		.click();
	const dialog = page.getByRole("dialog");
	const account = dialog.getByLabel("Investment account", { exact: true });
	const accountName = dialog.getByLabel("Account name", { exact: true });
	const name = dialog.getByLabel("Investment name", { exact: true });
	const type = dialog.getByLabel("Investment type", { exact: true });
	const ticker = dialog.getByLabel("Trading symbol", { exact: true });
	const value = dialog.getByLabel("Current investment value");
	const override = dialog.getByLabel("Annual return override (%)", {
		exact: true,
	});
	const contribution = dialog.getByLabel("Monthly investment contribution");
	const included = dialog.getByLabel("Include this holding in the forecast");
	const save = dialog.getByRole("button", {
		name: "Save investment",
		exact: true,
	});
	await expect(account).toHaveValue("new");
	await accountName.fill("Maple Brokerage");
	await name.fill("Total Market Index Fund");
	await expect(type).toHaveValue("etf");
	await ticker.fill("DEMO");
	await value.fill("34000");
	await contribution.fill("400");
	await contribution.blur();
	await expect(included).toBeChecked();
	await shoot(page, `${slug}/manual-investment`, {
		clip: dialog,
		annotate: [
			{ target: account, badge: "left" },
			{
				target: dialog.locator(".plan-grid").filter({
					has: page.getByLabel("Account name", { exact: true }),
				}),
				badge: "left",
			},
			{ target: name, badge: "left" },
			{
				target: dialog.locator(".plan-grid").filter({
					has: page.getByLabel("Trading symbol", { exact: true }),
				}),
				badge: "left",
			},
			{ target: value, badge: "right" },
			{ target: save, badge: "right" },
		],
	});
	await save.click();
	await expect(dialog).toHaveCount(0);

	const accounts = page.locator("section.panel").filter({
		has: page.getByRole("heading", {
			name: "Investment accounts",
			exact: true,
		}),
	});
	const fund = accounts
		.locator(".projection-holding")
		.filter({ hasText: "Total Market Index Fund" });
	const edit = fund.getByRole("button", { name: "Edit forecast" });
	const load = accounts.getByRole("button", {
		name: "Load historical returns",
	});
	const attention = page.getByRole("region", {
		name: "Forecast needs attention",
	});
	await expect(attention).toContainText(
		"Select Load historical returns, or enter an annual return override in Edit forecast.",
	);
	const reservation = await invoke(
		fixtureMutation(internal.investments.reserveReturn),
		{
			ticker: "DEMO",
		},
	);
	if (!reservation)
		throw new Error("Could not reserve a lookup for the demo fund.");
	await invoke(fixtureMutation(internal.investments.storeReturn), {
		...reservation,
		rate: 7.2,
		startDate: addMonths(startsOn, -120),
		endDate: startsOn,
	});
	await expect(attention).toHaveCount(0);
	const investmentValue = page.locator(
		".projection-investments .projection-value",
	);
	const valueAfterOneYear = (rate: number) => {
		const factor = (1 + rate / 100) ** (1 / 12);
		return (
			34000 * factor ** 12 +
			(400 * (factor ** 12 - 1)) / (factor - 1)
		).toLocaleString("en-US", { style: "currency", currency: "USD" });
	};
	await expect(investmentValue).toHaveText(valueAfterOneYear(7.2));
	await edit.click();
	await override.fill("6.5");
	await contribution.fill("900");
	await save.click();
	await expect(dialog.getByRole("alert")).toContainText(
		"Investment contributions cannot exceed this month's savings target.",
	);
	await contribution.fill("400");
	await save.click();
	await expect(dialog).toHaveCount(0);
	await expect(investmentValue).toHaveText(valueAfterOneYear(6.5));
	await edit.click();
	await shoot(page, `${slug}/edit-forecast`, {
		clip: dialog,
		annotate: [
			{ target: override, badge: "left" },
			{ target: contribution, badge: "right" },
			{ target: included.locator(".."), badge: "right" },
			{ target: save, badge: "left" },
		],
	});
	await override.clear();
	await save.click();
	await expect(dialog).toHaveCount(0);
	await expect(investmentValue).toHaveText(valueAfterOneYear(7.2));
	await edit.click();
	await included.uncheck();
	await save.click();
	await expect(dialog).toHaveCount(0);
	await expect(investmentValue).toHaveText("$0.00");
	await edit.click();
	await included.check();
	await save.click();
	await expect(dialog).toHaveCount(0);

	const addHolding = accounts.getByRole("button", { name: "Add holding" });
	await addHolding.click();
	await expect(
		account.getByRole("option", { name: "Maple Brokerage" }),
	).toHaveJSProperty("selected", true);
	await name.fill("Cedar Rail Stock");
	await type.selectOption("stock");
	await value.fill("6000");
	await override.fill("5");
	await contribution.fill("100");
	await save.click();
	await expect(dialog).toHaveCount(0);

	await addHolding.click();
	await name.fill("Municipal bond");
	await type.selectOption("bond");
	await value.fill("4800");
	const faceValue = dialog.getByLabel("Total bond face value");
	const coupon = dialog.getByLabel("Annual coupon rate (%)", { exact: true });
	const frequency = dialog.getByLabel("Coupon payments per year", {
		exact: true,
	});
	const nextPayment = dialog.getByLabel("Next coupon payment", { exact: true });
	const maturity = dialog.getByLabel("Maturity date", { exact: true });
	await faceValue.fill("5000");
	await coupon.fill("4");
	await frequency.selectOption("2");
	await nextPayment.fill(addMonths(startsOn, 6));
	await maturity.fill(addMonths(startsOn, 36));
	await maturity.blur();
	await expect(contribution).toHaveCount(0);
	await shoot(page, `${slug}/bond-terms`, {
		clip: dialog,
		annotate: [
			{ target: faceValue, badge: "right" },
			{ target: coupon, badge: "left" },
			{ target: frequency, badge: "left" },
			{ target: nextPayment, badge: "left" },
			{ target: maturity, badge: "left" },
		],
	});
	await save.click();
	await expect(dialog).toHaveCount(0);

	await addHolding.click();
	await name.fill("Two-year CD");
	await type.selectOption("cd");
	await value.fill("5000");
	const yieldRate = dialog.getByLabel("CD annual yield (APY %)", {
		exact: true,
	});
	await yieldRate.fill("4.25");
	await maturity.fill(addMonths(startsOn, 24));
	await maturity.blur();
	await expect(contribution).toHaveCount(0);
	await shoot(page, `${slug}/cd-terms`, {
		clip: dialog,
		annotate: [
			{ target: yieldRate, badge: "left" },
			{ target: maturity, badge: "left" },
		],
	});
	await save.click();
	await expect(dialog).toHaveCount(0);
	await expect(attention).toHaveCount(0);
	await expect(accounts.locator(".projection-holding")).toHaveCount(4);
	const connect = accounts.getByRole("button", { name: "Connect investments" });
	const includeAccount = accounts.getByRole("checkbox", {
		name: "Include Maple Brokerage",
	});
	await expect(includeAccount).toBeChecked();
	await accounts.evaluate((panel) =>
		panel.scrollIntoView({ block: "center", behavior: "instant" }),
	);
	await shoot(page, `${slug}/account-controls`, {
		clip: accounts,
		annotate: [
			{ target: connect, badge: "below" },
			{ target: load, badge: "above" },
			{ target: addHolding, badge: "left" },
			{ target: edit, badge: "left" },
			{ target: includeAccount, badge: "below" },
		],
	});
	await includeAccount.click();
	await expect(includeAccount).not.toBeChecked();
	await expect(investmentValue).toHaveText("$0.00");
});
