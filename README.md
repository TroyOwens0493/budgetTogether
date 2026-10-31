# Budget Together

A responsive US-dollar budgeting app for individuals and couples. Each user has a private budget and can share one budget with one partner. Monthly plans allocate expected income, personal funding, and explicit carry-forward to category limits and a savings target. The app does not move money.

The project uses the existing React, TanStack Start, Tailwind CSS, Convex, Better Auth, Lucide, and Biome stack. The additional `@convex-dev/better-auth` component stores authentication in Convex. Plaid and Resend use their HTTP APIs without additional SDK packages.

## Development

Use Node 24 or later and the pnpm version specified in package.json.

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

On the first run, sign in to the existing Convex **development** project. Set `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` in `.env.local` to the development deployment's `.cloud` and `.site` addresses. Do not use a production deployment for this branch.

Set the variables described in `.env.example` on that Convex development deployment. `SITE_URL` is the app origin, usually `http://localhost:3000`. Generate a random Better Auth secret and a base64 key containing 32 random bytes for Plaid token encryption. Keep secrets in deployment environment variables. Browser variables start with `VITE_` and must not contain secrets.

`pnpm dev` generates backend types and syncs the Convex development deployment before starting the web server. Keep it running to watch and update both the backend and the web app. Ctrl+C stops both processes. No separate `convex dev` terminal is needed.

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

## Transaction classification

TypeSafe Jev chooses the transaction type (purchase/refund, income, or transfer) and a category from that transaction's budget. Plaid supplies bank records; its categories are not used. The HTTP client calls `https://api.typesafe.ai/v1/systemone` with the fixed `jev-1.14.0` model and no added SDK package. Set `JEV_SECRET` on the Convex development deployment. A local `.env.local` value alone does not configure Convex. To enter the key without putting it in shell history, run `pnpm exec convex env set JEV_SECRET` and enter it at the private prompt.

Each import queues classification after the bank record commits. New records start as uncategorized purchases. Existing records keep their last type and category while waiting. The app shows that totals can change while classification is pending or needs review. Failures retain the bank import and retry after 30 seconds, doubling the delay up to six hours. A one-minute lease and watchdog recover interrupted jobs. The five-minute recovery job also finds legacy imports in indexed batches of 50, including retained history from disconnected banks.

Jev receives only the bank description, merchant when available, amount in cents, date, pending status, account type, currency, and the category names for that budget. It does not receive bank credentials, account identifiers, user identifiers, private notes, other budgets' categories, or Plaid's classification. Legacy imports use their saved description when the original bank description is unavailable. Each answer records the model version and confidence. Income and transfers have no category splits; refunds remain purchases with negative spending.

The app applies Jev's best answer and marks it **Needs review** if type confidence is below 0.8, purchase category confidence is below 0.8, or no purchase category fits. Open the transaction, check its type and category, and save to clear the flag. Manual changes, splits, reconciliation, and confirmed contribution matches take priority over Jev and future bank updates. A result is discarded if the transaction changes during the request. Category changes during a request cause a fresh classification. The client supports up to 254 budget categories plus an uncategorized option; a larger category list stays pending with a configuration error instead of silently omitting categories.

`convex/jevClient.ts` owns the TypeSafe request and response format. `convex/model/transactionClassification.ts` owns scheduling state, retries, stale-result checks, and applying decisions. `convex/classification.ts` registers the small internal API. To start legacy classification immediately after syncing the backend, run `pnpm exec convex run classification:poll '{}'`. The recovery job also starts it automatically.

## Agreed product choices

