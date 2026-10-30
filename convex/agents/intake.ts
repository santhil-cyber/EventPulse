import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { logAgentAction } from "../lib/agentLog";
import { classifyIncident } from "../lib/intakeRules";
import { duplicateScore } from "../lib/dedup";
import { incidentTypeValidator, severityValidator } from "../schema";

/** Idempotent transactional boundary shared by live and demo intake. */
export async function executeCreateOrUpdateIncident(ctx: MutationCtx, args: {
  eventId: Id<"events">; reportId: Id<"reports">; matchedIncidentId?: Id<"incidents">;
  similarityScore?: number; incidentType: Doc<"incidents">["incidentType"];
  severity: Doc<"incidents">["severity"]; location: string; pinX: number; pinY: number;
  description: string; hasImageEvidence?: boolean; imageStorageId?: Id<"_storage">;
  imageUrl?: string; imageAnalysis?: string; imageConfidence?: number;
}): Promise<{ incidentId: Id<"incidents">; isNew: boolean }> {
  const report = await ctx.db.get("reports", args.reportId);
  if (!report || report.eventId !== args.eventId) throw new Error("Report event mismatch.");
  const link = await ctx.db.query("incidentReports").withIndex("by_report", q => q.eq("reportId", args.reportId)).first();
  if (link) return { incidentId: link.incidentId, isNew: false };
  const now = Date.now();
  if (args.matchedIncidentId) {
    const incident = await ctx.db.get("incidents", args.matchedIncidentId);
    if (incident && incident.eventId === args.eventId && !incident.isResolved && incident.incidentType === args.incidentType) {
      await ctx.db.insert("incidentReports", { incidentId: incident._id, reportId: args.reportId, isOriginal: false, similarityScore: args.similarityScore ?? 0, addedAt: now });
      const rank = { critical: 4, high: 3, medium: 2, low: 1 };
      const patch: Partial<Doc<"incidents">> = {
        severity: rank[args.severity] > rank[incident.severity] ? args.severity : incident.severity,
        updatedAt: now,
      };
      if (!incident.hasImageEvidence && args.hasImageEvidence) Object.assign(patch, { hasImageEvidence: true, imageStorageId: args.imageStorageId, imageUrl: args.imageUrl });
      await ctx.db.patch("incidents", incident._id, patch);
      await logAgentAction(ctx, args.eventId, "intake", "create_or_update_incident", `Report linked to ${incident.incidentCode}`, "Compatible type, time, location and textual evidence matched; original report preserved.", "action", incident._id);
      return { incidentId: incident._id, isNew: false };
    }
  }
  const event = await ctx.db.get("events", args.eventId);
  if (!event) throw new Error("Event not found.");
  // Seed from a bounded legacy scan once. A suffix prevents collisions with legacy codes.
  const sequence = (event.incidentSequence ?? 0) + 1;
  await ctx.db.patch("events", event._id, { incidentSequence: sequence });
  const incidentCode = `INC-${String(sequence).padStart(3, "0")}-${args.reportId.slice(-6)}`;
  const incidentId = await ctx.db.insert("incidents", {
    eventId: args.eventId, incidentCode, description: args.description,
    location: report.location, pinX: report.pinX, pinY: report.pinY,
    incidentType: args.incidentType, severity: args.severity,
    verificationStatus: "UNVERIFIED", verificationReason: "Report received; evidence review pending.",
    independentSourceCount: 1, staffVerificationRequested: false,
    hasImageEvidence: args.hasImageEvidence ?? false, imageStorageId: args.imageStorageId,
    imageUrl: args.imageUrl, isResolved: false, createdAt: now, updatedAt: now,
  });
  await ctx.db.insert("incidentReports", { incidentId, reportId: args.reportId, isOriginal: true, similarityScore: 1, addedAt: now });
  await logAgentAction(ctx, args.eventId, "intake", "create_or_update_incident", `Report received: ${incidentCode}`, `Rule-based triage: ${args.incidentType}, ${args.severity}. Media attachment is unverified.`, "action", incidentId);
  return { incidentId, isNew: true };
}

export const extract_incident_details = internalMutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report) throw new Error("Report not found");
    const classification = classifyIncident(report.description, report.priority);
    return { reportId, eventId: report.eventId, description: report.description, ...classification, location: report.location, pinX: report.pinX, pinY: report.pinY };
  },
});

export const find_duplicate_reports = internalQuery({
  args: { eventId: v.id("events"), location: v.string(), pinX: v.number(), pinY: v.number(), description: v.string(), timeWindowMs: v.optional(v.number()), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    // Caller supplies time for query cache correctness. Legacy callers get a bounded recent page.
    const recent = await ctx.db.query("incidents").withIndex("by_event_created", q => q.eq("eventId", args.eventId)).order("desc").take(100);
    const incidentType = classifyIncident(args.description).incidentType;
    return recent.filter(x => !x.isResolved && (args.now === undefined || x.createdAt >= args.now - Math.min(args.timeWindowMs ?? 2_700_000, 2_700_000)))
      .map(x => ({ incidentId: x._id, incidentCode: x.incidentCode, similarityScore: duplicateScore({ ...args, incidentType }, x), spatialDistance: Math.hypot(args.pinX - x.pinX, args.pinY - x.pinY) }))
      .filter(x => x.similarityScore > 0).sort((a, b) => b.similarityScore - a.similarityScore);
  },
});

export const create_or_update_incident = internalMutation({
  args: { eventId: v.id("events"), reportId: v.id("reports"), matchedIncidentId: v.optional(v.id("incidents")), similarityScore: v.optional(v.number()), incidentType: incidentTypeValidator, severity: severityValidator, location: v.string(), pinX: v.number(), pinY: v.number(), description: v.string() },
  handler: executeCreateOrUpdateIncident,
});

export const processReport = internalMutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report) throw new Error("Report not found");
    const { incidentType, severity } = classifyIncident(report.description, report.priority);
    const recent = await ctx.db.query("incidents").withIndex("by_event_created", q => q.eq("eventId", report.eventId).gte("createdAt", Date.now() - 2_700_000)).order("desc").take(100);
    const matches = recent.filter(x => !x.isResolved).map(x => ({ id: x._id, score: duplicateScore({ ...report, incidentType }, x) })).filter(x => x.score > 0).sort((a,b) => b.score - a.score);
    const result = await executeCreateOrUpdateIncident(ctx, {
      ...report, reportId, incidentType, severity, matchedIncidentId: matches[0]?.id,
      similarityScore: matches[0]?.score, hasImageEvidence: Boolean(report.imageStorageId || report.imageUrl),
    });
    return { ...result, incidentType, severity };
  },
});

/** No synthetic transcription can enter evidence. Voice reporting is not enabled. */
export const transcribe_audio = internalAction({
  args: { audioStorageId: v.id("_storage") },
  handler: async () => { throw new Error("Voice transcription is not configured. Submit a text report."); },
});
