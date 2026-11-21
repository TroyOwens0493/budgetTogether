# Add a Learn guide

1. Add `src/guides/<guide-slug>.md`. Use lowercase letters, digits, and hyphens in the slug. The filename becomes `/learn/<guide-slug>`.
2. Add `e2e/guides/<guide-slug>.capture.ts` if the guide needs screenshots. Capture and inspect the images, then include the PNGs in `public/learn/<guide-slug>/` with the guide and spec.

Learn discovers guides automatically. Each guide starts with this metadata block. Use plain values and a nonnegative whole number for `order`. The optional `section` defaults to **Guides**. The smallest guide order in each section determines section order. Guides within a section sort by `order`, then by slug. Previous and next links follow the index order.

```markdown
---
title: Getting started
summary: Create your private budget and find your way around Budget Together.
order: 10
section: The basics
---

## Create your account

Select **Create an account**.
```

## Markdown

- Start body headings at `##`. The guide title supplies the page heading. Use blank lines between paragraphs.
- Use `1.` for numbered lists and `-`, `*`, or `+` for bullet lists. Write one item per line. Lists are flat.
- Use `**bold**`, `*italic*`, `` `inline code` ``, and `[link text](/learn/getting-started)`. Links can point to pages on the site, web URLs, or `mailto:` addresses.
- Put each screenshot on its own line with descriptive alt text and an optional caption in double quotes. Follow annotated screenshots with a numbered list that matches the badges.
- Start a callout with `> [!TIP]` or `> [!NOTE]`. Start each following callout line with `>`.
- HTML displays as text. Screenshot paths start with `/learn/` and use the guide's folder.

```markdown
![Two numbered highlights in the navigation menu.](/learn/getting-started/mobile-menu.png "The menu on a phone")

1. Tap **Learn**.
2. Tap **Close navigation** to return to the budget.

> [!TIP]
> You can open **Learn** before you sign in.
```

## Capture screenshots

Run one spec with the existing Playwright Chromium installation. The default port is 3200. Pick a different free loopback port for each concurrent run. Each run creates its own Vite cache and Playwright output under `test-results/guides-<port>-*/`.

```sh
BUDGET_TASK_PORT=3217 pnpm guides:capture getting-started.capture.ts
```

Use the test fixture and `shoot` helper. `household` signs in as Alice in an isolated in-memory household and deletes it after the test. It starts with a shared budget and a fake checking account. For a different starting state, use `test.use({ scenario: "private" })` or choose `"projections"` or `"classification"`. Open `${fixturePage}?screen=auth` with the plain `page` fixture to capture the public auth screen without creating accounts.

```ts
import { api } from "../../convex/_generated/api";
import { expect, fixturePage, test } from "./fixture";
import { shoot } from "./shoot";

test("capture the sidebar", async ({ household: { page, invoke } }) => {
  const home = await invoke(api.budgets.home, {});
  expect(home.spaces.length).toBeGreaterThan(0);
  await page.goto(fixturePage);
  await shoot(page, "getting-started/example", {
    clip: page.locator(".sidebar"),
    annotate: [
      { target: page.getByRole("button", { name: "Overview", exact: true }) },
    ],
  });
});
```

Seed data in your spec with `invoke(api.…, args)` before opening the page, or add data through the UI. The fixture runs registered app handlers against fake data. See `getting-started.capture.ts` for a saved plan, a fund, and several transactions. Bank calls and email delivery stay disabled.

`shoot` writes to `public/learn/<guide-slug>/<image-name>.png` and numbers each target in array order. Set `badge` to `above`, `below`, `left`, or `right` to keep controls legible. Use `clip` to crop to a locator or a viewport rectangle `{ x, y, width, height }`. Keep all targets inside the crop. The default viewport is 1280 × 800 at 1× scale. Call `page.setViewportSize` before navigating for mobile examples. Inspect the resulting PNGs for clear labels, correct highlights, and room around each badge.

## Write for the person using Budget Together

- Use short sentences, plain words, and **you**. Give steps in the order the reader takes them.
- Put exact on-screen labels in **bold**. Follow the terms in [CONTEXT.md](../../CONTEXT.md).
- Explain every badge in a matching numbered list immediately after the screenshot.
- Use fake data in screenshots. Keep implementation details and provider names out of guide text unless the reader sees the name on screen.
