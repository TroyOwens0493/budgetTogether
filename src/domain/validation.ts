export function labelError(value: string, maximum = 100): string {
	return !value.trim() || value.trim().length > maximum
		? `Enter between 1 and ${maximum} characters.`
		: "";
}
