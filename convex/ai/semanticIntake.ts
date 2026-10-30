import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalQuery, internalMutation, env } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { aiLimits } from "./resources";
import schema from "../schema";
import { classifyIncident } from "../lib/intakeRules";
import { DEDUP_RADIUS, DEDUP_WINDOW_MS, duplicateScore } from "../lib/dedup";

export const candidates = internalQuery({
  args: { reportId: v.id("reports"), now: v.number() },
  returns: v.union(v.null(), v.object({ report: schema.doc("reports"), candidates: v.array(schema.doc("incidents")) })),
  handler: async (ctx, { reportId, now }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report || report.status === "rejected" || report.isSimulated || env.EVENTPULSE_AI_ENABLED !== "true" || !env.OPENAI_API_KEY || !env.OPENAI_TEXT_MODEL) return null;
    const settings = await ctx.db.query("aiSettings").withIndex("by_eventId", q => q.eq("eventId", report.eventId)).unique();
    if (settings?.mode !== "assist") return null;
    const type = classifyIncident(report.description).incidentType;
    const recent = await ctx.db.query("incidents").withIndex("by_event_created", q =>
      q.eq("eventId", report.eventId).gte("createdAt", now - DEDUP_WINDOW_MS)).order("desc").take(100);
    const nearby = recent.filter(x => !x.isResolved
      && Math.hypot(report.pinX - x.pinX, report.pinY - x.pinY) <= DEDUP_RADIUS
      && (type === "other" || x.incidentType === "other" || type === x.incidentType));
    if (nearby.some(x => duplicateScore({ ...report, incidentType: type }, x) > 0)) return null;
    return { report, candidates: nearby.slice(0, 8) };
  },
});

export const reserveComparison = internalMutation({
  args: { reportId: v.id("reports") },
  returns: v.boolean(),
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report || report.status === "rejected") return false;
    const membership = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", report.eventId).eq("userId", report.reporterId)).unique();
    if (!membership || membership.isBanned) return false;
    const minute = await aiLimits.limit(ctx, "eventMinute", { key: report.eventId });
    return minute.ok && (await aiLimits.limit(ctx, "eventDay", { key: report.eventId })).ok;
  },
});

/** Provider failure always falls back to transactional text/location matching. */
export const processNewReport = internalAction({
  args: { reportId: v.id("reports") },
  returns: v.null(),
  handler: async (ctx, { reportId }) => {
    // Schedule a durable fallback before optional external work. A terminated
    // action must never leave an accepted report without an intake run.
    const fallback = await ctx.scheduler.runAfter(30_000, internal.orchestrator.processNewReport, { reportId });
    let matchedIncidentId: Id<"incidents"> | undefined;
    let similarityScore: number | undefined;
    try {
      const context = await ctx.runQuery(internal.ai.semanticIntake.candidates, { reportId, now: Date.now() });
      if (context?.candidates.length) {
        const result = await ctx.runAction(internal.ai.semanticMatch.compare, { reportId, candidateIds: context.candidates.map(x => x._id) });
        if (result) { matchedIncidentId = result.incidentId; similarityScore = result.confidence; }
      }
    } catch { /* deterministic fallback */ }
    await ctx.runMutation(internal.orchestrator.processNewReport, { reportId, matchedIncidentId, similarityScore });
    await ctx.scheduler.cancel(fallback);
    return null;
  },
});
