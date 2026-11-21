import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { sections } from "../guides/catalog";
import { LearnLayout } from "../guides/LearnLayout";

export const Route = createFileRoute("/learn/")({
	head: () => ({ meta: [{ title: "Learn | Budget Together" }] }),
	component: LearnIndex,
});

function LearnIndex() {
	return (
		<LearnLayout>
			<h1>Learn</h1>
			{sections.map((section) => (
				<section className="learn-section" key={section.title}>
					<h2>{section.title}</h2>
					<ul className="learn-list">
						{section.guides.map((guide) => (
							<li key={guide.slug}>
								<Link
									className="learn-card"
									to="/learn/$guide"
									params={{ guide: guide.slug }}
								>
									<div>
										<h3>{guide.title}</h3>
										<p>{guide.summary}</p>
									</div>
									<ArrowRight aria-hidden="true" size={20} />
								</Link>
							</li>
						))}
					</ul>
				</section>
			))}
		</LearnLayout>
	);
}
