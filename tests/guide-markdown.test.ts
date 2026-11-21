import assert from "node:assert/strict";
import { test } from "node:test";
import { groupGuides, parseGuide } from "../src/guides/content";
import { parseMarkdown } from "../src/guides/markdown";

const text = (value: string) => ({ type: "text", text: value });

test("guide Markdown parses headings, wrapped paragraphs, and inline formatting", () => {
	assert.deepEqual(
		parseMarkdown(
			"## Find **Learn**\n\nUse the *sidebar*\nto open `Learn` and [all guides](/learn).",
		),
		[
			{
				type: "heading",
				level: 2,
				content: [text("Find "), { type: "strong", content: [text("Learn")] }],
			},
			{
				type: "paragraph",
				content: [
					text("Use the "),
					{ type: "emphasis", content: [text("sidebar")] },
					text(" to open "),
					{ type: "code", text: "Learn" },
					text(" and "),
					{ type: "link", href: "/learn", content: [text("all guides")] },
					text("."),
				],
			},
		],
	);
});

test("a screenshot keeps its caption, followed by a separate numbered list", () => {
	assert.deepEqual(
		parseMarkdown(
			'![Two badges](/learn/tour/menu.png "The **menu**")\n\n1. Open\n2. Close\n\n- Desktop\n- Mobile',
		),
		[
			{
				type: "image",
				alt: "Two badges",
				src: "/learn/tour/menu.png",
				caption: [text("The "), { type: "strong", content: [text("menu")] }],
			},
			{ type: "list", start: 1, items: [[text("Open")], [text("Close")]] },
			{
				type: "list",
				start: undefined,
				items: [[text("Desktop")], [text("Mobile")]],
			},
		],
	);
});

test("tip and note blocks keep their own content", () => {
	assert.deepEqual(
		parseMarkdown(
			"> [!TIP]\r\n> Select **Learn**.\r\n> This opens the guide index.\r\n> [!note] Read this.",
		),
		[
			{
				type: "callout",
				kind: "tip",
				content: [
					text("Select "),
					{ type: "strong", content: [text("Learn")] },
					text(". This opens the guide index."),
				],
			},
			{ type: "callout", kind: "note", content: [text("Read this.")] },
		],
	);
});

test("HTML, unsafe link protocols, and external or out-of-directory images stay text", () => {
	for (const source of [
		'<img src="x" onerror="alert(1)">',
		"[Click](JaVaScRiPt:alert)",
		"[Click](data:text/html,boom)",
		"[Click](java\tscript:alert)",
		"[Click](//example.test/path)",
		"[Click](/\\example.test/path)",
		"![Picture](https://example.test/picture.png)",
		"![Picture](/learn/../picture.png)",
	])
		assert.deepEqual(parseMarkdown(source), [
			{ type: "paragraph", content: [text(source)] },
		]);
	assert.deepEqual(
		parseMarkdown("[**Read more**](https://example.test/guide)"),
		[
			{
				type: "paragraph",
				content: [
					{
						type: "link",
						href: "https://example.test/guide",
						content: [{ type: "strong", content: [text("Read more")] }],
					},
				],
			},
		],
	);
});

test("front matter separates metadata and sorts guides by section and order", () => {
	const guide = (slug: string, order: number, section?: string) =>
		parseGuide(
			slug,
			`---\r\ntitle: Your budget: ${slug}\r\nsummary: A short summary.\r\norder: ${order}\r\n${section ? `section: ${section}\r\n` : ""}---\r\n\r\n## Set up`,
		);
	const first = guide("first", 10, "Basics");
	assert.equal(first.title, "Your budget: first");
	assert.equal(first.summary, "A short summary.");
	assert.deepEqual(first.body, [
		{ type: "heading", level: 2, content: [text("Set up")] },
	]);
	assert.deepEqual(
		groupGuides([
			guide("third", 30, "Basics"),
			guide("second", 20),
			first,
			guide("fourth", 30, "Basics"),
		]).map(({ title, guides }) => [title, ...guides.map(({ slug }) => slug)]),
		[
			["Basics", "first", "fourth", "third"],
			["Guides", "second"],
		],
	);
});

test("missing, duplicate, and invalid guide metadata fail with the guide slug", () => {
	for (const source of [
		"## No front matter",
		"---\ntitle: Missing summary\norder: 10\n---",
		"---\ntitle: Duplicate\nsummary: A summary\norder: 10\norder: 20\n---",
		"---\ntitle: Bad order\nsummary: A summary\norder: 1.5\n---",
	])
		assert.throws(() => parseGuide("example", source), /guide example/i);
});
