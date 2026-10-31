import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { verifyWebhook } from "./plaidClient";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);
http.route({
	path: "/bank-events",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const body = await request.text();
		if (body.length > 100000) return new Response("Too large", { status: 413 });
		try {
			await verifyWebhook(
				request.headers.get("Plaid-Verification") ?? "",
				body,
			);
		} catch {
			return new Response("Invalid signature", { status: 401 });
		}
		const event = JSON.parse(body);
		if (
			typeof event.item_id === "string" &&
			["TRANSACTIONS", "ITEM", "HOLDINGS", "INVESTMENTS_TRANSACTIONS"].includes(
				event.webhook_type,
			)
		)
			await ctx.runMutation(internal.bank.event, {
				itemId: event.item_id,
				...(event.error?.error_code
					? { error: String(event.error.error_code) }
					: {}),
			});
		return new Response("OK");
	}),
});
export default http;
