/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as accounts from "../accounts.js";
import type * as auth from "../auth.js";
import type * as authOrigins from "../authOrigins.js";
import type * as bank from "../bank.js";
import type * as bankTypes from "../bankTypes.js";
import type * as budgets from "../budgets.js";
import type * as contributions from "../contributions.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as http from "../http.js";
import type * as model_accounting from "../model/accounting.js";
import type * as model_bankImport from "../model/bankImport.js";
import type * as model_categories from "../model/categories.js";
import type * as model_funds from "../model/funds.js";
import type * as model_insights from "../model/insights.js";
import type * as model_personalFunding from "../model/personalFunding.js";
import type * as model_plans from "../model/plans.js";
import type * as model_reporting from "../model/reporting.js";
import type * as model_spaces from "../model/spaces.js";
import type * as model_transactions from "../model/transactions.js";
import type * as personalAllocations from "../personalAllocations.js";
import type * as plaidClient from "../plaidClient.js";
import type * as sharing from "../sharing.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  accounts: typeof accounts;
  auth: typeof auth;
  authOrigins: typeof authOrigins;
  bank: typeof bank;
  bankTypes: typeof bankTypes;
  budgets: typeof budgets;
  contributions: typeof contributions;
  crons: typeof crons;
  email: typeof email;
  http: typeof http;
  "model/accounting": typeof model_accounting;
  "model/bankImport": typeof model_bankImport;
  "model/categories": typeof model_categories;
  "model/funds": typeof model_funds;
  "model/insights": typeof model_insights;
  "model/personalFunding": typeof model_personalFunding;
  "model/plans": typeof model_plans;
  "model/reporting": typeof model_reporting;
  "model/spaces": typeof model_spaces;
  "model/transactions": typeof model_transactions;
  personalAllocations: typeof personalAllocations;
  plaidClient: typeof plaidClient;
  sharing: typeof sharing;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
