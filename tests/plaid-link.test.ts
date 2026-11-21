import assert from "node:assert/strict";
import test from "node:test";
import { openPlaid } from "../src/lib/plaid-link";

test("Plaid distinguishes cancellation, completion, and failure", async (t) => {
	let exit: (error: { display_message?: string } | null) => void = () =>
		assert.fail("Plaid has not opened");
	let success: (token: string) => void = () =>
		assert.fail("Plaid has not opened");
	const destroy = t.mock.fn();
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			Plaid: {
				create(options: { onExit: typeof exit; onSuccess: typeof success }) {
					exit = options.onExit;
					success = options.onSuccess;
					return { open() {}, destroy };
				},
			},
		},
	});
	try {
		const exchange = t.mock.fn(async (_token: string) => {});
		const cancelled = openPlaid("link-token", exchange);
		exit(null);
		assert.equal(await cancelled, "cancelled");
		assert.equal(exchange.mock.callCount(), 0);

		const linked = openPlaid("link-token", exchange);
		success("public-token");
		exit(null);
		assert.equal(await linked, "linked");
		assert.deepEqual(exchange.mock.calls[0]?.arguments, ["public-token"]);

		const rejected = openPlaid("link-token", async () => {
			throw new Error("Exchange failed");
		});
		success("public-token");
		await assert.rejects(rejected, /Exchange failed/);

		const failed = openPlaid("link-token", exchange);
		exit({ display_message: "Sign-in failed" });
		await assert.rejects(failed, /Sign-in failed/);
		assert.equal(destroy.mock.callCount(), 4);
	} finally {
		if (previousWindow)
			Object.defineProperty(globalThis, "window", previousWindow);
		else Reflect.deleteProperty(globalThis, "window");
	}
});
