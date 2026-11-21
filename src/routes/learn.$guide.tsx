import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { guides } from "../guides/catalog";
import { GuideBody } from "../guides/GuideBody";
import { LearnLayout } from "../guides/LearnLayout";

export const Route = createFileRoute("/learn/$guide")({
	loader: ({ params }) => {
		const index = guides.findIndex((guide) => guide.slug === params.guide);
		if (index < 0) throw notFound();
		return index;
	},
	head: ({ loaderData: index }) => ({
		meta: [
			{
				title:
					index === undefined
						? "Guide not found | Budget Together"
						: `${guides[index].title} | Budget Together`,
			},
		],
	}),
	component: GuidePage,
	notFoundComponent: () => (
		<LearnLayout>
			<h1>Guide not found</h1>
			<Link className="learn-back" to="/learn">
				All guides
			</Link>
		</LearnLayout>
	),
});

function GuidePage() {
	const index = Route.useLoaderData();
	const guide = guides[index];
	const previous = guides[index - 1];
	const next = guides[index + 1];

	return (
		<LearnLayout>
			<Link className="learn-back" to="/learn">
				<ArrowLeft aria-hidden="true" size={16} /> All guides
			</Link>
			<article className="learn-article">
				<h1>{guide.title}</h1>
				<p className="learn-summary">{guide.summary}</p>
				<GuideBody blocks={guide.body} />
			</article>
			{(previous || next) && (
				<nav className="learn-pagination" aria-label="More guides">
					{previous && (
						<Link
							to="/learn/$guide"
							params={{ guide: previous.slug }}
							className="learn-card"
						>
							<div>
								<small>Previous guide</small>
								{previous.title}
							</div>
						</Link>
					)}
					{next && (
						<Link
							to="/learn/$guide"
							params={{ guide: next.slug }}
							className="learn-card"
						>
							<div>
								<small>Next guide</small>
								{next.title}
							</div>
						</Link>
					)}
				</nav>
			)}
		</LearnLayout>
	);
}
