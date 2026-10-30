import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { logAgentAction } from "../lib/agentLog";
import { canMarkVerified, shouldAlertNearbyStaff } from "../lib/safety";
import { THRESHOLDS } from "../lib/verificationThresholds";
import { ACTIVE_TASKS, rankResponders } from "../lib/dispatchPolicy";
import { executeAssignResponder } from "./dispatch";
import { verificationStatusValidator } from "../schema";

/** Tool: Check source independence and reporter trust */
export const check_source_independence = internalQuery({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) throw new Error("Incident not found");

    const links = await ctx.db
      .query("incidentReports")
      .withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId))
      .take(100);

    const original = links[0] ? await ctx.db.get("reports", links[0].reportId) : null;
    const groupRejected = original?.status === "rejected";
    const reportIds = links.map((l) => l.reportId);
    const reports: Doc<"reports">[] = [];
    for (const rId of reportIds) {
      const rep = await ctx.db.get("reports", rId);
      if (rep && rep.eventId === incident.eventId && rep.status !== "rejected"
        && !groupRejected) reports.push(rep);
    }

    const reporterUserIds = Array.from(new Set(reports.map((r) => r.reporterId)));
    const eligibleReporterIds = [];

    let totalTrust = 0;
    let validCount = 0;
    for (const uId of reporterUserIds) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_event_user", (q) =>
          q.eq("eventId", incident.eventId).eq("userId", uId),
        )
        .unique();
      if (membership && !membership.isBanned) {
        eligibleReporterIds.push(uId);
        totalTrust += membership.trustScore;
        validCount++;
      }
    }

    const avgTrustScore = validCount > 0 ? Math.round(totalTrust / validCount) : 0;

    let hasDuplicateMedia = false;
    for (let i = 0; i < reports.length; i++) {
      for (let j = i + 1; j < reports.length; j++) {
        const textA = reports[i].description.trim().toLowerCase();
        const textB = reports[j].description.trim().toLowerCase();
        if (textA === textB && textA.length > 20) {
          hasDuplicateMedia = true;
          break;
        }
      }
      if (hasDuplicateMedia) break;
    }

    return {
      independentCount: eligibleReporterIds.length,
      uniqueReporterIds: eligibleReporterIds,
      avgTrustScore,
      hasDuplicateMedia,
      reportCount: reports.length,
    };
  },
});

/** Tool: Analyse media and text consistency */
export const analyse_media_consistency = internalQuery({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("incidentReports")
      .withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId))
      .take(50);

    const reports: Doc<"reports">[] = [];
    for (const l of links) {
      const rep = await ctx.db.get("reports", l.reportId);
      if (rep) reports.push(rep);
    }

    const flags: string[] = [];
    let isConsistent = true;

    if (reports.length >= 2) {
      const times = reports.map((r) => r.createdAt).sort((a, b) => a - b);
      const spanSeconds = (times[times.length - 1] - times[0]) / 1000;
      if (spanSeconds < 5 && reports.length >= 4) {
        flags.push("Suspicious burst: multiple reports within 5 seconds");
      }
    }

    return { isConsistent, flags };
  },
});

export async function executeRequestStaffVerification(
  ctx: MutationCtx,
  args: {
    incidentId: Id<"incidents">;
    eventId: Id<"events">;
  },
): Promise<boolean> {
  const incident = await ctx.db.get("incidents", args.incidentId);
  if (!incident) throw new Error("Incident not found");

  if (incident.eventId !== args.eventId || incident.isResolved) return false;
  if (incident.staffVerificationRequested) return true;
  const responders = await ctx.db.query("responders").withIndex("by_event_available", q => q.eq("eventId", args.eventId).eq("isAvailable", true)).take(100);
  const eligible = [];
  for (const responder of responders) {
    const member = await ctx.db.get("memberships", responder.membershipId);
    if (responder.currentTaskId || !member || member.eventId !== args.eventId || member.userId !== responder.userId || member.isBanned || member.role === "ATTENDEE") continue;
    eligible.push(responder);
  }
  const ranked = rankResponders(eligible, incident, {}, false);
  const assigned = Boolean(ranked[0]);
  if (ranked[0]) await executeAssignResponder(ctx, { responderId: ranked[0]._id, incidentId: incident._id, purpose: "verification", instruction: `Physical verification requested at ${incident.location} (${incident.incidentCode}).` });
  await ctx.db.patch("incidents", incident._id, { staffVerificationRequested: assigned, updatedAt: Date.now() });
  await logAgentAction(ctx, args.eventId, "verification", "request_staff_verification", incident.incidentCode, assigned ? "Staff assessment task assigned; awaiting acknowledgment." : "No available staff. Immediate operator assessment required.", assigned ? "action" : "warn", incident._id);

  return true;
}

