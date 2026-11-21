import { useQuery } from "convex/react";
import { createRoot } from "react-dom/client";
import { api } from "../../convex/_generated/api";
import { Auth } from "../../src/components/Auth";
import { BudgetApp } from "../../src/components/BudgetApp";
import "../../src/styles.css";

function AuthenticatedApp() {
	const home = useQuery(api.budgets.home, {});
	return home ? <BudgetApp home={home} /> : <p>Loading test session…</p>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root.");
const authScreen =
	new URLSearchParams(window.location.search).get("screen") === "auth";
createRoot(root).render(authScreen ? <Auth /> : <AuthenticatedApp />);
