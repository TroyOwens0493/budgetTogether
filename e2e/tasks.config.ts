import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import config from "../playwright.config";

export default defineConfig({
	...config,
	testDir: ".",
	testMatch: "tasks.spec.ts",
	testIgnore: [],
	use: { ...config.use, baseURL: "http://127.0.0.1:3100" },
	webServer: {
		cwd: fileURLToPath(new URL("..", import.meta.url)),
		command:
			"node --experimental-strip-types --import ./tests/register.ts e2e/fixtures/server.ts",
		url: "http://127.0.0.1:3100/e2e/fixtures/index.html",
		reuseExistingServer: false,
		timeout: 60_000,
	},
});
