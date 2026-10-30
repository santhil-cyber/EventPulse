import { v } from "convex/values";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { internal } from "../_generated/api";
import { env, internalMutation, internalQuery, mutation, query, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireRole } from "../lib/authz";
import { analysisOutput, aiMode } from "./validators";
import { aiPool, aiLimits } from "./resources";
import { ANALYSIS_VERSION, PROMPT_VERSION } from "./policy";
import { logAgentAction } from "../lib/agentLog";
import { IntakeSchema } from "./contracts";
import { vOnCompleteValidator } from "@convex-dev/workpool";

export const STAFF = ["ORGANIZER", "STAFF"] as const;
export function inputHash(report: Doc<"reports">) {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([report.description, report.priority ?? null, report.imageStorageId ?? null, report.location, report.pinX, report.pinY]))));
}
export const enabled = () => env.EVENTPULSE_AI_ENABLED === "true" && Boolean(env.OPENAI_API_KEY && env.OPENAI_TEXT_MODEL);

export const settings = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireRole(ctx, eventId, STAFF);
    const saved = await ctx.db.query("aiSettings").withIndex("by_eventId", q => q.eq("eventId", eventId)).unique();
    return { mode: saved?.mode ?? "off", visionEnabled: saved?.visionEnabled ?? false, ragEnabled: saved?.ragEnabled ?? false,
      configured: enabled(), visionConfigured: Boolean(env.OPENAI_VISION_MODEL), embeddingConfigured: Boolean(env.OPENAI_EMBEDDING_MODEL) };
  },
});
export const updateSettings = mutation({
  args: { eventId: v.id("events"), mode: aiMode, visionEnabled: v.boolean(), ragEnabled: v.boolean() },
  handler: async (ctx, args) => {
    const member = await requireRole(ctx, args.eventId, ["ORGANIZER"]);
    if ((args.mode !== "off" || args.ragEnabled) && !enabled()) throw new Error("AI is not configured on this deployment.");
    if (args.visionEnabled && !env.OPENAI_VISION_MODEL) throw new Error("Vision model is not configured.");
    if (args.ragEnabled && !env.OPENAI_EMBEDDING_MODEL) throw new Error("Embedding model is not configured.");
    const saved = await ctx.db.query("aiSettings").withIndex("by_eventId", q => q.eq("eventId", args.eventId)).unique();
    const data = { ...args, updatedBy: member.userId, updatedAt: Date.now() };
    if (saved) await ctx.db.patch("aiSettings", saved._id, data); else await ctx.db.insert("aiSettings", data);
    await logAgentAction(ctx, args.eventId, "orchestrator", "ai_settings", "Organizer changed AI configuration", `Mode=${args.mode}; vision=${args.visionEnabled}; RAG=${args.ragEnabled}`, "info");
  },
});

