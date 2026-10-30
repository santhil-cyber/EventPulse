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
import type * as ai_actions from "../ai/actions.js";
import type * as ai_contracts from "../ai/contracts.js";
import type * as ai_duplicates from "../ai/duplicates.js";
import type * as ai_knowledge from "../ai/knowledge.js";
import type * as ai_knowledgeActions from "../ai/knowledgeActions.js";
import type * as ai_policy from "../ai/policy.js";
import type * as ai_provider from "../ai/provider.js";
import type * as ai_resources from "../ai/resources.js";
import type * as ai_semanticIntake from "../ai/semanticIntake.js";
import type * as ai_semanticMatch from "../ai/semanticMatch.js";
import type * as ai_state from "../ai/state.js";
import type * as ai_validators from "../ai/validators.js";
import type * as auth from "../auth.js";
import type * as events from "../events.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as lib_agentLog from "../lib/agentLog.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_dedup from "../lib/dedup.js";
import type * as lib_dispatchPolicy from "../lib/dispatchPolicy.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_intakeRules from "../lib/intakeRules.js";
import type * as lib_reportGroup from "../lib/reportGroup.js";
import type * as lib_routeGraph from "../lib/routeGraph.js";
import type * as lib_safety from "../lib/safety.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_verificationThresholds from "../lib/verificationThresholds.js";
import type * as mapPins from "../mapPins.js";
import type * as memberships from "../memberships.js";
import type * as orchestrator from "../orchestrator.js";
import type * as reports from "../reports.js";
import type * as responders from "../responders.js";
import type * as simulation from "../simulation.js";
import type * as telemetry from "../telemetry.js";
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
  "ai/actions": typeof ai_actions;
  "ai/contracts": typeof ai_contracts;
  "ai/duplicates": typeof ai_duplicates;
  "ai/knowledge": typeof ai_knowledge;
  "ai/knowledgeActions": typeof ai_knowledgeActions;
  "ai/policy": typeof ai_policy;
  "ai/provider": typeof ai_provider;
  "ai/resources": typeof ai_resources;
  "ai/semanticIntake": typeof ai_semanticIntake;
  "ai/semanticMatch": typeof ai_semanticMatch;
  "ai/state": typeof ai_state;
  "ai/validators": typeof ai_validators;
  auth: typeof auth;
  events: typeof events;
  files: typeof files;
  http: typeof http;
  "lib/agentLog": typeof lib_agentLog;
  "lib/authz": typeof lib_authz;
  "lib/dedup": typeof lib_dedup;
  "lib/dispatchPolicy": typeof lib_dispatchPolicy;
  "lib/geo": typeof lib_geo;
  "lib/intakeRules": typeof lib_intakeRules;
  "lib/reportGroup": typeof lib_reportGroup;
  "lib/routeGraph": typeof lib_routeGraph;
  "lib/safety": typeof lib_safety;
  "lib/time": typeof lib_time;
  "lib/verificationThresholds": typeof lib_verificationThresholds;
  mapPins: typeof mapPins;
  memberships: typeof memberships;
  orchestrator: typeof orchestrator;
  reports: typeof reports;
  responders: typeof responders;
  simulation: typeof simulation;
  telemetry: typeof telemetry;
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

export declare const components: {
  aiWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"aiWorkpool">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
