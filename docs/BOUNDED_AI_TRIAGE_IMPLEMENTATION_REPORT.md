# Bounded AI Triage Decision Step — Implementation Report

## Executive summary

Add a supervised **Triage Planner** to the existing incident workflow. Given a validated report and a small, server-created context, a language model chooses at most one read-only evidence lookup from a fixed allowlist. Convex validates and executes that lookup, then the model returns a short, schema-validated recommendation for staff. The step records its decision and tool result in the agent log and the staff UI.

This adds a visible agentic behavior—model-selected tool use and evidence-conditioned output—without giving the model authority to verify an incident, change incident status, create a route, assign a responder, or contact anyone. Existing deterministic rules and human approval remain authoritative.

This document is an implementation proposal; it does not claim the feature has been implemented.

## Current project baseline

- The application uses React 19, TypeScript, Convex, and Convex Auth. See the stack in `README.md`.
- The five named stages are Convex functions in `convex/agents/`, coordinated by `convex/agentPipeline.ts`. Their current operational logic is primarily deterministic.
- Optional model work already uses LangChain's OpenAI-compatible adapter in `convex/ai/provider.ts`, with strict Zod structured output in `convex/ai/contracts.ts`. The provider can be configured for OpenAI or a compatible endpoint.
- Report enrichment is gated by the deployment setting and per-event AI mode; event AI mode defaults to `off`. AI analysis is currently queued through the workpool in `convex/ai/state.ts` and `convex/ai/actions.ts`.
- `convex/agents/crowdIntel.ts` already has a read-only `get_zone_occupancy` query. Its result currently omits telemetry freshness, so it should be extended or wrapped before its values are presented as current.
- The demo visualizer in `src/AgentPipelineVisualizer.tsx` follows `pipelineRuns`. `convex/agentPipeline.ts` describes its pacing as a showcase; demo output must remain visibly labeled and must not be presented as evidence of a live provider call.
- Existing guardrails state that AI must not verify incidents, approve routes, automatically merge duplicates, dispatch responders, or contact emergency services. The proposed step preserves those boundaries.

## Proposed behavior

### Example

Report: “There’s smoke near the North Gate, and people are crowding toward the exit.”

1. The server loads the report, linked incident, event AI settings, and eligible venue-zone summaries. It resolves any report location to a zone using trusted event data; the model does not invent a zone ID.
2. The planner receives the report as untrusted evidence and is allowed to choose exactly one of:
   - `get_zone_snapshot` — read occupancy, capacity, flow, risk score, and freshness for a server-resolved zone.
   - `find_similar_reports` — retrieve bounded, same-event candidates using the existing conservative duplicate logic.
   - `no_lookup` — return a recommendation without additional data when no lookup is justified.
3. The planner returns a strict structured decision, for example:

   ```json
   {
     "tool": "get_zone_snapshot",
     "zoneId": "<server-provided candidate id>",
     "reason": "Check crowding near the reported smoke."
   }
   ```

4. Convex checks that the selected tool and zone belong to the event, then runs only that read-only query. Invalid or stale data is explicitly marked unavailable/unknown; it is never converted into an assumed safe condition.
5. The model receives the tool result and returns a validated staff-facing recommendation, for example:

   ```json
   {
     "summary": "A report describes possible smoke and crowding near the North Gate.",
     "recommendation": "Request immediate staff assessment of the area.",
     "priority": "high",
     "evidence": ["Zone telemetry is stale; current occupancy is unknown."],
     "uncertaintyReasons": ["The report is unverified.", "Telemetry is stale."],
     "requiresStaffAction": true
   }
   ```

6. The system stores the plan, lookup result summary, and recommendation for staff review. It does not perform the recommended action. Existing rules decide whether any later operation is allowed, and staff use the existing controls to verify or respond.

The example intentionally treats stale telemetry as unknown. It does not say occupancy is elevated unless current, validated data supports that statement.

## Architecture and control boundaries

```text
Report + authenticated event context
                |
                v
Convex validates report, AI mode, event, and zone candidates
                |
                v
LangChain structured planner (fixed tool enum; one decision)
                |
                v
Convex allowlist + scope validation
                |
                v
One read-only query OR no query
                |
                v
LangChain structured recommendation (evidence + uncertainty)
                |
                v
Convex rechecks context and persists result + audit log
                |
                v
Staff review; no autonomous verification, route approval, or dispatch
```

The model may select among a finite set of read-only tools. Convex—not the model—owns tool implementations, arguments, authorization, event scoping, limits, state changes, and final operational gates. There is no recursive agent loop. One plan call and, if a tool is selected, one recommendation call are the maximum for a run.

## Suggested implementation design

### 1. Structured contracts

Add Zod schemas under `convex/ai/` for both planner decision and final recommendation. Use strict structured output and parse the result again on the server.

Planner decision fields:

- `tool`: enum `get_zone_snapshot | find_similar_reports | no_lookup`.
- `zoneId`: optional ID selected only from the server-provided candidates; required only for the zone tool.
- `reason`: short bounded explanation.
- Reject extra fields and invalid tool/argument combinations.

