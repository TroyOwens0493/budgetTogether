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
import type * as classification from "../classification.js";
import type * as contributions from "../contributions.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as http from "../http.js";
import type * as investmentClient from "../investmentClient.js";
import type * as investments from "../investments.js";
import type * as jevClient from "../jevClient.js";
import type * as model_accounting from "../model/accounting.js";
import type * as model_bankImport from "../model/bankImport.js";
import type * as model_categories from "../model/categories.js";
import type * as model_funds from "../model/funds.js";
import type * as model_insights from "../model/insights.js";
import type * as model_investmentImport from "../model/investmentImport.js";
import type * as model_personalFunding from "../model/personalFunding.js";
import type * as model_plans from "../model/plans.js";
import type * as model_projections from "../model/projections.js";
import type * as model_reporting from "../model/reporting.js";
import type * as model_sharedDeletion from "../model/sharedDeletion.js";
import type * as model_spaces from "../model/spaces.js";
import type * as model_transactionClassification from "../model/transactionClassification.js";
import type * as model_transactions from "../model/transactions.js";
import type * as personalAllocations from "../personalAllocations.js";
import type * as plaidClient from "../plaidClient.js";
import type * as projectionTypes from "../projectionTypes.js";
import type * as projections from "../projections.js";
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
  classification: typeof classification;
  contributions: typeof contributions;
  crons: typeof crons;
  email: typeof email;
  http: typeof http;
  investmentClient: typeof investmentClient;
  investments: typeof investments;
  jevClient: typeof jevClient;
  "model/accounting": typeof model_accounting;
  "model/bankImport": typeof model_bankImport;
  "model/categories": typeof model_categories;
  "model/funds": typeof model_funds;
  "model/insights": typeof model_insights;
  "model/investmentImport": typeof model_investmentImport;
  "model/personalFunding": typeof model_personalFunding;
  "model/plans": typeof model_plans;
  "model/projections": typeof model_projections;
  "model/reporting": typeof model_reporting;
  "model/sharedDeletion": typeof model_sharedDeletion;
  "model/spaces": typeof model_spaces;
  "model/transactionClassification": typeof model_transactionClassification;
  "model/transactions": typeof model_transactions;
  personalAllocations: typeof personalAllocations;
  plaidClient: typeof plaidClient;
  projectionTypes: typeof projectionTypes;
  projections: typeof projections;
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