export async function queueAnalysis(ctx: MutationCtx, reportId: Id<"reports">, incidentId: Id<"incidents">) {
  const report = await ctx.db.get("reports", reportId);
  if (!report || report.isSimulated || report.status === "rejected" || !enabled()) return null;
  const config = await ctx.db.query("aiSettings").withIndex("by_eventId", q => q.eq("eventId", report.eventId)).unique();
  if (!config || config.mode === "off") return null;
  const existing = await ctx.db.query("aiAnalyses").withIndex("by_reportId_and_version", q => q.eq("reportId", reportId).eq("version", ANALYSIS_VERSION)).unique();
  if (existing) return existing._id;
  const id = await ctx.db.insert("aiAnalyses", { eventId: report.eventId, reportId, incidentId, version: ANALYSIS_VERSION, promptVersion: PROMPT_VERSION,
    mode: config.mode, status: "queued", inputHash: inputHash(report), attempts: 0, imageAnalyzed: false, createdAt: Date.now() });
  await enqueue(ctx, id);
  return id;
}
export const requestAnalysis = internalMutation({
  args: { reportId: v.id("reports"), incidentId: v.id("incidents") },
  handler: async (ctx, args): Promise<Id<"aiAnalyses"> | null> => queueAnalysis(ctx, args.reportId, args.incidentId),
});
async function enqueue(ctx: MutationCtx, analysisId: Id<"aiAnalyses">) {
  const row = await ctx.db.get("aiAnalyses", analysisId);
  if (!row) return;
  const attempt = row.attempts + 1;
  await ctx.db.patch("aiAnalyses", analysisId, { queuedAt: Date.now() });
  await aiPool.enqueueAction(ctx, internal.ai.actions.analyzeReport, { analysisId, attempt }, { retry: false, onComplete: internal.ai.state.analysisCompleted, context: { analysisId, attempt } });
  await ctx.scheduler.runAfter(120_000, internal.ai.state.expireAnalysis, { analysisId, attempt });
}
export const retryAnalysis = mutation({
  args: { analysisId: v.id("aiAnalyses") },
  handler: async (ctx, { analysisId }) => {
    const row = await ctx.db.get("aiAnalyses", analysisId);
    if (!row) throw new Error("Analysis not found.");
    await requireRole(ctx, row.eventId, STAFF);
    if (row.status !== "fallback" || row.attempts >= 3) throw new Error("Only failed analyses with fewer than three attempts can be retried.");
    const report = await ctx.db.get("reports", row.reportId);
    if (!report || inputHash(report) !== row.inputHash) throw new Error("Report changed; the old analysis cannot be retried.");
    await ctx.db.patch("aiAnalyses", analysisId, { status: "queued", errorCode: undefined, startedAt: undefined, completedAt: undefined });
    await enqueue(ctx, analysisId);
  },
});
export const beginAnalysis = internalMutation({
  args: { analysisId: v.id("aiAnalyses"), attempt: v.number() },
  handler: async (ctx, { analysisId, attempt }) => {
    const row = await ctx.db.get("aiAnalyses", analysisId);
    if (!row || row.status !== "queued" || attempt !== row.attempts + 1) return null;
    const [report, incident, config] = await Promise.all([ctx.db.get("reports", row.reportId), ctx.db.get("incidents", row.incidentId), ctx.db.query("aiSettings").withIndex("by_eventId", q => q.eq("eventId", row.eventId)).unique()]);
    const event = await ctx.db.get("events", row.eventId);
    if (!event?.isActive || !enabled() || !config || config.mode !== row.mode || !report || report.status === "rejected" || inputHash(report) !== row.inputHash || !incident || incident.isResolved) {
      await ctx.db.patch("aiAnalyses", analysisId, { status: "superseded", completedAt: Date.now(), errorCode: "context_changed" }); return null;
    }
    const member = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", row.eventId).eq("userId", report.reporterId)).unique();
    const minute = await aiLimits.limit(ctx, "eventMinute", { key: row.eventId });
    const day = minute.ok ? await aiLimits.limit(ctx, "eventDay", { key: row.eventId, count: env.OPENAI_EMBEDDING_MODEL ? 2 : 1 }) : { ok: false };
    if (!member || member.isBanned || !minute.ok || !day.ok) {
      await ctx.db.patch("aiAnalyses", analysisId, { status: "fallback", errorCode: !member || member.isBanned ? "reporter_unavailable" : "budget_exhausted", completedAt: Date.now() }); return null;
    }
    await ctx.db.patch("aiAnalyses", analysisId, { status: "running", startedAt: Date.now(), attempts: row.attempts + 1 });
    const upload = report.imageStorageId ? await ctx.db.query("evidenceUploads").withIndex("by_storageId", q => q.eq("storageId", report.imageStorageId!)).unique() : null;
    return { report, imageAllowed: config.visionEnabled && Boolean(env.OPENAI_VISION_MODEL) && upload?.eventId === row.eventId && upload?.uploaderId === report.reporterId, embeddingAllowed: Boolean(env.OPENAI_EMBEDDING_MODEL) };
  },
});

