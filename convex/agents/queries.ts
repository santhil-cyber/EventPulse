import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { logAgentAction } from "../lib/agentLog";
import { requireRole } from "../lib/authz";
import { dispatchStatusValidator } from "../schema";

const STAFF_ROLES = ["ORGANIZER", "STAFF"] as const;

/** Master incidents with live status for staff dashboard */
export const listIncidents = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.eventId, STAFF_ROLES);

    const incidents = await ctx.db
      .query("incidents")
      .withIndex("by_event_created", (q) => q.eq("eventId", args.eventId))
      .order("desc")
      .take(50);

    const enriched = [];
    for (const inc of incidents) {
      const links = await ctx.db
        .query("incidentReports")
        .withIndex("by_incident", (q) => q.eq("incidentId", inc._id))
        .take(50);

      let resolvedImageUrl = inc.imageUrl;
      if (!resolvedImageUrl && inc.imageStorageId) {
        resolvedImageUrl = (await ctx.storage.getUrl(inc.imageStorageId)) ?? undefined;
      }

      const contributingReports = [];
      for (const link of links) {
        const rep = await ctx.db.get("reports", link.reportId);
        if (rep) {
          let repImg = rep.imageUrl;
          if (!repImg && rep.imageStorageId) {
            repImg = (await ctx.storage.getUrl(rep.imageStorageId)) ?? undefined;
          }
          contributingReports.push({
            id: rep._id,
            description: rep.description,
            location: rep.location,
            pinX: rep.pinX,
            pinY: rep.pinY,
            createdAt: rep.createdAt,
            imageUrl: repImg,
            similarityScore: link.similarityScore,
            isOriginal: link.isOriginal,
          });
        }
      }

      enriched.push({
        ...inc,
        imageUrl: resolvedImageUrl,
        reportCount: links.length,
        contributingReports,
      });
    }

    return enriched;
  },
});

/** Real-time execution log of all agent tool calls */
export const listAgentLogs = query({
  args: {
    eventId: v.id("events"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.eventId, STAFF_ROLES);

    return await ctx.db
      .query("agentLogs")
      .withIndex("by_event_created", (q) => q.eq("eventId", args.eventId))
      .order("desc")
      .take(args.limit ?? 100);
  },
});

/** Live zones with occupancy, risk score, and flow rates */
export const listZonesWithRisk = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.eventId, STAFF_ROLES);

    return await ctx.db
      .query("zones")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(50);
  },
});

/** Active route recommendations issued by routing agent */
export const listActiveRoutes = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.eventId, STAFF_ROLES);

    const routes = await ctx.db
      .query("routeRecommendations")
      .withIndex("by_event_active", (q) =>
        q.eq("eventId", args.eventId).eq("isActive", true),
      )
      .take(20);

    const enriched = [];
    for (const r of routes) {
      const zone = await ctx.db.get("zones", r.affectedZoneId);
      enriched.push({
        ...r,
        affectedZoneName: zone?.name ?? "Zone",
      });
    }

    return enriched;
  },
});

/** Responders and their current availability and location */
export const listResponders = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.eventId, STAFF_ROLES);

    const responders = await ctx.db
      .query("responders")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(50);

    const enriched = [];
    for (const r of responders) {
      const user = await ctx.db.get("users", r.userId);
      let currentTaskInstruction: string | undefined;
      if (r.currentTaskId) {
        const task = await ctx.db.get("dispatchTasks", r.currentTaskId);
        currentTaskInstruction = task?.instruction;
      }

      enriched.push({
        ...r,
        name: r.name ?? user?.name ?? user?.email ?? "Responder",
        currentTaskInstruction,
      });
    }

    return enriched;
  },
});

/** Dispatch tasks with assignee info */
export const listDispatchTasks = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.eventId, STAFF_ROLES);

    const tasks = await ctx.db
      .query("dispatchTasks")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .order("desc")
      .take(50);

    const enriched = [];
    for (const t of tasks) {
      const [responder, incident] = await Promise.all([
        ctx.db.get("responders", t.responderId),
        ctx.db.get("incidents", t.incidentId),
      ]);

      enriched.push({
        ...t,
        responderName: responder?.name ?? responder?.responderType ?? "Assigned Staff",
        responderType: responder?.responderType ?? "general",
        incidentCode: incident?.incidentCode ?? "INC",
        incidentLocation: incident?.location ?? "Venue",
      });
    }

    return enriched;
  },
});

