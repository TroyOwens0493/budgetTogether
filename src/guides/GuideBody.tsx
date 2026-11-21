import { Fragment } from "react";
import type { Block, Inline } from "./markdown";

const headings = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function GuideInline({ content }: { content: Inline[] }) {
	return content.map((node, index) => (
		// Parsed content is static and keeps its document order.
		// biome-ignore lint/suspicious/noArrayIndexKey: Static Markdown nodes have no identity beyond their position.
		<Fragment key={index}>
			{node.type === "text" && node.text}
			{node.type === "code" && <code>{node.text}</code>}
			{node.type === "strong" && (
				<strong>
					<GuideInline content={node.content} />
				</strong>
			)}
			{node.type === "emphasis" && (
				<em>
					<GuideInline content={node.content} />
				</em>
			)}
			{node.type === "link" && (
				<a href={node.href}>
					<GuideInline content={node.content} />
				</a>
			)}
		</Fragment>
	));
}

function GuideBlock({ block }: { block: Block }) {
	switch (block.type) {
		case "heading": {
			const Heading = headings[block.level - 1];
			return (
				<Heading>
					<GuideInline content={block.content} />
				</Heading>
			);
		}
		case "paragraph":
			return (
				<p>
					<GuideInline content={block.content} />
				</p>
			);
		case "list": {
			const List = block.start === undefined ? "ul" : "ol";
			return (
				<List start={block.start}>
					{block.items.map((item, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: Static Markdown items keep their document order.
						<li key={index}>
							<GuideInline content={item} />
						</li>
					))}
				</List>
			);
		}
		case "image":
			return (
				<figure>
					<img src={block.src} alt={block.alt} decoding="async" />
					{block.caption.length > 0 && (
						<figcaption>
							<GuideInline content={block.caption} />
						</figcaption>
					)}
				</figure>
			);
		case "callout":
			return (
				<aside className={`learn-callout ${block.kind}`}>
					<strong>{block.kind === "tip" ? "Tip" : "Note"}</strong>
					<p>
						<GuideInline content={block.content} />
					</p>
				</aside>
			);
	}
}

export function GuideBody({ blocks }: { blocks: Block[] }) {
	return blocks.map((block, index) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: Static Markdown blocks keep their document order.
		<GuideBlock key={index} block={block} />
	));
}
