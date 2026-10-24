import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";
import {
	createClassificationScenario,
	createScenario,
	deleteScenario,
	invokeSession,
} from "./backend";

const root = fileURLToPath(new URL("../..", import.meta.url));
const port = Number(process.env.BUDGET_TASK_PORT ?? 3100);
const server = await createServer({
	configFile: false,
	envDir: false,
	root,
	cacheDir: `${root}/node_modules/.vite-budget-tasks`,
	plugins: [
		tailwindcss(),
		react(),
		{
			name: "isolated-budget-browser-fixture",
			configureServer(vite) {
				vite.middlewares.use(async (req, res, next) => {
					if (!req.url?.startsWith("/__fixture")) return next();
					res.setHeader("Content-Type", "application/json");
					res.setHeader("Cache-Control", "no-store");
					try {
						if (
							req.method === "POST" &&
							req.url === "/__fixture/classification"
						) {
							res.end(
								JSON.stringify({ id: await createClassificationScenario() }),
							);
							return;
						}
						if (
							req.method === "POST" &&
							["/__fixture", "/__fixture/overspending"].includes(req.url)
						) {
							res.end(
								JSON.stringify({
									id: await createScenario(
										req.url === "/__fixture/overspending",
									),
								}),
							);
							return;
						}
						if (req.method === "DELETE") {
							deleteScenario(req.url.slice("/__fixture/".length));
							res.end("{}");
							return;
						}
						if (req.method !== "POST" || req.url !== "/__fixture/invoke")
							throw new Error("Unknown fixture endpoint.");
						let body = "";
						for await (const chunk of req) body += chunk;
						const { name, args } = JSON.parse(body);
						const session = req.headers.cookie?.match(
							/(?:^|; )bt-test-session=([^;]+)/,
						)?.[1];
						res.end(
							JSON.stringify({
								value: await invokeSession(session ?? "", name, args),
							}),
						);
					} catch (error) {
						res.statusCode = 400;
						res.end(
							JSON.stringify({
								error: error instanceof Error ? error.message : String(error),
							}),
						);
					}
				});
			},
		},
	],
	resolve: {
		alias: [
			{
				find: /^convex\/react$/,
				replacement: `${root}/e2e/fixtures/transport.ts`,
			},
		],
	},
	server: { host: "127.0.0.1", port, strictPort: true },
});
await server.listen();