- Shared budgets are called **Shared**. Users do not choose a name. Existing shared budgets also appear as **Shared**.
- Bank accounts start private. Account moves apply to transactions dated from the move date onward. Previously imported records stay in their original budget; earlier private history is never shared.
- Leaving permanently deletes the shared budget and its records for both people, overriding history retention in the PDF. Both partners' shared accounts return to their own private budgets. Private records and bank connections remain. Old bank imports from deleted shared periods are ignored. Only bank transaction identifiers are retained to prevent deleted entries and pending replacements from being imported again; no budget or transaction content is kept in these markers. Large transaction histories are deleted in background batches after access is removed.
- **Shared budgets fund personal budgets**, overriding the contribution direction in the PDF. All planned income goes into the shared monthly plan. Each partner receives a monthly personal allocation from that plan. The allocation reduces shared funding and adds the same amount to personal funding at once; no bank transfer is needed. Both partners can see and edit the amounts, while personal categories, spending, and transactions stay private. Income recorded in a member's personal accounts counts in shared income totals without exposing private entries. This rule starts in the month the member joins; earlier months retain their prior accounting. Existing contribution records stay readable for historical totals.
- **Exclusion was removed at the user's request**, overriding that feature in the PDF. Duplicate manual entries can be reconciled with bank imports instead.
- **Draft and activation steps were removed at the user's request**, overriding those steps in the PDF. Users finish a monthly budget and choose **Save budget**. Every save requires a zero balance. A personal allocation change requires both affected budgets to be balanced and saved again.
- New months start with prior limits for the user to check and save. Existing records with the former draft/active field stay readable and move to the new saved field when updated.
- **Category overspending appears as a red notice in Monthly budget.** Notices have an X button and no automatic timeout. Dismissing a notice marks that alert as read for the current user and month; each partner has a separate read status.
- **The Monthly review page was removed at the user's request**, overriding that screen in the PDF. The app no longer provides a screen for assigning leftovers to next month. Existing carry-forward records and backend calculations remain supported so saved budgets and historical results stay intact.

## Funds

The **Funds** tab plans repeating payments and one-time savings goals. A repeating payment has an amount, a next payment month, and a frequency of 2 to 120 months. A savings goal has a target amount and either a target month or a monthly amount. Each fund can start with money already saved. That opening balance and the start month stay fixed after creation. Fund settings can change from a selected month without changing earlier months. Pause controls are not included.

The monthly budget has one automatic, read-only **Funds** row when funds exist. Its amount is the sum of the contributions needed that month. Calculations include the target month, use saved contributions from earlier months, and round up to whole cents. For example, an empty $600 fund due in three months needs $200 per month. A later six-month cycle needs $100 per month. A missed budget increases the amount needed in the remaining months. A one-time goal stops requiring contributions when it is funded.

Saving a balanced monthly budget reserves each fund's contribution. Saving the same month again replaces its reservations; it does not add them twice. Copying a budget does not reserve money in the next month until that budget is saved. These are budget reservations, not bank deposits or proof of account balances. The app does not move money. Expected income, category limits, the general savings target, fund reservations, and other budget funding must balance together.

Select a fund for a purchase or refund split in **Transactions**. Posted purchases reduce the fund balance, and refunds restore it. Pending imports stay separate. Actual spending reports still include the payment and its category, while the regular category's budget balance excludes the funded part. Fund reservations cannot also be assigned as carry-forward. Bank corrections and reconciliation retain fund links. A negative fund balance is shown without blocking the bank import. Changes in a prior budget or fund settings can require later budgets to be balanced and saved again.

`src/domain/funds.ts` owns the shared monthly calculation. `convex/model/funds.ts` owns access, effective-month settings, and fund summaries. Saved plans store their fund allocations. A separate transaction index reads only entries with fund links when calculating balances. Funds and saved-plan history are still read in full for a budget space and need separate scaling work before large production workloads.

## Investment forecasts

The **Projections** tab uses the current month's saved savings target. Monthly investment contributions use part of that target; the remainder goes to cash savings. Contributions arrive at month end, and effective annual returns compound monthly. A missing saved budget, missing return, or contributions above the target blocks the graphs.