/** Tool: Request staff physical verification */
export const request_staff_verification = internalMutation({
  args: {
    incidentId: v.id("incidents"),
    eventId: v.id("events"),
  },
  handler: async (ctx, args) => {
    return await executeRequestStaffVerification(ctx, args);
  },
});

export async function executeUpdateVerificationStatus(
  ctx: MutationCtx,
  args: {
    incidentId: Id<"incidents">;
    newStatus: "UNVERIFIED" | "CORROBORATED" | "VERIFIED";
    reason: string;
  },
): Promise<"UNVERIFIED" | "CORROBORATED" | "VERIFIED"> {
  const incident = await ctx.db.get("incidents", args.incidentId);
  if (!incident) throw new Error("Incident not found");
  if (args.newStatus === "VERIFIED") {
    const threshold = THRESHOLDS[incident.incidentType] ?? THRESHOLDS.other;
    const check = canMarkVerified(incident, threshold, incident.averageTrustScore ?? 0);
    if (!check.allowed) throw new Error(check.reason);
  }

  const previousStatus = incident.verificationStatus;
  await ctx.db.patch("incidents", incident._id, {
    verificationStatus: args.newStatus,
    verificationReason: args.reason,
    updatedAt: Date.now(),
  });

  await logAgentAction(
    ctx,
    incident.eventId,
    "verification",
    "update_verification_status",
    `${incident.incidentCode}: ${previousStatus} → ${args.newStatus}`,
    args.reason,
    args.newStatus === "VERIFIED" ? "action" : "info",
    incident._id,
  );

  return args.newStatus;
}

/** Tool: Update verification status */
export const update_verification_status = internalMutation({
  args: {
    incidentId: v.id("incidents"),
    newStatus: verificationStatusValidator,
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    return await executeUpdateVerificationStatus(ctx, args);
  },
});

