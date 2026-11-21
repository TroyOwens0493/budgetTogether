import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const port = Number(process.env.BUDGET_TASK_PORT ?? 3200);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
	throw new Error("Set BUDGET_TASK_PORT to a port between 1024 and 65535.");
const baseURL = `http://127.0.0.1:${port}`;
const results = join(root, "test-results");
mkdirSync(results, { recursive: true });
process.env.BUDGET_GUIDES_RUN_DIR ??= mkdtempSync(
	join(results, `guides-${port}-`),
);
const run = process.env.BUDGET_GUIDES_RUN_DIR;

export default defineConfig({
	testDir: ".",
	testMatch: "*.capture.ts",
	forbidOnly: true,
	reporter: "list",
	outputDir: join(run, "artifacts"),
	use: {
		baseURL,
		browserName: "chromium",
		headless: true,
		viewport: { width: 1280, height: 800 },
		deviceScaleFactor: 1,
		locale: "en-US",
		timezoneId: "UTC",
		screenshot: "only-on-failure",
	},
	webServer: {
		cwd: root,
		command:
			"node --experimental-strip-types --import ./tests/register.ts e2e/fixtures/server.ts",
		env: {
			BUDGET_TASK_PORT: String(port),
			BUDGET_TASK_CACHE_DIR: join(run, "vite"),
		},
		url: `${baseURL}/e2e/fixtures/index.html`,
		reuseExistingServer: false,
		timeout: 60_000,
	},
});
