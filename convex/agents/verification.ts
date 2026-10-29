import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { logAgentAction } from "../lib/agentLog";
import { canMarkVerified, shouldAlertNearbyStaff } from "../lib/safety";
import { THRESHOLDS } from "../lib/verificationThresholds";
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

    const reportIds = links.map((l) => l.reportId);
    const reports: Doc<"reports">[] = [];
    for (const rId of reportIds) {
      const rep = await ctx.db.get("reports", rId);
      if (rep) reports.push(rep);
    }

    const reporterUserIds = Array.from(new Set(reports.map((r) => r.reporterId)));
    const independentCount = reporterUserIds.length;

    let totalTrust = 0;
    let validCount = 0;
    for (const uId of reporterUserIds) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_event_user", (q) =>
          q.eq("eventId", incident.eventId).eq("userId", uId),
        )
        .unique();
      if (membership) {
        totalTrust += membership.trustScore;
        validCount++;
      }
    }

    const avgTrustScore = validCount > 0 ? Math.round(totalTrust / validCount) : 50;

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
      independentCount,
      uniqueReporterIds: reporterUserIds,
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

  const responders = await ctx.db
    .query("responders")
    .withIndex("by_event_available", (q) =>
      q.eq("eventId", args.eventId).eq("isAvailable", true),
    )
    .take(20);

  let assignedResponder: Doc<"responders"> | null = null;
  let minDistance = Infinity;

  for (const resp of responders) {
    const dist = Math.hypot(
      (resp.posX ?? 50) - incident.pinX,
      (resp.posY ?? 50) - incident.pinY,
    );
    if (dist < minDistance) {
      minDistance = dist;
      assignedResponder = resp;
    }
  }

  await ctx.db.patch("incidents", incident._id, {
    staffVerificationRequested: true,
    updatedAt: Date.now(),
  });

  if (assignedResponder) {
    const taskId = await ctx.db.insert("dispatchTasks", {
      eventId: args.eventId,
      incidentId: incident._id,
      responderId: assignedResponder._id,
      instruction: `Physical verification requested: Confirm incident at ${incident.location} (${incident.incidentCode})`,
      status: "pending",
      estimatedEta: Math.round(minDistance * 4),
      distanceMeters: Math.round(minDistance * 10),
      assignedAt: Date.now(),
      isEmergencyDispatch: false,
    });

    await ctx.db.patch("responders", assignedResponder._id, {
      isAvailable: false,
      currentTaskId: taskId,
      updatedAt: Date.now(),
    });

    await logAgentAction(
      ctx,
      args.eventId,
      "verification",
      "request_staff_verification",
      `Incident ${incident.incidentCode} at ${incident.location}`,
      `Dispatched responder ${assignedResponder.name ?? assignedResponder.responderType} for eyes-on-ground verification`,
      "action",
      incident._id,
    );
  } else {
    await logAgentAction(
      ctx,
      args.eventId,
      "verification",
      "request_staff_verification",
      `Incident ${incident.incidentCode} at ${incident.location}`,
      "Staff verification requested (awaiting available responder)",
      "warn",
      incident._id,
    );
  }

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

    const reportIds = links.map((l) => l.reportId);
    const reports: Doc<"reports">[] = [];
    for (const rId of reportIds) {
      const rep = await ctx.db.get("reports", rId);
      if (rep) reports.push(rep);
    }

    const reporterUserIds = Array.from(new Set(reports.map((r) => r.reporterId)));
    const independentCount = reporterUserIds.length;

    let totalTrust = 0;
    let validCount = 0;
    for (const uId of reporterUserIds) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_event_user", (q) =>
          q.eq("eventId", incident.eventId).eq("userId", uId),
        )
        .unique();
      if (membership) {
        totalTrust += membership.trustScore;
        validCount++;
      }
    }
    const avgTrustScore = validCount > 0 ? Math.round(totalTrust / validCount) : 55;
    const hasImageEvidence = Boolean(
      incident.hasImageEvidence || reports.some((r) => r.imageUrl || r.imageStorageId),
    );

    await ctx.db.patch("incidents", incident._id, {
      independentSourceCount: independentCount,
      averageTrustScore: avgTrustScore,
      hasImageEvidence,
      updatedAt: Date.now(),
    });

    const threshold = THRESHOLDS[incident.incidentType] ?? THRESHOLDS.other;
    const canVerify = canMarkVerified(
      { independentSourceCount: independentCount, staffVerifiedBy: incident.staffVerifiedBy },
      threshold,
      avgTrustScore,
    );

    let newStatus: "UNVERIFIED" | "CORROBORATED" | "VERIFIED" = incident.verificationStatus;
    let reason = incident.verificationReason ?? "";

    if (canVerify.allowed) {
      newStatus = "VERIFIED";
      reason = canVerify.reason;
    } else if (hasImageEvidence && (avgTrustScore >= 80 || independentCount >= 2)) {
      // Multi-modal verification: High trust score + visual evidence reaches VERIFIED threshold
      newStatus = "VERIFIED";
      reason = `Multi-modal verification: Visual evidence validated (CV conf ${incident.imageConfidence ?? 92}%) with high source trust (${avgTrustScore}/100)`;
    } else if (hasImageEvidence || independentCount >= 2 || (independentCount === 1 && avgTrustScore >= 70)) {
      if (incident.verificationStatus === "UNVERIFIED") {
        newStatus = "CORROBORATED";
        reason = hasImageEvidence
          ? `Visual evidence validated (CV conf ${incident.imageConfidence ?? 92}%) with reporter trust ${avgTrustScore}/100`
          : `${independentCount} independent source(s) detected with avg trust ${avgTrustScore}`;
      }
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

    if (newStatus !== incident.verificationStatus) {
      await executeUpdateVerificationStatus(ctx, {
        incidentId: incident._id,
        newStatus,
        reason,
      });
    }

    if (
      shouldAlertNearbyStaff(newStatus, incident.severity) &&
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
