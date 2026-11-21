export type Inline =
	| { type: "text" | "code"; text: string }
	| { type: "strong" | "emphasis"; content: Inline[] }
	| { type: "link"; href: string; content: Inline[] };

export type Block =
	| { type: "heading"; level: number; content: Inline[] }
	| { type: "paragraph"; content: Inline[] }
	| { type: "list"; start?: number; items: Inline[][] }
	| { type: "image"; src: string; alt: string; caption: Inline[] }
	| { type: "callout"; kind: "tip" | "note"; content: Inline[] };

const heading = /^(#{1,6})\s+(.+)$/;
const listItem = /^(?:(\d{1,9})\.|[-*+])\s+(.+)$/;
const image = /^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/;
const callout = /^>\s*\[!(TIP|NOTE)\](?:\s+(.*))?$/i;

function safeLink(href: string) {
	if (href.startsWith("//") || /[\\\s\p{Cc}]/u.test(href)) return false;
	const scheme = href.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
	return (
		!scheme || scheme === "https" || scheme === "http" || scheme === "mailto"
	);
}

function parseInline(source: string, links = true): Inline[] {
	const tokens =
		/`([^`]+)`|!?\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
	const content: Inline[] = [];
	let offset = 0;
	for (const match of source.matchAll(tokens)) {
		const [raw, code, label, href, strong, emphasis] = match;
		const start = match.index;
		if (start > offset)
			content.push({ type: "text", text: source.slice(offset, start) });
		if (code !== undefined) content.push({ type: "code", text: code });
		else if (
			href !== undefined &&
			links &&
			!raw.startsWith("!") &&
			safeLink(href)
		)
			content.push({ type: "link", href, content: parseInline(label, false) });
		else if (strong !== undefined)
			content.push({ type: "strong", content: parseInline(strong, links) });
		else if (emphasis !== undefined)
			content.push({ type: "emphasis", content: parseInline(emphasis, links) });
		else content.push({ type: "text", text: raw });
		offset = start + raw.length;
	}
	if (offset < source.length)
		content.push({ type: "text", text: source.slice(offset) });
	return content;
}

function guideImage(line: string) {
	const match = line.match(image);
	if (!match) return;
	const src = match[2];
	if (/^\/learn\/[\w-]+\/[\w-][\w.-]*\.(?:png|jpe?g|webp|gif|avif)$/i.test(src))
		return match;
}

export function parseMarkdown(source: string): Block[] {
	const lines = source.split(/\r?\n/).map((line) => line.trim());
	const blocks: Block[] = [];
	let paragraph: string[] = [];
	function finishParagraph() {
		if (!paragraph.length) return;
		blocks.push({
			type: "paragraph",
			content: parseInline(paragraph.join(" ")),
		});
		paragraph = [];
	}
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const title = line.match(heading);
		const item = line.match(listItem);
		const picture = guideImage(line);
		const alert = line.match(callout);
		if (line && !title && !item && !picture && !alert) {
			paragraph.push(line);
			continue;
		}
		finishParagraph();
		if (title) {
			blocks.push({
				type: "heading",
				level: title[1].length,
				content: parseInline(title[2]),
			});
		} else if (item) {
			const ordered = item[1] !== undefined;
			const items = [parseInline(item[2])];
			for (
				let next = lines[index + 1]?.match(listItem);
				next && (next[1] !== undefined) === ordered;
				next = lines[index + 1]?.match(listItem)
			) {
				items.push(parseInline(next[2]));
				index++;
			}
			blocks.push({
				type: "list",
				start: ordered ? Number(item[1]) : undefined,
				items,
			});
		} else if (picture) {
			blocks.push({
				type: "image",
				alt: picture[1],
				src: picture[2],
				caption: parseInline(picture[3] ?? ""),
			});
		} else if (alert) {
			const body = [alert[2] ?? ""];
			while (
				lines[index + 1]?.startsWith(">") &&
				!callout.test(lines[index + 1])
			) {
				body.push(lines[++index].slice(1).trim());
			}
			blocks.push({
				type: "callout",
				kind: alert[1].toLowerCase() === "tip" ? "tip" : "note",
				content: parseInline(body.filter(Boolean).join(" ")),
			});
		}
	}
	finishParagraph();
	return blocks;
}
