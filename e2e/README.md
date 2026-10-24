# Browser tests

Run the existing public authentication screen tests with `pnpm test:e2e`.
They use the app and its configured Convex development deployment.

Run the isolated authenticated task tests with:

```sh
pnpm exec playwright test --config e2e/tasks.config.ts
```

Install the existing dependencies and Playwright Chromium first. The task tests
need a free loopback port 3100. They need no `.env.local`, deployment, accounts,
email service, or bank connection. They run with the existing Node 24+ requirement.

Task tests use a separate Vite cache, `test-results-tasks/`, and
`playwright-report-tasks/` so they can run beside the app and public-screen suite.

Each test creates an in-memory household and separate Alice and Bob browser
contexts. An HTTP-only test session cookie supplies identity. Tests use the real
`BudgetApp`, input validation, and Convex query/mutation handlers, including access,
accounting, and revision checks. The fixture substitutes a small database adapter
and a polling transport for Convex, and starts after authentication. It does not
test Better Auth login, Convex subscriptions, indexes, argument validators, or
deployed service integration. External actions and scheduled jobs fail closed.

The tests cover balanced saves, reopening, reload, repeat saves, invalid amounts,
shared-to-personal funding, saving both budgets again, and concurrent plan and
funding edits by two members. They use accessible labels and public navigation,
so moving `PlanView` to its own module needs no test changes.

Fund tests cover creation with an opening balance, repeating payments and savings
goals, the automatic read-only monthly amount, repeated saves, shared edits,
reload, next-month requirements, and linking a purchase to a fund. These tests
use the real fund calculations and handlers with the isolated database. They do
not change any connected Convex deployment or call a bank.

The test server binds only to `127.0.0.1`, does not read environment files, and is
never part of the app server or build. Each test deletes its household and closes
its contexts in teardown. Server shutdown removes any state left by an interrupted
run. Do not use these fixture endpoints in the deployed app.
