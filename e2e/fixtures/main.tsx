import { useQuery } from "convex/react";
import { createRoot } from "react-dom/client";
import { api } from "../../convex/_generated/api";
import { BudgetApp } from "../../src/components/BudgetApp";

function AuthenticatedApp() {
	const home = useQuery(api.budgets.home, {});
	return home ? <BudgetApp home={home} /> : <p>Loading test session…</p>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root.");
createRoot(root).render(<AuthenticatedApp />);
