# Budget Together

A responsive US-dollar budgeting app for individuals and couples. Each user has a private budget and can share one budget with one partner. Monthly plans allocate expected income, personal funding, and explicit carry-forward to category limits and a savings target. The app does not move money.

The project uses the existing React, TanStack Start, Tailwind CSS, Convex, Better Auth, Lucide, and Biome stack. The additional `@convex-dev/better-auth` component stores authentication in Convex. Plaid and Resend use their HTTP APIs without additional SDK packages.

## Development

Use Node 24 or later and the pnpm version specified in package.json.

```sh
pnpm install
cp .env.example .env.local
pnpm exec convex dev
```

Sign in to the existing Convex **development** project. Keep `convex dev` running to generate types and sync backend changes. Set `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` in `.env.local` to the development deployment's `.cloud` and `.site` addresses. Do not use a production deployment for this branch.

Set the variables described in `.env.example` on that Convex development deployment. `SITE_URL` is the app origin, usually `http://localhost:3000`. Generate a random Better Auth secret and a base64 key containing 32 random bytes for Plaid token encryption. Keep secrets in deployment environment variables. Browser variables start with `VITE_` and must not contain secrets.

```sh
pnpm dev
```

Open http://localhost:3000. Local authentication also accepts http://127.0.0.1:3000 and http://[::1]:3000 on the same port. Create an account and private budget. Connect a bank, add a monthly plan, and optionally create a shared budget and invite a partner.

`pnpm dev` stops with an error if port `3000` is already in use. It does not switch to a different port. If the app is already running, use that server.

If your SSH tunnel or a second development server uses a different browser address or port, set `AUTH_TRUSTED_ORIGINS` on the same Convex development deployment. This is a comma-separated list of extra addresses. For example, to accept http://localhost:3001 as well as http://localhost:3000:

```sh
pnpm exec convex env set AUTH_TRUSTED_ORIGINS 'http://localhost:3001'
pnpm exec convex dev --once
```

Use the address shown in the browser, including its protocol and port. Each configured loopback address also accepts `localhost`, `127.0.0.1`, and `[::1]` with the same protocol and port. Other addresses must be listed explicitly. Hosted deployments accept only `SITE_URL` and any explicitly configured extra origins. Put this setting on Convex; `.env.local` alone does not configure backend authentication.

## Netlify sandbox deployment

The sandbox app is hosted at https://budget-together-sandbox.netlify.app. Netlify builds and deploys the app when changes are pushed to `main` in `TroyOwens0493/budgetTogether` on GitHub. Development work stays on `dev` and is merged into `main` for deployment.

`netlify.toml` sets the build command to `pnpm build`, the publish directory to `dist`, Node to version 24, and `NITRO_PRESET` to `netlify`. Nitro builds the server function for page rendering and `/api/auth/*`. Deploy the server function with the static files.

Netlify uses `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` from `.env.local` for both builds and server functions. Plaid secrets stay on the existing Convex development deployment. The Plaid client uses Sandbox.

On Convex, `SITE_URL` is the Netlify app address. `AUTH_TRUSTED_ORIGINS` also accepts the local development addresses on ports 3000 and 3001. Keep these addresses when you change the hosted address.

## Bank connectivity and email

This branch uses **Plaid Sandbox only**. It loads Plaid Link from Plaid's hosted script, exchanges public tokens on the backend, encrypts access tokens with AES-GCM, and imports Transactions through the cursor-based sync API. Only checking, savings, and credit card accounts are supported. Sandbox test credentials are documented at https://plaid.com/docs/sandbox/test-credentials/.

The bank event endpoint is `https://<development-deployment>.convex.site/bank-events`. Requests require Plaid's ES256 signature, a recent timestamp, and a matching SHA-256 request-body hash. Bank events trigger imports. A six-hour scheduled job retries active connections. Sync errors retain imported history, show the last successful import, and provide reconnect controls. Disconnecting removes the Plaid Item and retains app history.

Resend sends partner invitations and password reset emails. Configure a verified sender domain and `RESEND_FROM`. Invitation delivery status appears in account settings; a failed invitation can be revoked and replaced. Invitations expire after seven days, require the recipient's email address, and become membership only after acceptance. Reset links use Better Auth's expiration and single-use token handling.

## Agreed product choices

