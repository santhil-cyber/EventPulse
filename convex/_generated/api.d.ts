/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentPipeline from "../agentPipeline.js";
import type * as agents_crowdIntel from "../agents/crowdIntel.js";
import type * as agents_dispatch from "../agents/dispatch.js";
import type * as agents_intake from "../agents/intake.js";
import type * as agents_queries from "../agents/queries.js";
import type * as agents_routing from "../agents/routing.js";
import type * as agents_verification from "../agents/verification.js";
import type * as auth from "../auth.js";
import type * as events from "../events.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as lib_agentLog from "../lib/agentLog.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_safety from "../lib/safety.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_verificationThresholds from "../lib/verificationThresholds.js";
import type * as mapPins from "../mapPins.js";
import type * as memberships from "../memberships.js";
import type * as orchestrator from "../orchestrator.js";
import type * as reports from "../reports.js";
import type * as simulation from "../simulation.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentPipeline: typeof agentPipeline;
  "agents/crowdIntel": typeof agents_crowdIntel;
  "agents/dispatch": typeof agents_dispatch;
  "agents/intake": typeof agents_intake;
  "agents/queries": typeof agents_queries;
  "agents/routing": typeof agents_routing;
  "agents/verification": typeof agents_verification;
  auth: typeof auth;
  events: typeof events;
  files: typeof files;
  http: typeof http;
  "lib/agentLog": typeof lib_agentLog;
  "lib/authz": typeof lib_authz;
  "lib/geo": typeof lib_geo;
  "lib/safety": typeof lib_safety;
  "lib/time": typeof lib_time;
  "lib/verificationThresholds": typeof lib_verificationThresholds;
  mapPins: typeof mapPins;
  memberships: typeof memberships;
  orchestrator: typeof orchestrator;
  reports: typeof reports;
  simulation: typeof simulation;
  users: typeof users;
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