/** Mark an incident as resolved */
export const resolveIncident = mutation({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) throw new Error("Incident not found");

    const moderator = await requireRole(ctx, incident.eventId, STAFF_ROLES);

    await ctx.db.patch("incidents", incident._id, {
      isResolved: true,
      resolvedAt: Date.now(),
      resolvedBy: moderator.userId,
      updatedAt: Date.now(),
    });

    await logAgentAction(
      ctx,
      incident.eventId,
      "orchestrator",
      "resolveIncident",
      `Incident ${incident.incidentCode} marked resolved by ${moderator.role}`,
      "All linked tasks cleared",
      "action",
      incident._id,
    );

    return true;
  },
});

/** Approve an evacuation or crowd reroute recommendation */
export const approveRoute = mutation({
  args: { recommendationId: v.id("routeRecommendations") },
  handler: async (ctx, args) => {
    const rec = await ctx.db.get("routeRecommendations", args.recommendationId);
    if (!rec) throw new Error("Recommendation not found");

    const moderator = await requireRole(ctx, rec.eventId, ["ORGANIZER", "STAFF"]);

    await ctx.db.patch("routeRecommendations", rec._id, {
      requiresApproval: false,
      approvedBy: moderator.userId,
      approvedAt: Date.now(),
    });

    await logAgentAction(
      ctx,
      rec.eventId,
      "routing",
      "approveRoute",
      `Control room approved route broadcast for zone`,
      rec.instruction,
      "action",
      rec.incidentId,
    );

    return true;
  },
});

/** Update status of dispatch task */
export const updateTaskStatus = mutation({
  args: {
    taskId: v.id("dispatchTasks"),
    status: dispatchStatusValidator,
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get("dispatchTasks", args.taskId);
    if (!task) throw new Error("Task not found");

    await requireRole(ctx, task.eventId, STAFF_ROLES);

    const updates: Record<string, any> = { status: args.status };
    const now = Date.now();

    if (args.status === "accepted") {
      updates.acceptedAt = now;
    } else if (args.status === "completed") {
      updates.completedAt = now;
      // Free responder
      await ctx.db.patch("responders", task.responderId, {
        isAvailable: true,
        currentTaskId: undefined,
        updatedAt: now,
      });
    }

    await ctx.db.patch("dispatchTasks", task._id, updates);

    await logAgentAction(
      ctx,
      task.eventId,
      "dispatch",
      "updateTaskStatus",
      `Task ${task._id.slice(-4)}: ${task.status} → ${args.status}`,
      `Instruction: ${task.instruction.slice(0, 40)}...`,
      args.status === "completed" ? "action" : "info",
      task.incidentId,
    );

    return true;
  },
});

/**
 * Historical Analytics & Real-Time Trend Detection (Section 9.4)
 * Provides comprehensive statistical breakdown of incident types, severity distribution,
 * high-risk zones, average verification trust scores, and agent execution metrics.
 */