- Shared budgets are called **Shared**. Users do not choose a name. Existing shared budgets also appear as **Shared**.
- Bank accounts start private. Account moves apply to transactions dated from the move date onward. Previously imported records stay in their original budget; earlier private history is never shared.
- A departing partner's accounts return to their private budget. The remaining partner keeps the shared budget active. The departing partner can read records shared before the departure and cannot edit that budget or read later transactions.
- **Shared budgets fund personal budgets**, overriding the contribution direction in the PDF. All planned income goes into the shared monthly plan. Each partner receives a monthly personal allocation from that plan. The allocation reduces shared funding and adds the same amount to personal funding at once; no bank transfer is needed. Both partners can see and edit the amounts, while personal categories, spending, and transactions stay private. Income recorded in a member's personal accounts counts in shared income totals without exposing private entries. This rule starts in the month the member joins; earlier months retain their prior accounting. Existing contribution records stay readable for historical totals.
- **Exclusion was removed at the user's request**, overriding that feature in the PDF. Duplicate manual entries can be reconciled with bank imports instead.
- **Draft and activation steps were removed at the user's request**, overriding those steps in the PDF. Users finish a monthly budget and choose **Save budget**. Every save requires a zero balance. A personal allocation change requires both affected budgets to be balanced and saved again.
- New months start with prior limits for the user to check and save. Monthly review explicitly adds carry-forward to next month's categories or savings target. Repeated reviews replace existing reservations and adjust the destination budget by the difference, including an already saved budget; they do not change historical savings results. Existing records with the former draft/active field stay readable and move to the new saved field when updated.

## API and modules

The PDF's API paths describe conceptual operations. This implementation uses authenticated Convex queries, mutations, and actions. The browser subscribes to queries for shared updates without a page refresh.

`convex/budgets.ts` defines the budget API arguments and connects each operation to a plain TypeScript function in `convex/model/`. These model functions contain access checks, validation, and database operations. They use the caller's Convex context, so each mutation remains one database transaction.

| Budget model | Responsibility |
| --- | --- |
| `spaces.ts` | Profile setup, private-budget creation, and the user's budget list |
| `categories.ts` | Category lists, edits, and deletion with reassignment |
| `accounting.ts` | Planned and actual funding, carry-forward funding, and monthly results |
| `plans.ts` | Monthly plan saves, repetition, initial creation, and reviews |
| `transactions.ts` | Transaction search, edits, deletion, splits, and reconciliation |
| `reporting.ts` | Dashboard data and historical reports |
| `insights.ts` | Recurring-charge suggestions, alerts, and per-user alert read state |

The model modules do not register Convex API functions. `src/domain/budget.ts` contains the budget calculations that the browser and server share. Add reusable budget operations to the model modules and keep the API definitions small.

| Module | Operations |
| --- | --- |
| `auth` and `/api/auth/*` | Registration, sign-in/out, password reset, profile and password changes through Better Auth |
| `budgets` | Setup, dashboard, category CRUD and reassignment, budget save/repeat, transaction search/pagination/CRUD/splits, reconciliation, monthly review, reports, recurring suggestions, alerts |
| `accounts` | Authorized account lists, names, assignment moves, connection status |
| `sharing` | Shared-budget creation, email invitations, acceptance, revocation, leave |
| `personalAllocations` | Shared-to-personal monthly funding amounts; both partners can edit |
| `contributions` | Legacy funding and bank matches for historical months |
| `bank` | Link/update sessions, public-token exchange, sync, disconnect, internal imports |
| `/bank-events` | Verified Plaid bank events |

All money is stored as integer cents. Imported amounts use positive values for purchases/outflows and negative values for income/refunds. Refunds reduce spending. Pending entries are shown separately; posted entries replace pending ones without double counting. Transfers and credit card payments are omitted from income and spending. Splits must equal the transaction amount and use categories in the same budget.

Private access is checked in backend requests as well as UI controls. Mutations use revision numbers to reject outdated edits. The UI reports the conflict; reopening the editor loads current values. Categories can be deleted only with a replacement category. Bank entries retain bank-controlled amounts/dates; only manual entries can be deleted.

## Validation