export const commitAnalysis = internalMutation({
  args: { analysisId: v.id("aiAnalyses"), attempt: v.optional(v.number()), output: analysisOutput, imageAnalyzed: v.boolean(), model: v.string(), inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("aiAnalyses", args.analysisId);
    if (!row || row.status !== "running" || (args.attempt !== undefined && args.attempt !== row.attempts)) return false;
    const [report, incident, config] = await Promise.all([ctx.db.get("reports", row.reportId), ctx.db.get("incidents", row.incidentId), ctx.db.query("aiSettings").withIndex("by_eventId", q => q.eq("eventId", row.eventId)).unique()]);
    const event = await ctx.db.get("events", row.eventId);
    const modelChanged = args.model !== (args.imageAnalyzed ? env.OPENAI_VISION_MODEL : env.OPENAI_TEXT_MODEL);
    const link = await ctx.db.query("incidentReports").withIndex("by_report", q => q.eq("reportId", row.reportId)).first();
    if (!enabled() || !event?.isActive || modelChanged || (args.imageAnalyzed && !config?.visionEnabled) || !report || report.status === "rejected" || inputHash(report) !== row.inputHash || !incident || incident.isResolved || link?.incidentId !== incident._id || config?.mode !== row.mode) {
      await ctx.db.patch("aiAnalyses", row._id, { status: "superseded", errorCode: "context_changed", completedAt: Date.now() }); return false;
    }
    const member = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", row.eventId).eq("userId", report.reporterId)).unique();
    if (!member || member.isBanned) { await ctx.db.patch("aiAnalyses", row._id, { status: "superseded", errorCode: "reporter_unavailable", completedAt: Date.now() }); return false; }
    IntakeSchema.parse(args.output);
    if (!args.imageAnalyzed && args.output.observations.some(o => o.source === "image")) throw new Error("Image observations require image input.");
    const { analysisId: _id, attempt: _attempt, ...result } = args;
    await ctx.db.patch("aiAnalyses", row._id, { ...result, status: "completed", completedAt: Date.now(), errorCode: undefined });
    if (row.mode === "assist") {
      const rank = { low: 1, medium: 2, high: 3, critical: 4 };
      const links = await ctx.db.query("incidentReports").withIndex("by_incident", q => q.eq("incidentId", incident._id)).take(2);
      const patch: Partial<Doc<"incidents">> = { aiSummary: args.output.summary, aiAnalysisId: row._id, updatedAt: Date.now() };
      if (rank[args.output.suggestedSeverity] > rank[incident.severity]) patch.severity = args.output.suggestedSeverity;
      // Preserve established classifications and staff findings. AI never verifies an incident.
      if (incident.incidentType === "other" && links.length === 1 && incident.verificationStatus === "UNVERIFIED") patch.incidentType = args.output.incidentType;
      if (args.imageAnalyzed) { patch.imageAnalysis = args.output.observations.filter(x => x.source === "image").map(x => x.text).join("\n") || "Image analysis inconclusive."; patch.imageConfidence = undefined; }
      await ctx.db.patch("incidents", incident._id, patch);
      await ctx.scheduler.runAfter(0, internal.orchestrator.runVerification, { incidentId: incident._id });
    }
    await logAgentAction(ctx, row.eventId, "intake", "openai_structured_analysis", `Analysis ${row._id.slice(-6)} (${row.mode})`, `Completed with ${args.model}; human review=${args.output.needsHumanReview}; image=${args.imageAnalyzed}. No verification authority granted.`, "info", row.incidentId);
    return true;
  },
});
export const failAnalysis = internalMutation({
  args: { analysisId: v.id("aiAnalyses"), attempt: v.optional(v.number()), errorCode: v.string() },
  handler: async (ctx, { analysisId, attempt, errorCode }) => {
    const row = await ctx.db.get("aiAnalyses", analysisId);
    if (!row || !["queued", "running"].includes(row.status) || (attempt !== undefined && attempt !== (row.status === "queued" ? row.attempts + 1 : row.attempts))) return;
    await ctx.db.patch("aiAnalyses", row._id, { status: "fallback", errorCode: errorCode.slice(0, 80), completedAt: Date.now() });
    await logAgentAction(ctx, row.eventId, "intake", "ai_fallback", "Optional AI enrichment unavailable", "Rule-based reporting and staff triage remain active.", "warn", row.incidentId);
  },
});
export const expireAnalysis = internalMutation({
  args: { analysisId: v.id("aiAnalyses"), attempt: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("aiAnalyses", args.analysisId);
    // A previous attempt's watchdog must not expire a newer retry.
    if (row && ["queued", "running"].includes(row.status) && args.attempt === (row.status === "queued" ? row.attempts + 1 : row.attempts) && Date.now() - (row.startedAt ?? row.queuedAt ?? row.createdAt) >= 115_000) await ctx.runMutation(internal.ai.state.failAnalysis, { ...args, errorCode: "deadline_exceeded" });
  },
});
export const analysisCompleted = internalMutation({
  args: vOnCompleteValidator(v.object({ analysisId: v.id("aiAnalyses"), attempt: v.number() })),
  handler: async (ctx, { context, result }) => {
    if (result.kind !== "success") await ctx.runMutation(internal.ai.state.failAnalysis, { analysisId: context.analysisId, attempt: context.attempt, errorCode: result.kind === "canceled" ? "canceled" : "worker_failed" });
  },
});
export const recentAnalyses = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => { await requireRole(ctx, eventId, STAFF); return ctx.db.query("aiAnalyses").withIndex("by_eventId_and_createdAt", q => q.eq("eventId", eventId)).order("desc").take(20); },
});
export const analysisContext = internalQuery({
  args: { analysisId: v.id("aiAnalyses") }, handler: async (ctx, { analysisId }) => ctx.db.get("aiAnalyses", analysisId),
});
