import { v } from "convex/values";
import { internalMutation, mutation, query, env } from "../_generated/server";
import { requireRole } from "../lib/authz";
import { STAFF } from "./state";
import { validateEmbedding } from "./policy";

export const recordCandidates = internalMutation({
  args: { analysisId: v.id("aiAnalyses"), attempt: v.number(), embedding: v.array(v.float64()), model: v.string(), candidates: v.array(v.object({ id: v.id("reportEmbeddings"), score: v.number() })) },
  handler: async (ctx, args) => {
    validateEmbedding(args.embedding);
    const analysis = await ctx.db.get("aiAnalyses", args.analysisId);
    if (!analysis || analysis.status !== "completed" || args.attempt !== analysis.attempts || args.model !== env.OPENAI_EMBEDDING_MODEL) return;
    const config = await ctx.db.query("aiSettings").withIndex("by_eventId", q => q.eq("eventId", analysis.eventId)).unique();
    if (!config || config.mode !== analysis.mode || config.mode === "off" || env.EVENTPULSE_AI_ENABLED !== "true") return;
    const incident = await ctx.db.get("incidents", analysis.incidentId);
    const report = await ctx.db.get("reports", analysis.reportId);
    if (!incident || incident.isResolved || !report || report.status === "rejected") return;
    const existing = await ctx.db.query("reportEmbeddings").withIndex("by_reportId", q => q.eq("reportId", analysis.reportId)).unique();
    if (!existing) await ctx.db.insert("reportEmbeddings", { eventId: analysis.eventId, reportId: analysis.reportId, incidentId: analysis.incidentId, embedding: args.embedding, model: args.model, createdAt: Date.now() });
    const saved = await ctx.db.query("duplicateSuggestions").withIndex("by_analysisId", q => q.eq("analysisId", analysis._id)).take(8);
    const seen = new Set(saved.map(x => x.candidateId));
    for (const hit of args.candidates.slice(0, 8)) {
      if (!Number.isFinite(hit.score) || hit.score < 0.85) continue;
      const item = await ctx.db.get("reportEmbeddings", hit.id);
      if (!item || item.eventId !== analysis.eventId || item.model !== args.model || item.incidentId === incident._id || seen.has(item.incidentId)) continue;
      const candidate = await ctx.db.get("incidents", item.incidentId);
      const candidateReport = await ctx.db.get("reports", item.reportId);
      if (!candidate || candidate.isResolved || !candidateReport || candidateReport.status === "rejected" || candidate.incidentType !== incident.incidentType || Math.abs(candidate.createdAt - incident.createdAt) > 2_700_000 || Math.hypot(candidate.pinX - incident.pinX, candidate.pinY - incident.pinY) > 10) continue;
      seen.add(candidate._id);
      await ctx.db.insert("duplicateSuggestions", { eventId: analysis.eventId, analysisId: analysis._id, incidentId: incident._id, candidateId: candidate._id, score: hit.score, status: "pending", createdAt: Date.now() });
    }
  },
});
export const list = query({
  args: { eventId: v.id("events") }, handler: async (ctx, { eventId }) => {
    await requireRole(ctx, eventId, STAFF);
    const rows = await ctx.db.query("duplicateSuggestions").withIndex("by_eventId_and_status", q => q.eq("eventId", eventId).eq("status", "pending")).order("desc").take(20);
    const result = [];
    for (const row of rows) {
      const [a,b] = await Promise.all([ctx.db.get("incidents", row.incidentId), ctx.db.get("incidents", row.candidateId)]);
      if (a && b && !a.isResolved && !b.isResolved) result.push({ ...row, incidentCode: a.incidentCode, candidateCode: b.incidentCode });
    }
    return result;
  },
});
export const dismiss = mutation({
  args: { suggestionId: v.id("duplicateSuggestions") }, handler: async (ctx, { suggestionId }) => {
    const row = await ctx.db.get("duplicateSuggestions", suggestionId);
    if (!row) throw new Error("Suggestion not found.");
    await requireRole(ctx, row.eventId, STAFF);
    await ctx.db.patch("duplicateSuggestions", row._id, { status: "dismissed" });
  },
});
