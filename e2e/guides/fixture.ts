import { test as base, expect, type Page } from "@playwright/test";
import {
	type FunctionArgs,
	type FunctionReference,
	type FunctionReturnType,
	getFunctionName,
} from "convex/server";

export const fixturePage = "/e2e/fixtures/index.html";
type Operation = FunctionReference<"query" | "mutation" | "action">;

type Household = {
	page: Page;
	invoke: <F extends Operation>(
		operation: F,
		args: FunctionArgs<F>,
	) => Promise<FunctionReturnType<F>>;
};

export const test = base.extend<{
	scenario: "shared" | "private" | "projections" | "classification";
	household: Household;
}>({
	scenario: ["shared", { option: true }],
	household: async ({ baseURL, context, page, request, scenario }, use) => {
		if (!baseURL) throw new Error("A guide fixture needs a base URL.");
		const endpoint = {
			shared: "/__fixture",
			private: "/__fixture/invitations",
			projections: "/__fixture/projections",
			classification: "/__fixture/classification",
		}[scenario];
		const response = await request.post(endpoint);
		await expect(response).toBeOK();
		const { id } = await response.json();
		try {
			await context.addCookies([
				{
					name: "bt-test-session",
					value: `${id}:alice`,
					url: baseURL,
					httpOnly: true,
				},
			]);
			await use({
				page,
				async invoke(operation, args) {
					const name = getFunctionName(operation);
					const response = await context.request.post("/__fixture/invoke", {
						data: { name, args },
					});
					if (!response.ok())
						throw new Error(`${name}: ${await response.text()}`);
					return (await response.json()).value;
				},
			});
		} finally {
			await page.close();
			await expect(await request.delete(`/__fixture/${id}`)).toBeOK();
		}
	},
});

export { expect } from "@playwright/test";
