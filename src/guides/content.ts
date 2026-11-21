import { type Block, parseMarkdown } from "./markdown";

export type Guide = {
	slug: string;
	title: string;
	summary: string;
	order: number;
	section?: string;
	body: Block[];
};

export function parseGuide(slug: string, source: string): Guide {
	const [opening, ...lines] = source.trimStart().split(/\r?\n/);
	const end = lines.indexOf("---");
	if (opening !== "---" || end < 0)
		throw new Error(`Guide ${slug} needs a front matter block.`);

	const fields = new Map<string, string>();
	for (const line of lines.slice(0, end)) {
		const match = line.match(/^(title|summary|order|section):\s*(.+)$/);
		if (!match || !match[2].trim() || fields.has(match[1]))
			throw new Error(`Invalid front matter in guide ${slug}: ${line}`);
		fields.set(match[1], match[2].trim());
	}
	const title = fields.get("title");
	const summary = fields.get("summary");
	const orderText = fields.get("order") ?? "";
	const order = Number(orderText);
	if (
		!title ||
		!summary ||
		!/^\d+$/.test(orderText) ||
		!Number.isSafeInteger(order)
	)
		throw new Error(
			`Guide ${slug} needs a title, summary, and whole-number order.`,
		);

	return {
		slug,
		title,
		summary,
		order,
		section: fields.get("section"),
		body: parseMarkdown(lines.slice(end + 1).join("\n")),
	};
}

export function groupGuides(guides: readonly Guide[]) {
	const sections = new Map<string, Guide[]>();
	for (const guide of [...guides].sort(
		(a, b) => a.order - b.order || a.slug.localeCompare(b.slug, "en"),
	)) {
		const section = guide.section ?? "Guides";
		const group = sections.get(section);
		if (group) group.push(guide);
		else sections.set(section, [guide]);
	}
	return [...sections].map(([title, guides]) => ({ title, guides }));
}