export const getIncidentAnalytics = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.eventId, STAFF_ROLES);

    const [incidents, zones, agentLogs, dispatchTasks] = await Promise.all([
      ctx.db
        .query("incidents")
        .withIndex("by_event_created", (q) => q.eq("eventId", args.eventId))
        .take(200),
      ctx.db
        .query("zones")
        .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
        .take(50),
      ctx.db
        .query("agentLogs")
        .withIndex("by_event_created", (q) => q.eq("eventId", args.eventId))
        .take(300),
      ctx.db
        .query("dispatchTasks")
        .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
        .take(100),
    ]);

    const byType: Record<string, number> = {
      medical: 0,
      fire: 0,
      stampede: 0,
      security: 0,
      infrastructure: 0,
      other: 0,
    };

    const bySeverity: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    let totalVerificationScore = 0;
    let totalTrustScore = 0;
    let activeCount = 0;
    let verifiedCount = 0;
    let resolvedCount = 0;

    for (const inc of incidents) {
      if (!inc.isResolved) activeCount++;
      if (inc.isResolved) resolvedCount++;
      if (inc.verificationStatus === "VERIFIED") verifiedCount++;

      byType[inc.incidentType] = (byType[inc.incidentType] ?? 0) + 1;
      bySeverity[inc.severity] = (bySeverity[inc.severity] ?? 0) + 1;

      const vScore =
        inc.verificationStatus === "VERIFIED" ? 0.95 : inc.verificationStatus === "CORROBORATED" ? 0.65 : 0.25;
      totalVerificationScore += vScore;
      totalTrustScore += inc.averageTrustScore ?? 65;
    }

    const n = incidents.length || 1;
    const avgVerification = Math.round((totalVerificationScore / n) * 100) / 100;
    const avgTrust = Math.round(totalTrustScore / n);

    const highRiskZones = zones
      .filter((z) => z.riskScore > 30)
      .map((z) => ({
        id: z._id,
        name: z.name,
        riskScore: z.riskScore,
        riskLevel: z.riskScore > 60 ? "critical" : "high",
        currentOccupancy: z.currentOccupancy,
        capacity: z.capacity,
        densityRatio: Math.round((z.currentOccupancy / (z.capacity || 1)) * 100),
      }));

    const agentActivity: Record<string, number> = {
      intake: 0,
      verification: 0,
      crowd_intel: 0,
      routing: 0,
      dispatch: 0,
      safety: 0,
      orchestrator: 0,
    };

    for (const log of agentLogs) {
      agentActivity[log.agentName] = (agentActivity[log.agentName] ?? 0) + 1;
    }

    return {
      totalIncidents: incidents.length,
      activeIncidents: activeCount,
      verifiedIncidents: verifiedCount,
      resolvedIncidents: resolvedCount,
      byType,
      bySeverity,
      avgVerificationScore: avgVerification,
      avgTrustScore: avgTrust,
      highRiskZones,
      totalAgentActions: agentLogs.length,
      agentActivity,
      activeDispatchTasks: dispatchTasks.filter((t) => t.status !== "completed").length,
    };
  },
});

/**
 * Audit Trail Export Engine (Section 9.8)
 * Exports complete agent decision logs and incident history for post-event analysis and accountability.
 */
export const exportAuditTrail = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.eventId, STAFF_ROLES);

    const [logs, incidents] = await Promise.all([
      ctx.db
        .query("agentLogs")
        .withIndex("by_event_created", (q) => q.eq("eventId", args.eventId))
        .order("asc")
        .take(500),
      ctx.db
        .query("incidents")
        .withIndex("by_event_created", (q) => q.eq("eventId", args.eventId))
        .take(100),
    ]);

    const incidentMap = new Map(incidents.map((i) => [i._id, i]));

    const exportRows = logs.map((log) => {
      const inc = log.incidentId ? incidentMap.get(log.incidentId) : undefined;
      return {
        timestamp: log.createdAt,
        timeISO: new Date(log.createdAt).toISOString(),
        agent: log.agentName,
        tool: log.toolName,
        level: log.level,
        incidentCode: inc?.incidentCode ?? "-",
        incidentType: inc?.incidentType ?? "-",
        severity: inc?.severity ?? "-",
        verificationStatus: inc?.verificationStatus ?? "-",
        input: log.inputSummary.replace(/"/g, '""'),
        output: log.outputSummary.replace(/"/g, '""'),
      };
    });

    return exportRows;
  },
});

/**
 * Multi-Event Concurrent Monitoring Overview (Section 9.6)
 * Enables central operations to monitor safety status across multiple live events.
 */
export const getMultiEventOversight = query({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db
      .query("events")
      .order("desc")
      .take(10);

    const oversight = [];
    for (const evt of events) {
      const [incidents, responders] = await Promise.all([
        ctx.db
          .query("incidents")
          .withIndex("by_event_created", (q) => q.eq("eventId", evt._id))
          .filter((q) => q.eq(q.field("isResolved"), false))
          .take(50),
        ctx.db
          .query("responders")
          .withIndex("by_event", (q) => q.eq("eventId", evt._id))
          .take(20),
      ]);

      const criticalCount = incidents.filter((i) => i.severity === "critical").length;
      const verifiedCount = incidents.filter((i) => i.verificationStatus === "VERIFIED").length;

      oversight.push({
        eventId: evt._id,
        name: evt.name,
        venue: evt.venue,
        date: evt.date,
        isActive: evt.isActive,
        activeIncidents: incidents.length,
        criticalIncidents: criticalCount,
        verifiedThreats: verifiedCount,
        availableResponders: responders.filter((r) => r.isAvailable).length,
        totalResponders: responders.length,
      });
    }

    return oversight;
  },
});