/** Workflow step: Evaluate incident evidence */
export const evaluateIncident = internalMutation({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) throw new Error("Incident not found");

    const links = await ctx.db
      .query("incidentReports")
      .withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId))
      .take(100);

    const original = links[0] ? await ctx.db.get("reports", links[0].reportId) : null;
    const groupRejected = original?.status === "rejected";
    const reportIds = links.map((l) => l.reportId);
    const reports: Doc<"reports">[] = [];
    for (const rId of reportIds) {
      const rep = await ctx.db.get("reports", rId);
      if (rep && !groupRejected) reports.push(rep);
    }

    if (incident.isResolved) return { previousStatus: incident.verificationStatus, newStatus: incident.verificationStatus, independentCount: 0, avgTrustScore: 0 };
    const reporterUserIds = Array.from(new Set(reports.filter(r => r.eventId === incident.eventId && r.status !== "rejected").map(r => r.reporterId)));
    let totalTrust = 0;
    let independentCount = 0;
    for (const uId of reporterUserIds) {
      const membership = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", incident.eventId).eq("userId", uId)).unique();
      if (membership && !membership.isBanned) { totalTrust += membership.trustScore; independentCount++; }
    }
    const avgTrustScore = independentCount > 0 ? Math.round(totalTrust / independentCount) : 0;
    const hasImageEvidence = reports.some(r => r.status !== "rejected" && Boolean(r.imageStorageId || r.imageUrl));
    await ctx.db.patch("incidents", incident._id, { independentSourceCount: independentCount, averageTrustScore: avgTrustScore, hasImageEvidence, updatedAt: Date.now() });

    const threshold = THRESHOLDS[incident.incidentType] ?? THRESHOLDS.other;
    const canVerify = canMarkVerified(
      { independentSourceCount: independentCount, staffVerifiedBy: incident.staffVerifiedBy },
      threshold,
      avgTrustScore,
    );

    // Attachment presence and model opinions never bypass source/staff policy.
    let newStatus: "UNVERIFIED" | "CORROBORATED" | "VERIFIED" = "UNVERIFIED";
    let reason = canVerify.reason;
    if (canVerify.allowed) { newStatus = "VERIFIED"; }
    else if (independentCount >= 2 || (independentCount === 1 && avgTrustScore >= 70)) {
      newStatus = "CORROBORATED";
      reason = `${independentCount} eligible source account(s), average trust ${avgTrustScore}; staff confirmation may still be required.`;
    }

    await logAgentAction(
      ctx,
      incident.eventId,
      "verification",
      "evaluate_incident_evidence",
      `Incident ${incident.incidentCode}: Trust=${avgTrustScore}/100, Sources=${independentCount}, VisualEvidence=${hasImageEvidence}`,
      `Status: ${newStatus} | Reason: ${reason}`,
      newStatus === "VERIFIED" ? "action" : "info",
      incident._id,
    );

    if (newStatus !== incident.verificationStatus && newStatus !== "VERIFIED") {
      const routes = await ctx.db.query("routeRecommendations").withIndex("by_incident", q => q.eq("incidentId", incident._id)).take(100);
      for (const route of routes) if (route.isActive) await ctx.db.patch("routeRecommendations", route._id, { isActive: false });
      if (newStatus === "UNVERIFIED") {
        const tasks = await ctx.db.query("dispatchTasks").withIndex("by_incident", q => q.eq("incidentId", incident._id)).take(100);
        for (const task of tasks) {
          if ((task.purpose ?? "response") !== "response" || !ACTIVE_TASKS.has(task.status)) continue;
          await ctx.db.patch("dispatchTasks", task._id, { status: "canceled", completedAt: Date.now() });
          const responder = await ctx.db.get("responders", task.responderId);
          if (responder?.currentTaskId === task._id) await ctx.db.patch("responders", responder._id, { isAvailable: true, currentTaskId: undefined, updatedAt: Date.now() });
        }
      }
    }

    if (newStatus === "VERIFIED") {
      // Assessment is finished. Release its reservation before response dispatch.
      const tasks = await ctx.db.query("dispatchTasks").withIndex("by_incident", q => q.eq("incidentId", incident._id)).take(100);
      for (const task of tasks) {
        if (task.purpose !== "verification" || !ACTIVE_TASKS.has(task.status)) continue;
        await ctx.db.patch("dispatchTasks", task._id, { status: "completed", completedAt: Date.now() });
        const responder = await ctx.db.get("responders", task.responderId);
        if (responder?.currentTaskId === task._id) await ctx.db.patch("responders", responder._id, { isAvailable: true, currentTaskId: undefined, updatedAt: Date.now() });
      }
    }

    if (newStatus !== incident.verificationStatus) {
      await executeUpdateVerificationStatus(ctx, {
        incidentId: incident._id,
        newStatus,
        reason,
      });
    }

    if (
      (shouldAlertNearbyStaff(newStatus, incident.severity) || (newStatus !== "VERIFIED" && (incident.severity === "high" || incident.severity === "critical"))) &&
      !incident.staffVerificationRequested
    ) {
      await executeRequestStaffVerification(ctx, {
        incidentId: incident._id,
        eventId: incident.eventId,
      });
    }

    return {
      previousStatus: incident.verificationStatus,
      newStatus,
      independentCount,
      avgTrustScore,
    };
  },
});
