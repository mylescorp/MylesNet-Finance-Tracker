/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as analytics from "../analytics.js";
import type * as centipid from "../centipid.js";
import type * as centipidHttp from "../centipidHttp.js";
import type * as centipidUtils from "../centipidUtils.js";
import type * as distributions from "../distributions.js";
import type * as http from "../http.js";
import type * as imports from "../imports.js";
import type * as operations from "../operations.js";
import type * as settings from "../settings.js";
import type * as users from "../users.js";
import type * as workspace from "../workspace.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  analytics: typeof analytics;
  centipid: typeof centipid;
  centipidHttp: typeof centipidHttp;
  centipidUtils: typeof centipidUtils;
  distributions: typeof distributions;
  http: typeof http;
  imports: typeof imports;
  operations: typeof operations;
  settings: typeof settings;
  users: typeof users;
  workspace: typeof workspace;
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
