import {
	type FunctionArgs,
	type FunctionReference,
	type FunctionReturnType,
	getFunctionName,
} from "convex/server";
import { useCallback, useEffect, useState } from "react";

// Replace only the network transport. Components, inputs, and backend handlers
// are production code. Polling delivers other sessions' committed changes.
const changes = new EventTarget();
async function invoke(name: string, args: unknown) {
	const response = await fetch("/__fixture/invoke", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name, args }),
	});
	const result = await response.json();
	if (!response.ok) throw new Error(result.error);
	return result.value;
}

export function useQuery<F extends FunctionReference<"query">>(
	reference: F,
	args: FunctionArgs<F>,
): FunctionReturnType<F> | undefined {
	const name = getFunctionName(reference);
	const key = JSON.stringify(args);
	const [snapshot, setSnapshot] = useState<{
		key: string;
		json?: string;
		value?: FunctionReturnType<F>;
		error?: Error;
	}>({ key });
	useEffect(() => {
		let closed = false;
		let pending = false;
		async function refresh() {
			if (closed || pending) return;
			pending = true;
			try {
				const value = await invoke(name, JSON.parse(key));
				const json = JSON.stringify(value);
				if (!closed)
					setSnapshot((old) =>
						old.key === key && old.json === json ? old : { key, json, value },
					);
			} catch (error) {
				if (!closed) setSnapshot({ key, error: error as Error });
			} finally {
				pending = false;
			}
		}
		void refresh();
		const timer = setInterval(refresh, 100);
		changes.addEventListener("commit", refresh);
		return () => {
			closed = true;
			clearInterval(timer);
			changes.removeEventListener("commit", refresh);
		};
	}, [name, key]);
	if (snapshot.key !== key) return undefined;
	if (snapshot.error) throw snapshot.error;
	return snapshot.value;
}

export function useMutation<F extends FunctionReference<"mutation">>(
	reference: F,
): (args: FunctionArgs<F>) => Promise<FunctionReturnType<F>> {
	const name = getFunctionName(reference);
	return useCallback(
		async (args: FunctionArgs<F>) => {
			const result = await invoke(name, args);
			changes.dispatchEvent(new Event("commit"));
			return result;
		},
		[name],
	);
}

// Imported by the account screen; external actions are deliberately unavailable.
export function useAction() {
	return useCallback(async () => {
		throw new Error("External actions are disabled in browser tests.");
	}, []);
}
