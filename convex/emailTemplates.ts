export type EmailContent = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
	const entities: Record<string, string> = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	};
	return value.replace(/[&<>"']/g, (character) => entities[character]);
}

function actionUrl(value: string): string {
	const url = new URL(value);
	if (url.protocol !== "https:" && url.protocol !== "http:")
		throw new Error("Email links must use HTTP or HTTPS.");
	return url.href;
}

/** One email-safe layout keeps the brand consistent without images or web fonts.
 * Inline styles and presentation tables also work in clients that strip CSS. */
function layout(args: {
	preview: string;
	label: string;
	title: string;
	body: string;
	button: string;
	url: string;
	note: string;
	footer: string;
}) {
	const url = escapeHtml(args.url);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(args.title)} · Budget Together</title>
<style>
@media only screen and (max-width: 480px) {
  .email-outer { padding: 20px 12px !important; }
  .email-content { padding: 28px 24px !important; }
  .email-title { font-size: 28px !important; line-height: 34px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f6f7f3;color:#263630;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;" aria-hidden="true">${escapeHtml(args.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f6f7f3;">
<tr><td class="email-outer" align="center" style="padding:40px 20px;">
<!--[if mso]><table role="presentation" width="580" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;">
<tr><td style="padding:0 0 24px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td width="40" height="40" align="center" valign="middle" bgcolor="#285e4e" style="border-radius:10px;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-2px;line-height:40px;">b.</td>
<td style="padding-left:12px;color:#263630;font-size:19px;font-weight:700;letter-spacing:-0.6px;">budget together</td>
</tr></table>
</td></tr>
<tr><td class="email-content" bgcolor="#ffffff" style="padding:40px;border:1px solid #e4e8e1;border-radius:12px;">
<p style="margin:0 0 14px;color:#285e4e;font-size:11px;font-weight:700;letter-spacing:2px;line-height:16px;">${escapeHtml(args.label)}</p>
<h1 class="email-title" style="margin:0 0 20px;color:#263630;font-size:32px;font-weight:700;letter-spacing:-1px;line-height:38px;">${escapeHtml(args.title)}</h1>
${args.body}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 20px;">
<tr><td align="center" bgcolor="#285e4e" style="border-radius:7px;mso-padding-alt:15px 24px;">
<a href="${url}" style="display:inline-block;padding:15px 24px;border:1px solid #285e4e;border-radius:7px;background-color:#285e4e;color:#ffffff;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;text-align:center;mso-padding-alt:0;">${escapeHtml(args.button)}</a>
</td></tr></table>
<p style="margin:0;color:#68736d;font-size:13px;line-height:21px;">${escapeHtml(args.note)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
<tr><td style="padding-top:24px;border-top:1px solid #e4e8e1;">
<p style="margin:0 0 8px;color:#68736d;font-size:12px;line-height:19px;">Button not working? Open this link:</p>
<p style="margin:0;font-size:12px;line-height:19px;word-break:break-all;overflow-wrap:anywhere;"><a href="${url}" style="color:#285e4e;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${url}</a></p>
</td></tr></table>
</td></tr>
<tr><td style="padding:22px 12px 0;text-align:center;">
<p style="margin:0;color:#68736d;font-size:12px;line-height:20px;">${escapeHtml(args.footer)}</p>
<p style="margin:8px 0 0;color:#68736d;font-size:12px;font-weight:700;line-height:20px;">Budget Together</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;
}

export function invitationEmail(args: {
	inviterName: string;
	email: string;
	url: string;
}): EmailContent {
	const url = actionUrl(args.url);
	return {
		subject: `${args.inviterName} invited you to Budget Together`,
		text: `${args.inviterName} invited you to create a shared budget on Budget Together.\n\nReview invitation:\n${url}\n\nSign in or create an account with ${args.email}. Your shared budget is created only after you accept. Your private budgets stay separate, and you choose which accounts to move.\n\nThis invitation expires in 7 days. If you did not expect it, you can ignore this email.`,
		html: layout({
			preview: `${args.inviterName} invited you to create a shared budget.`,
			label: "YOU’RE INVITED",
			title: "Start a shared budget.",
			body: `<p style="margin:0 0 18px;color:#263630;font-size:16px;line-height:26px;"><strong>${escapeHtml(args.inviterName)}</strong> invited you to create a shared budget.</p>
<p style="margin:0 0 24px;color:#68736d;font-size:15px;line-height:25px;">Your private budgets stay separate. You choose which accounts to move.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#f6f7f3" style="padding:16px 18px;border:1px solid #e4e8e1;border-radius:7px;">
<p style="margin:0 0 5px;color:#68736d;font-size:12px;line-height:18px;">Sign in or create an account with</p>
<p style="margin:0;color:#263630;font-size:15px;font-weight:700;line-height:23px;word-break:break-word;">${escapeHtml(args.email)}</p>
</td></tr></table>`,
			button: "Review invitation",
			url,
			note: "Expires in 7 days. Your shared budget is created only after you accept.",
			footer:
				"If you weren’t expecting this invitation, you can ignore this email.",
		}),
	};
}

export function passwordResetEmail(value: string): EmailContent {
	const url = actionUrl(value);
	return {
		subject: "Reset your Budget Together password",
		text: `Reset your Budget Together password:\n${url}\n\nIf you did not request this, ignore this email. Your password will stay the same.`,
		html: layout({
			preview: "Choose a new password for your Budget Together account.",
			label: "YOUR ACCOUNT",
			title: "Reset your password.",
			body: `<p style="margin:0;color:#68736d;font-size:16px;line-height:26px;">We received a request to reset your Budget Together password. Use the button below to choose a new one.</p>`,
			button: "Reset password",
			url,
			note: "Your password stays the same until you choose a new one.",
			footer:
				"If you didn’t request a password reset, you can ignore this email.",
		}),
	};
}
