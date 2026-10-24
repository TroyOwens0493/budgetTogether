import { type ComponentProps, useId, useState } from "react";

/** Keeps browser submission checks and visible field errors in sync. */
export function ValidatedInput({
	validate,
	onChange,
	onBlur,
	...props
}: ComponentProps<"input"> & { validate: (value: string) => string }) {
	const errorId = useId();
	const [touched, setTouched] = useState(false);
	const [value, setValue] = useState(
		String(props.value ?? props.defaultValue ?? ""),
	);
	const error = validate(String(props.value ?? value));
	return (
		<span className="validated-input">
			<input
				{...props}
				ref={(input) => {
					input?.setCustomValidity(validate(input.value));
				}}
				aria-invalid={touched && Boolean(error)}
				aria-describedby={
					[props["aria-describedby"], touched && error ? errorId : ""]
						.filter(Boolean)
						.join(" ") || undefined
				}
				onChange={(event) => {
					setValue(event.target.value);
					setTouched(true);
					event.target.setCustomValidity(validate(event.target.value));
					onChange?.(event);
				}}
				onBlur={(event) => {
					setTouched(true);
					onBlur?.(event);
				}}
				onInvalid={() => setTouched(true)}
			/>
			{touched && error && (
				<small id={errorId} role="alert">
					{error}
				</small>
			)}
		</span>
	);
}
