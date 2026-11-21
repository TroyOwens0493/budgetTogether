import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";

type Rect = { x: number; y: number; width: number; height: number };
type Annotation = {
	target: Locator;
	badge?: "above" | "below" | "left" | "right";
};
const overlayId = "guide-capture-overlay";

function contains(outer: Rect, inner: Rect) {
	return (
		inner.width > 0 &&
		inner.height > 0 &&
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

export async function shoot(
	page: Page,
	name: string,
	{ annotate, clip }: { annotate: Annotation[]; clip?: Locator | Rect },
) {
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
		throw new Error("A screenshot name must use guide-slug/image-name.");
	const viewport = page.viewportSize();
	if (!viewport) throw new Error("Guide screenshots need a fixed viewport.");
	const frame = { x: 0, y: 0, ...viewport };
	const locator = clip && "boundingBox" in clip ? clip : undefined;
	await locator?.scrollIntoViewIfNeeded();
	for (const { target } of annotate) await target.waitFor({ state: "visible" });
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	const region =
		clip && "boundingBox" in clip ? await clip.boundingBox() : (clip ?? frame);
	if (!region || !contains(frame, region))
		throw new Error(
			"The screenshot crop must fit entirely inside the viewport.",
		);
	const badges = await Promise.all(
		annotate.map(async ({ target, badge }, index) => {
			const rect = await target.boundingBox();
			if (!rect || !contains(region, rect))
				throw new Error(
					`Annotation ${index + 1} must fit inside the screenshot crop: ${target}`,
				);
			return { rect, label: String(index + 1), badge: badge ?? "above" };
		}),
	);
	const path = fileURLToPath(
		new URL(`../../public/learn/${name}.png`, import.meta.url),
	);
	await mkdir(dirname(path), { recursive: true });

	await page.evaluate(
		({ badges, region, overlayId }) => {
			const overlay = document.createElement("div");
			overlay.id = overlayId;
			overlay.setAttribute("aria-hidden", "true");
			overlay.style.cssText =
				"position:fixed;inset:0;z-index:2147483647;pointer-events:none";
			const size = 30;
			for (const { rect, label, badge } of badges) {
				const outline = document.createElement("div");
				outline.style.cssText = `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;border-radius:7px;box-shadow:0 0 0 2px #28634f,0 0 0 4px #fff`;
				const marker = document.createElement("div");
				const centerX = rect.x + (rect.width - size) / 2;
				const centerY = rect.y + (rect.height - size) / 2;
				const x =
					badge === "left"
						? rect.x - size - 7
						: badge === "right"
							? rect.x + rect.width + 7
							: centerX;
				const y =
					badge === "above"
						? rect.y - size - 7
						: badge === "below"
							? rect.y + rect.height + 7
							: centerY;
				const left = Math.max(
					region.x + 3,
					Math.min(x, region.x + region.width - size - 3),
				);
				const top = Math.max(
					region.y + 3,
					Math.min(y, region.y + region.height - size - 3),
				);
				marker.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${size}px;height:${size}px;display:grid;place-items:center;border:2px solid #fff;border-radius:50%;background:#28634f;color:#fff;font:700 16px/1 system-ui;box-shadow:0 1px 3px #26363055`;
				marker.textContent = label;
				overlay.append(outline, marker);
			}
			const modal = document.querySelector("dialog:modal");
			(modal ?? document.body).append(overlay);
		},
		{ badges, region, overlayId },
	);

	try {
		await page.screenshot({
			path,
			clip: region,
			animations: "disabled",
			caret: "hide",
			scale: "css",
		});
	} finally {
		await page.evaluate(
			(id) => document.getElementById(id)?.remove(),
			overlayId,
		);
	}
}