```sh
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

Tests use Node's built-in test runner. Accounting tests cover cents, balance, refunds, transfers, pending entries, splits, carry-forward, and recurring estimates. Backend tests exercise the actual query/mutation handlers against an in-memory database with stubbed authentication. They check direct private access, stale edits, repeated reviews, account moves, departure cutoffs, contribution matches, and import idempotency. They do not replace live Convex, Plaid, or Resend integration tests.

## Browser tests and Playwright MCP

Playwright Test and Microsoft's Playwright MCP are development dependencies with pinned versions. Install their Chromium browsers after installing dependencies:

```sh
pnpm playwright:install
pnpm test:e2e
```

The tests use http://localhost:3000. They reuse a running development server or start `pnpm dev` when needed. Configure `.env.local` as described above before running them. CI requires a free port 3000 and starts its own server. On a supported Linux CI image, install system dependencies with `pnpm exec playwright install-deps chromium`.

The initial tests check the sign-in, registration, and password-reset screens without creating accounts or sending email. They require the configured Convex development deployment to be available. Node unit tests remain under `pnpm test`.

Use `pnpm test:e2e:ui` for the test UI and `pnpm test:e2e:report` for the HTML report. To test an existing server at another address, run `PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm test:e2e`. This skips automatic server startup. Reports, failure screenshots, and traces are ignored by Git.

Run isolated authenticated task tests with `pnpm exec playwright test --config e2e/tasks.config.ts`. These use the real budget UI and backend handlers with local test sessions and an in-memory database. They require no deployed services. See [the browser test guide](e2e/README.md) for setup, coverage, and limits.

The project configuration at `.codex/config.toml` registers the `playwright` MCP server for Codex. It uses the local package and runs Chromium without a visible window. MCP output goes in `.playwright-mcp/`, which is ignored by Git. Start a new Codex session in this project after setup so it can load the server. Check the configuration with `codex mcp get playwright`. See the [Playwright MCP documentation](https://github.com/microsoft/playwright-mcp) and [official OpenAI MCP documentation](https://developers.openai.com/codex/mcp).

## Current verification limits

The backend has been deployed to the configured Convex development deployment, and its API declarations have been regenerated. Budget edits have been tested in the authenticated UI, including repeated saves and persistence after a page reload. Keep `pnpm exec convex dev` running with `pnpm dev` so backend requests stay in sync with the UI. To sync the backend once, run `pnpm exec convex dev --once`. Registration, reset emails, partner emails, Plaid Link/imports, and two-browser collaboration still need live integration testing.

Persistent Plaid account identifiers prevent duplicate connections where Plaid provides them. When no persistent ID is available, a match on bank, account type, and last four digits pauses the new connection. The user must identify it as the same account (keep the existing import) or a different account (import it). This check includes the current partner's accounts without returning their private account details. Imports, webhooks, and scheduled sync cannot bypass a pending review.

Transaction queries read at most 100 indexed monthly records per page (30 by default), with a 512 KB read limit. They filter that block and return an opaque continuation cursor, without a full match count. Sparse filters can return an empty page with more pages available. Both the transaction table and the reconciliation picker allow continuation.

Bank sync fetches one Plaid page per action and stages at most 100 changes/removals or 512 KB per batch. It fetches the full update before applying changes, then applies removals in a second pass so pending replacements can cross page boundaries. The connection cursor and last successful sync advance only after every batch commits. Imports can become visible in parts while the connection shows `syncing`. Interrupted actions have a delayed retry; failed steps pause until a manual sync, bank event, or scheduled poll resumes them. Pagination mutation errors restart from the saved start cursor, up to three attempts. Run IDs and batch positions reject stale or duplicate workers. Disconnecting cancels the run and removes staged batches in bounded steps, while retaining imported history. Edited classifications, notes, descriptions, and original budget placement survive updates. If a bank amount changes, edited split categories keep their proportions, with any cent remainder in the last category.

These limits apply to transaction pages and each bank sync step. Dashboard, accounting, reporting, and some other monthly queries still read monthly entries in full. The bank poll still reads the connections table in full. These paths need separate scaling work before large production workloads. The in-memory checks cover the staged flow and simulated failures, but do not prove live Convex cursor behavior or live Plaid integration. Recurring suggestions estimate monthly charges from three similar posted entries; estimates are not bill reminders. This branch is not configured for Plaid Production.

## Project workflow

Work is on the `dev` branch. Team membership and project tracking are not yet configured in this repo. Add confirmed team members, sprint goals, and retrospective notes when the team and tracking tool are chosen. Future work includes live acceptance testing, production bank rollout, and larger-history query/import scaling. Investment tracking, payments, groups larger than two, non-US banks, other currencies, reminders, offline support, and subscription billing remain outside scope.
