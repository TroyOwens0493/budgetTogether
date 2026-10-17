import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { amountError } from "../domain/validation";
import { ValidatedInput } from "./ValidatedInput";
export const usd = (value: number) =>
	new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
		value / 100,
	);
export const amount = (value: number) => (value / 100).toFixed(2);
export function MoneyInput({
	name,
	value,
	label,
	required = true,
	readOnly = false,
	allowNegative = false,
	onChange,
}: {
	name: string;
	value?: number;
	label: string;
	required?: boolean;
	readOnly?: boolean;
	allowNegative?: boolean;
	onChange?: (value: string) => void;
}) {
	const id = useId();
	return (
		<label htmlFor={id}>
			{label}
			<span className="money-input">
				<span>$</span>
				<ValidatedInput
					id={id}
					aria-label={label}
					name={name}
					defaultValue={value === undefined ? "" : amount(value)}
					inputMode="decimal"
					readOnly={readOnly}
					onChange={(e) => onChange?.(e.target.value)}
					required={required}
					validate={(value) =>
						!required && !value ? "" : amountError(value, allowNegative)
					}
				/>
			</span>
		</label>
	);
}
export function Modal({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		ref.current?.showModal();
	}, []);
	return (
		<dialog
			ref={ref}
			onCancel={(e) => {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}}
			aria-label={title}
		>
			<div className="modal-heading">
				<h2>{title}</h2>
				<button
					type="button"
					className="secondary"
					onClick={onClose}
					aria-label="Close dialog"
				>
					Close
				</button>
			</div>
			{children}
		</dialog>
	);
}

export function ConfirmModal({
	title,
	children,
	confirmLabel,
	onConfirm,
	onClose,
}: {
	title: string;
	children: ReactNode;
	confirmLabel: string;
	onConfirm: () => Promise<boolean>;
	onClose: () => void;
}) {
	const [pending, setPending] = useState(false);
	const inFlight = useRef(false);
	return (
		<Modal title={title} onClose={() => !inFlight.current && onClose()}>
			{children}
			<div className="button-row">
				<button
					type="button"
					className="secondary"
					disabled={pending}
					onClick={onClose}
				>
					Cancel
				</button>
				<button
					type="button"
					className="danger"
					disabled={pending}
					onClick={async () => {
						if (inFlight.current) return;
						inFlight.current = true;
						setPending(true);
						try {
							if (await onConfirm()) onClose();
						} finally {
							inFlight.current = false;
							setPending(false);
						}
					}}
				>
					{pending ? "Please wait…" : confirmLabel}
				</button>
			</div>
		</Modal>
	);
}
