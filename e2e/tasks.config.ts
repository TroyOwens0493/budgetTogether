import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import config from "../playwright.config";

const baseURL = `http://127.0.0.1:${process.env.BUDGET_TASK_PORT ?? 3100}`;

export default defineConfig({
	...config,
	testDir: ".",
	testMatch: [
		"tasks.spec.ts",
		"classification.spec.ts",
		"projections.spec.ts",
		"invitations.spec.ts",
	],
	testIgnore: [],
	outputDir: fileURLToPath(new URL("../test-results-tasks", import.meta.url)),
	reporter: [
		["list"],
		[
			"html",
			{
				open: "never",
				outputFolder: fileURLToPath(
					new URL("../playwright-report-tasks", import.meta.url),
				),
			},
		],
	],
	use: { ...config.use, baseURL },
	webServer: {
		cwd: fileURLToPath(new URL("..", import.meta.url)),
		command:
			"node --experimental-strip-types --import ./tests/register.ts e2e/fixtures/server.ts",
		url: `${baseURL}/e2e/fixtures/index.html`,
		reuseExistingServer: false,
		timeout: 60_000,
	},
});
