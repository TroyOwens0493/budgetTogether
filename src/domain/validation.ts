import { cents, money } from "./budget";

export function labelError(value: string, maximum = 100): string {
	return !value.trim() || value.trim().length > maximum
		? `Enter between 1 and ${maximum} characters.`
		: "";
}

export function timeZoneError(value: string): string {
	try {
		new Intl.DateTimeFormat("en", { timeZone: value });
		return "";
	} catch {
		return "Choose a valid time zone, such as America/Boise.";
	}
}

export function amountError(value: string, allowNegative = false): string {
	try {
		money(cents(value), !allowNegative);
		return "";
	} catch {
		return allowNegative
			? "Enter an amount with at most two decimal places."
			: "Enter zero or a positive amount with at most two decimal places.";
	}
}
