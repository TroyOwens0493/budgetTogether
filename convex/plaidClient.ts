export class PlaidError extends Error {
	code: string;
	constructor(code: string) {
		super(code);
		this.code = code;
	}
}
export async function plaid<T>(
	path: string,
	body: Record<string, unknown>,
): Promise<T> {
	const client_id = process.env.PLAID_CLIENT_ID;
	const secret = process.env.PLAID_SECRET;
	if (!client_id || !secret)
		throw new Error("Configure PLAID_CLIENT_ID and PLAID_SECRET in Convex.");
	// This branch is explicitly configured for Sandbox. Production requires a separate rollout.
	const response = await fetch(`https://sandbox.plaid.com${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Plaid-Version": "2020-09-14",
		},
		body: JSON.stringify({ ...body, client_id, secret }),
	});
	const result = await response.json();
	if (!response.ok)
		throw new PlaidError(result.error_code ?? "PLAID_REQUEST_FAILED");
	return result as T;
}
function bytes(value: string) {
	return Uint8Array.from(
		atob(value.replace(/-/g, "+").replace(/_/g, "/")),
		(c) => c.charCodeAt(0),
	);
}
function base64(value: ArrayBuffer | Uint8Array) {
	return btoa(String.fromCharCode(...new Uint8Array(value)));
}
async function encryptionKey() {
	const value = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
	if (!value)
		throw new Error(
			"Configure PLAID_TOKEN_ENCRYPTION_KEY with a base64 32-byte key.",
		);
	const raw = bytes(value);
	if (raw.length !== 32)
		throw new Error("The Plaid encryption key must contain 32 bytes.");
	return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}
export async function encrypt(value: string) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await encryptionKey(),
		new TextEncoder().encode(value),
	);
	return `${base64(iv)}.${base64(data)}`;
}
export async function decrypt(value: string) {
	const [iv, data] = value.split(".");
	return new TextDecoder().decode(
		await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: bytes(iv) },
			await encryptionKey(),
			bytes(data),
		),
	);
}
export async function hash(value: string) {
	const raw = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return [...new Uint8Array(raw)]
		.map((x) => x.toString(16).padStart(2, "0"))
		.join("");
}
export async function verifyWebhook(token: string, body: string) {
	const parts = token.split(".");
	if (parts.length !== 3) throw new Error("Invalid webhook signature.");
	const header = JSON.parse(new TextDecoder().decode(bytes(parts[0])));
	const claims = JSON.parse(new TextDecoder().decode(bytes(parts[1])));
	if (
		header.alg !== "ES256" ||
		typeof header.kid !== "string" ||
		typeof claims.iat !== "number" ||
		Math.abs(Date.now() / 1000 - claims.iat) > 300
	)
		throw new Error("Invalid webhook signature.");
	const { key } = await plaid<{
		key: JsonWebKey & { expired_at?: number | null };
	}>("/webhook_verification_key/get", { key_id: header.kid });
	if (key.expired_at) throw new Error("Expired verification key.");
	const publicKey = await crypto.subtle.importKey(
		"jwk",
		key,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["verify"],
	);
	if (
		!(await crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			publicKey,
			bytes(parts[2]),
			new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
		)) ||
		claims.request_body_sha256 !== (await hash(body))
	)
		throw new Error("Invalid webhook signature.");
}
export type PlaidAccount = {
	account_id: string;
	persistent_account_id?: string | null;
	name: string;
	type: string;
	subtype: string | null;
	mask: string | null;
};
export type PlaidTransaction = {
	transaction_id: string;
	account_id: string;
	pending_transaction_id?: string | null;
	name: string;
	merchant_name?: string | null;
	amount: number;
	date: string;
	pending: boolean;
	personal_finance_category?: { primary: string; detailed: string } | null;
};
export type SyncPage = {
	added: PlaidTransaction[];
	modified: PlaidTransaction[];
	removed: { transaction_id: string; account_id: string }[];
	next_cursor: string;
	has_more: boolean;
	accounts: PlaidAccount[];
};
