/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as annualLeave from "../annualLeave.js";
import type * as attendance from "../attendance.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as departments from "../departments.js";
import type * as finances from "../finances.js";
import type * as leaves from "../leaves.js";
import type * as lib from "../lib.js";
import type * as notifications from "../notifications.js";
import type * as overtimeMigration from "../overtimeMigration.js";
import type * as primeCalculations from "../primeCalculations.js";
import type * as reports from "../reports.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as users from "../users.js";
import type * as workplaces from "../workplaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  annualLeave: typeof annualLeave;
  attendance: typeof attendance;
  auth: typeof auth;
  crons: typeof crons;
  dashboard: typeof dashboard;
  departments: typeof departments;
  finances: typeof finances;
  leaves: typeof leaves;
  lib: typeof lib;
  notifications: typeof notifications;
  overtimeMigration: typeof overtimeMigration;
  primeCalculations: typeof primeCalculations;
  reports: typeof reports;
  seed: typeof seed;
  settings: typeof settings;
  users: typeof users;
  workplaces: typeof workplaces;
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
