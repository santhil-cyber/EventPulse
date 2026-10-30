import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { logAgentAction } from "./lib/agentLog";

/** Immediate rule-based triage never waits for an AI provider. */
export const processNewReport = internalMutation({
  args: { reportId: v.id("reports"), matchedIncidentId: v.optional(v.id("incidents")), similarityScore: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { reportId, matchedIncidentId, similarityScore }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report) return null;
    const existing = await ctx.db.query("pipelineRuns").withIndex("by_reportId", q => q.eq("reportId", reportId)).first();
    if (existing) return null;
    const now = Date.now();
    const runId = await ctx.db.insert("pipelineRuns", { eventId: report.eventId, reportId, runCode: `LIVE-${reportId.slice(-8)}`,
      activeAgent: "intake", agentPhase: "starting", currentThought: "Rule-based triage; optional AI runs independently.",
      agentTimestamps: JSON.stringify({ intake: { startedAt: now } }), status: "running", startedAt: now, isDemo: false });
    try {
      const result = await ctx.runMutation(internal.agents.intake.processReport, { reportId, matchedIncidentId, similarityScore });
      await ctx.db.patch("pipelineRuns", runId, { incidentId: result.incidentId });
      await ctx.scheduler.runAfter(0, internal.orchestrator.runVerification, { incidentId: result.incidentId, runId });
      // A component/AI failure cannot roll back the incident or interrupt staff triage.
      try { await ctx.runMutation(internal.ai.state.requestAnalysis, { reportId, incidentId: result.incidentId }); }
      catch { await logAgentAction(ctx, report.eventId, "intake", "ai_queue_unavailable", "Optional AI could not be queued", "Rule-based triage and staff review continue.", "warn", result.incidentId); }
    } catch {
      await ctx.db.patch("pipelineRuns", runId, { status: "failed", currentThought: "Intake failed. Original report remains available to staff.", completedAt: Date.now() });
    }
    return null;
  },
});
async function progress(ctx: MutationCtx, runId: Id<"pipelineRuns"> | undefined, activeAgent: "verification" | "crowd_intel" | "routing" | "dispatch" | "completed", text: string) {
  if (!runId) return;
  const run = await ctx.db.get("pipelineRuns", runId);
  if (!run || run.status !== "running") return;
  const timestamps = JSON.parse(run.agentTimestamps) as Record<string, { startedAt?: number; completedAt?: number }>;
  const now = Date.now();
  if (run.activeAgent !== "completed") timestamps[run.activeAgent] = { ...timestamps[run.activeAgent], completedAt: now };
  if (activeAgent !== "completed") timestamps[activeAgent] = { startedAt: now };
  await ctx.db.patch("pipelineRuns", runId, { activeAgent, agentPhase: activeAgent === "completed" ? "output" : "tool_call", currentThought: text,
    agentTimestamps: JSON.stringify(timestamps), ...(activeAgent === "completed" ? { status: "completed" as const, completedAt: now } : {}) });
}
/** Explicit dependencies: fresh evidence -> crowd risk -> validated route -> response. */
export const runVerification = internalMutation({
  args: { incidentId: v.id("incidents"), runId: v.optional(v.id("pipelineRuns")) },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident || incident.isResolved) return;
    try {
      await progress(ctx, args.runId, "verification", "Evaluating eligible source evidence with deterministic policy.");
      await ctx.runMutation(internal.agents.verification.evaluateIncident, { incidentId: args.incidentId });
      await progress(ctx, args.runId, "crowd_intel", "Updating zone risk from current telemetry.");
      await ctx.runMutation(internal.agents.crowdIntel.assessAllZones, { eventId: incident.eventId });
      await progress(ctx, args.runId, "routing", "Computing routes without relaxing hard safety constraints.");
      await ctx.runMutation(internal.agents.routing.computeAlternativeRoutes, { eventId: incident.eventId, incidentId: incident._id });
      await progress(ctx, args.runId, "dispatch", "Checking responder capability, availability and existing assignments.");
      await ctx.runMutation(internal.orchestrator.runResponsePlanning, { incidentId: incident._id });
      await progress(ctx, args.runId, "completed", "Operational checks completed. Review verification, route approval and task states for outcomes.");
    } catch {
      if (args.runId) await ctx.db.patch("pipelineRuns", args.runId, { status: "failed", completedAt: Date.now(), currentThought: "Operational step failed. Staff review required; original report is preserved." });
      await logAgentAction(ctx, incident.eventId, "orchestrator", "pipeline_failed", incident.incidentCode, "A deterministic step failed; inspect incident and task state before retrying.", "error", incident._id);
    }
  },
});
export const runCrowdIntel = internalMutation({
  args: { incidentId: v.id("incidents") }, handler: async (ctx, { incidentId }) => {
    const incident = await ctx.db.get("incidents", incidentId);
    if (!incident || incident.isResolved) return;
    await ctx.runMutation(internal.agents.crowdIntel.assessAllZones, { eventId: incident.eventId });
    await ctx.scheduler.runAfter(0, internal.orchestrator.runRouting, { eventId: incident.eventId, incidentId });
  },
});
export const runRouting = internalMutation({
  args: { eventId: v.id("events"), incidentId: v.id("incidents") }, handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident || incident.isResolved || incident.eventId !== args.eventId) return;
    await ctx.runMutation(internal.agents.routing.computeAlternativeRoutes, args);
    await ctx.scheduler.runAfter(0, internal.orchestrator.runResponsePlanning, { incidentId: incident._id });
  },
});
export const runResponsePlanning = internalMutation({
  args: { incidentId: v.id("incidents") }, handler: async (ctx, { incidentId }) => {
    const incident = await ctx.db.get("incidents", incidentId);
    if (!incident || incident.isResolved || incident.verificationStatus !== "VERIFIED") return;
    await ctx.runMutation(internal.agents.dispatch.dispatchResponders, { incidentId, allowEmergencyServices: false });
  },
});
export const onEvidenceUpdate = internalMutation({
  args: { incidentId: v.id("incidents") }, handler: async (ctx, args) => { await ctx.scheduler.runAfter(0, internal.orchestrator.runVerification, args); },
});
