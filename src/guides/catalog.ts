import { groupGuides, parseGuide } from "./content";

export const sections = groupGuides(
	Object.entries(
		import.meta.glob<string>("./*.md", {
			query: "?raw",
			import: "default",
			eager: true,
		}),
	).map(([path, source]) => {
		const slug = path.match(/^\.\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/)?.[1];
		if (!slug) throw new Error(`Invalid guide filename: ${path}`);
		return parseGuide(slug, source);
	}),
);

export const guides = sections.flatMap((section) => section.guides);
