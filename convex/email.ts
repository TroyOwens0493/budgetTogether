import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { type EmailContent, passwordResetEmail } from "./emailTemplates";
export async function sendEmail(
	to: string,
	content: EmailContent,
	key: string,
): Promise<void> {
	if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM)
		throw new Error("Configure RESEND_API_KEY and RESEND_FROM in Convex.");
	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
			"Content-Type": "application/json",
			"Idempotency-Key": key,
		},
		body: JSON.stringify({
			from: process.env.RESEND_FROM,
			to: [to],
			...content,
		}),
	});
	if (!response.ok)
		throw new Error(
			"Email delivery failed. Check the Resend sender and configuration.",
		);
}
export const reset = internalAction({
	args: { to: v.string(), url: v.string(), key: v.string() },
	handler: async (_ctx, args) =>
		sendEmail(args.to, passwordResetEmail(args.url), args.key),
});
