/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accessControl from "../accessControl.js";
import type * as analytics from "../analytics.js";
import type * as audits from "../audits.js";
import type * as auth from "../auth.js";
import type * as categoryBudgets from "../categoryBudgets.js";
import type * as centipid from "../centipid.js";
import type * as centipidHttp from "../centipidHttp.js";
import type * as centipidUtils from "../centipidUtils.js";
import type * as dataReset from "../dataReset.js";
import type * as distributions from "../distributions.js";
import type * as expenseReceiptHttp from "../expenseReceiptHttp.js";
import type * as expenseReceipts from "../expenseReceipts.js";
import type * as expenseTemplates from "../expenseTemplates.js";
import type * as googleFormHttp from "../googleFormHttp.js";
import type * as googleForms from "../googleForms.js";
import type * as http from "../http.js";
import type * as imports from "../imports.js";
import type * as monthEndClose from "../monthEndClose.js";
import type * as onboarding from "../onboarding.js";
import type * as operations from "../operations.js";
import type * as reconciliationUtils from "../reconciliationUtils.js";
import type * as settings from "../settings.js";
import type * as suppliers from "../suppliers.js";
import type * as users from "../users.js";
import type * as workspace from "../workspace.js";
import type * as workspaceContext from "../workspaceContext.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accessControl: typeof accessControl;
  analytics: typeof analytics;
  audits: typeof audits;
  auth: typeof auth;
  categoryBudgets: typeof categoryBudgets;
  centipid: typeof centipid;
  centipidHttp: typeof centipidHttp;
  centipidUtils: typeof centipidUtils;
  dataReset: typeof dataReset;
  distributions: typeof distributions;
  expenseReceiptHttp: typeof expenseReceiptHttp;
  expenseReceipts: typeof expenseReceipts;
  expenseTemplates: typeof expenseTemplates;
  googleFormHttp: typeof googleFormHttp;
  googleForms: typeof googleForms;
  http: typeof http;
  imports: typeof imports;
  monthEndClose: typeof monthEndClose;
  onboarding: typeof onboarding;
  operations: typeof operations;
  reconciliationUtils: typeof reconciliationUtils;
  settings: typeof settings;
  suppliers: typeof suppliers;
  users: typeof users;
  workspace: typeof workspace;
  workspaceContext: typeof workspaceContext;
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

export declare const components: {};