Set `TIINGO_API_TOKEN` on the Convex development deployment to load historical returns. The backend requests [Tiingo's adjusted monthly prices](https://www.tiingo.com/documentation/end-of-day), which account for splits and dividends, and calculates compound annual growth over ten years or the available shorter history. At least one year is required. The holding shows the actual observation dates. Successful lookups are cached for 30 days; failed lookups can retry after one minute, within the existing 25-request daily cap. A manual annual return can be entered when a symbol has no supported history. Forecasts assume the current savings plan and selected returns continue.

## API and modules

The PDF's API paths describe conceptual operations. This implementation uses authenticated Convex queries, mutations, and actions. The browser subscribes to queries for shared updates without a page refresh.

`convex/budgets.ts` defines the budget API arguments and connects each operation to a plain TypeScript function in `convex/model/`. These model functions contain access checks, validation, and database operations. They use the caller's Convex context, so each mutation remains one database transaction.

| Budget model | Responsibility |
| --- | --- |
| `spaces.ts` | Profile setup, private-budget creation, and the user's budget list |
| `categories.ts` | Category lists, edits, and deletion with reassignment |
| `funds.ts` | Fund settings, monthly requirements, reserved balances, and transaction-link validation |
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

The backend, including bank-sync tables, indexes, and Jev classification, is synced to the configured Convex development deployment. Jev was tested with a synthetic purchase and classified all 178 existing bank transactions; 37 required review and none failed. Isolated browser tests cover budget saves, persistence after reload, personal funding, classification review, and edits from two sessions using real UI and backend handlers with an in-memory database. Keep `pnpm dev` running so backend requests stay in sync with the UI. To sync the backend once, run `pnpm exec convex dev --once`. Registration, reset emails, partner emails, Plaid Link/imports, and live two-browser collaboration still need integration testing.

Persistent Plaid account identifiers prevent duplicate connections where Plaid provides them. When no persistent ID is available, a match on bank, account type, and last four digits pauses the new connection. The user must identify it as the same account (keep the existing import) or a different account (import it). This check includes the current partner's accounts without returning their private account details. Imports, webhooks, and scheduled sync cannot bypass a pending review.

Transaction queries read at most 100 indexed monthly records per page (30 by default), with a 512 KB read limit. They filter that block and return an opaque continuation cursor, without a full match count. Sparse filters can return an empty page with more pages available. Both the transaction table and the reconciliation picker allow continuation.

Bank sync fetches one Plaid page per action and stages at most 100 changes/removals or 512 KB per batch. It fetches the full update before applying changes, then applies removals in a second pass so pending replacements can cross page boundaries. The connection cursor and last successful sync advance only after every batch commits. Imports can become visible in parts while the connection shows `syncing`. Interrupted actions have a delayed retry; failed steps pause until a manual sync, bank event, or scheduled poll resumes them. Pagination mutation errors restart from the saved start cursor, up to three attempts. Run IDs and batch positions reject stale or duplicate workers. Disconnecting cancels the run and removes staged batches in bounded steps, while retaining imported history. Edited classifications, notes, descriptions, and original budget placement survive updates. If a bank amount changes, edited split categories keep their proportions, with any cent remainder in the last category.

These limits apply to transaction pages and each bank sync step. Dashboard, accounting, reporting, and some other monthly queries still read monthly entries in full. The bank poll still reads the connections table in full. These paths need separate scaling work before large production workloads. The in-memory checks cover the staged flow and simulated failures, but do not prove live Convex cursor behavior or live Plaid integration. Recurring suggestions estimate monthly charges from three similar posted entries; estimates are not bill reminders. This branch is not configured for Plaid Production.

## Project workflow

Work is on the `dev` branch. Team membership and project tracking are not yet configured in this repo. Add confirmed team members, sprint goals, and retrospective notes when the team and tracking tool are chosen. Future work includes live acceptance testing, production bank rollout, and larger-history query/import scaling. Investment tracking, payments, groups larger than two, non-US banks, other currencies, reminders, offline support, and subscription billing remain outside scope.
