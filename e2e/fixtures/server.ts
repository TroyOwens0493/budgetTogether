import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";
import { createScenario, deleteScenario, invokeSession } from "./backend";

const root = fileURLToPath(new URL("../..", import.meta.url));
const server = await createServer({
	configFile: false,
	envDir: false,
	root,
	plugins: [
		react(),
		{
			name: "isolated-budget-browser-fixture",
			configureServer(vite) {
				vite.middlewares.use(async (req, res, next) => {
					if (!req.url?.startsWith("/__fixture")) return next();
					res.setHeader("Content-Type", "application/json");
					res.setHeader("Cache-Control", "no-store");
					try {
						if (req.method === "POST" && req.url === "/__fixture") {
							res.end(JSON.stringify({ id: await createScenario() }));
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
	server: { host: "127.0.0.1", port: 3100, strictPort: true },
});
await server.listen();
