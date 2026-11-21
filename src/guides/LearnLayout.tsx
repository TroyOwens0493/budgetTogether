import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

export function LearnLayout({ children }: { children: ReactNode }) {
	return (
		<div className="learn-shell">
			<header className="learn-header">
				<Link className="brand" to="/learn">
					<span aria-hidden="true">b.</span> budget together
				</Link>
				<Link className="learn-app-link" to="/">
					Back to app <ArrowUpRight aria-hidden="true" size={16} />
				</Link>
			</header>
			<main className="learn-main">{children}</main>
		</div>
	);
}
