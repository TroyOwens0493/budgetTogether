import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export type Home = FunctionReturnType<typeof api.budgets.home>;
export type Dashboard = FunctionReturnType<typeof api.budgets.dashboard>;

export type Run = (
	work: () => Promise<unknown>,
	success?: string,
) => Promise<boolean>;
export type ViewProps = {
	spaceId: Id<"spaces">;
	month: string;
	active: boolean;
	run: Run;
};
