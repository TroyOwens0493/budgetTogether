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

export function partnerEmailError(value: string, ownEmail: string): string {
	const email = value.trim().toLowerCase();
	return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
		email === ownEmail.toLowerCase()
		? "Enter your partner’s email address."
		: "";
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

export function categoryNameError(
	value: string,
	categories: { _id: string; name: string }[],
	currentId?: string,
): string {
	return (
		labelError(value) ||
		(categories.some(
			(category) =>
				category._id !== currentId &&
				category.name.toLowerCase() === value.trim().toLowerCase(),
		)
			? "A category with this name already exists."
			: "")
	);
}