Recommendation fields:

- `summary`: bounded text for staff.
- `recommendation`: bounded text that can only suggest an existing staff action.
- `priority`: enum `low | medium | high | critical`, treated as advisory and never directly written into incident severity.
- `evidence`: bounded list of references to report claims or returned tool facts.
- `uncertaintyReasons`: bounded list.
- `requiresStaffAction`: literal `true`.

The prompt must treat reports and tool text as untrusted data, ignore instructions embedded in them, preserve negation/hearsay, and explicitly prohibit claiming verification, issuing evacuation instructions, diagnosing people, or representing stale/absent telemetry as current.

### 2. Backend orchestration

Add a Node action in `convex/ai/actions.ts` (or a dedicated `convex/ai/triageActions.ts`) that:

1. Calls an internal query/mutation to load and validate the report, incident, event, configuration, zone candidates, and input hash.
2. Stops if the report is rejected/simulated, the incident is resolved, the event is inactive, AI is disabled, or event mode is `off`.
3. Calls the planner with only minimized, relevant context. Do not include attendee identity or unrelated report history.
4. Validates the model's requested tool against the allowlist and validates event ownership of every identifier.
5. Executes at most one internal read-only tool. For `find_similar_reports`, enforce a same-event scope, time window, result cap, and existing conservative duplicate thresholds. For zone data, return timestamp and `isStale`; do not call the risk-score mutation as though it were a read.
6. Calls the recommendation model with the tool result or an explicit `no_lookup` result.
7. Commits only if the input hash and relevant run/config state still match the values loaded before provider work. Otherwise mark the result superseded.
8. Records sanitized provider failures and never persists raw SDK errors, secrets, full prompts, or unnecessary personal information.

Follow the existing `beginAnalysis` / `commitAnalysis` / `failAnalysis` pattern in `convex/ai/state.ts` for stale-result protection, retries, bounded attempts, provider timeouts, and staff-visible status. Keep provider requests outside Convex mutations.

### 3. Mode and rollout behavior

Prefer extending the existing organizer-controlled AI setting with an explicit triage mode, or reuse `shadow`/`assist` only if their semantics are documented clearly:

- **Off:** no planner call.
- **Shadow:** call planner and tools, persist output for evaluation, and do not surface it as an operational recommendation.
- **Assist:** show a clearly labeled recommendation to staff; still require staff action for every operational step.

Default must remain off. The deployment-level kill switch and existing provider configuration continue to gate calls. Simulated reports should not be mixed with live AI analysis; demo mode should use clearly labeled deterministic fixtures unless the demo explicitly proves a configured provider request.

### 4. Data and audit storage

Add a dedicated table such as `triageRuns`, rather than overloading `aiAnalyses` (which currently stores extraction/classification output) or storing a large, evolving JSON payload in `pipelineRuns`.

Suggested fields:

- `eventId`, `reportId`, `incidentId`, `status` (`queued`, `running`, `completed`, `fallback`, `superseded`).
- `inputHash`, `promptVersion`, `model`, `attempts`, `createdAt`, `startedAt`, `completedAt`.
- `selectedTool`, a sanitized `toolResultSummary`, recommendation output, and safe `errorCode`.
- Whether the result was shadow-only or staff-visible.

Add event/report indexes needed for authorized staff queries and enforce event membership server-side. Retain only what the UI and evaluation need; do not store raw provider payloads by default. If schema expansion is undesirable for a first demo, log a concise action in `agentLogs` and use an ephemeral run result, but durable status and stale-result checks are preferable for production.

### 5. Pipeline and UI integration

For a separately visible planner stage, extend the `pipelineRuns.activeAgent` validator in `convex/schema.ts`, the progress updates in `convex/agentPipeline.ts`, and the stage list/labels in `src/AgentPipelineVisualizer.tsx`. If the planner is only an optional enrichment task, display it separately in the AI workspace (`src/AIWorkspace.tsx`) instead of inserting asynchronous provider latency into the deterministic incident pipeline.

Recommended UX:

- Label the card “AI triage suggestion” and show mode (`shadow` or `assist`), model, timestamp, and result status.
- Show selected tool, a concise result summary, evidence, and uncertainty.
- Clearly mark stale telemetry and missing data.
- Provide no “verify,” “approve route,” or “dispatch” button on the model output. Link staff to the existing review controls instead.
- Show provider unavailable/fallback without blocking report intake or the staff queue.
- Keep the demo simulation banner and AI provider status distinct.

## Security, safety, and reliability requirements

- **Authorization:** only internal actions invoke tools; public staff queries require `ORGANIZER` or `STAFF` membership. Every tool rechecks event scope.
- **Constrained tool use:** compile-time and runtime allowlist; one read-only lookup maximum; no model-generated function references, arbitrary query strings, or arbitrary IDs.
- **Prompt injection:** report text and tool output are data only. Never follow instructions embedded in evidence.
- **Data minimization:** send only report text, resolved venue context, and the selected tool result. Do not send user IDs, full membership records, or unrelated reports.
- **Staleness:** include telemetry timestamp/source; mark older than 120 seconds as stale, matching existing venue assumptions. Missing telemetry is unknown.
- **No side effects:** planner and lookup tool do not mutate incidents, routes, responders, task status, or notifications.
- **Availability:** optional AI failure returns a safe fallback; normal intake and staff review continue.
- **Idempotency/races:** use a report input hash, run attempt/version, and current status checks before commit. A retry cannot overwrite a newer run.
- **Cost/latency:** one or two bounded provider calls, no automatic SDK retries, configured timeout, event-level quota, and explicit retry policy consistent with existing AI limits.
- **Audit:** log tool name, scoped input summary, result summary, model/version, status, and safe error code; never credentials or raw exception strings.

## File-level implementation map

| Area | Likely files | Change |
|---|---|---|
| Contracts/provider | `convex/ai/contracts.ts`, `convex/ai/provider.ts` | Add strict planner/recommendation schemas and provider functions. |
| Orchestration/state | `convex/ai/actions.ts`, `convex/ai/state.ts`, `convex/ai/resources.ts`, `convex/ai/policy.ts` | Add bounded action lifecycle, event setting/mode, quotas, timeouts, and stale-result protections. |
| Read-only tools | `convex/agents/crowdIntel.ts`, `convex/agents/intake.ts` or a new `convex/agents/triage.ts` | Add event-scoped zone snapshot with freshness and a bounded similar-report lookup wrapper. |
| Storage | `convex/schema.ts` | Add triage run table/indexes and, if a distinct pipeline stage is chosen, extend the stage validator. |
| Pipeline/demo | `convex/agentPipeline.ts`, `src/AgentPipelineVisualizer.tsx` | Show a distinct planner stage only if wiring it into pipeline runs; preserve demo labeling. |
| Staff UI/config | `src/AIWorkspace.tsx`, `convex/ai/state.ts` | Add a visible mode toggle and staff recommendation/evidence panel. |
| Tests | `convex/ai/*.test.ts`, `convex/production.test.ts` | Test planner validation, tool scope, mode gates, stale results, fail-open behavior, and safety limits. |
| Operations docs | `docs/AI_OPERATIONS.md`, `README.md` | Document provider data flow, new mode, limitations, setup, and rollout checks. |

## Test plan and acceptance criteria

### Contract and planner tests

- Valid enum choices parse; unknown tools, invalid tool arguments, oversized text, and extra/incorrect output are rejected.
- Prompt-injection text in a report cannot change the tool allowlist or policy. The returned structured output is still independently validated.
- The planner selects `no_lookup` when no candidate or justified lookup exists.
- Missing/invalid model output falls back without blocking incident intake.

### Tool and authorization tests

- A zone ID from another event is rejected; a candidate ID not supplied to the planner is rejected.
- Similar-report results never cross events, exceed the cap, or become an automatic merge.
- Stale or missing telemetry is represented as unknown and appears as uncertainty in the recommendation.
- The planner can call at most one read-only tool; there is no path from selected tool to mutations that verify, route, dispatch, or notify.

### Lifecycle tests

- Off mode and deployment kill switch result in zero provider calls.
- Shadow mode records the output but does not render it as an operational instruction.
- Assist mode renders a suggestion but requires staff action.
- If the report, incident, event mode, or input hash changes while a provider request is running, its output is discarded/superseded.
- Provider timeout, refusal, 429, and malformed output produce sanitized fallback states; core report processing remains available.
- Retry limits and per-event quotas are enforced.

### Demo acceptance

- A seeded smoke/crowd report causes a model-selected read-only lookup and displays the exact tool chosen, returned evidence, uncertainty, and staff recommendation.
- The UI visibly distinguishes simulated data, live Convex data, and model-generated text.
- The demo never claims real emergency services were contacted or a report was verified by AI.
- With AI off or provider unavailable, the deterministic pipeline and staff queue still work.

## Rollout sequence

1. Implement schemas and mocked provider tests; keep the event feature off.
2. Add read-only, event-scoped tool wrappers and test authorization/staleness.
3. Add shadow runs and compare recommendations against staff-labeled synthetic scenarios.
4. Add the staff panel and enable assist for a test event only after review.
5. Validate multilingual, negated, conflicting, injected, missing-telemetry, and stale-telemetry cases with synthetic reports.
6. Confirm latency, token/cost controls, provider retention settings, failure behavior, logging, and kill-switch operation before any live event use.

Production activation requires the existing release checks in `docs/AI_OPERATIONS.md`; this proposal does not imply production readiness.

## Recommendation

Implement the first version as an **optional triage enrichment sidecar**, not as a gate in the report submission path. Start in shadow mode, show the chosen read-only tool and evidence in the organizer/staff workspace, and only then enable staff-visible assist mode. This demonstrates LLM-driven bounded tool choice while preserving the deterministic incident workflow and the project's human authority boundaries.
