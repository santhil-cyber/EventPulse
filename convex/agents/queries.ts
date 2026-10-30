import { volunteersNeeded } from "./crowdIntel";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { graphFingerprint, calculateRoute, pathCapacity } from "../lib/routeGraph";
import { loadGraph, loadRouteReservations } from "./routing";
import { canBroadcastEvacuation } from "../lib/safety";
import { ACTIVE_TASKS, assertTaskTransition } from "../lib/dispatchPolicy";
import { safeLimit } from "../ai/policy";
import { mutation, query } from "../_generated/server";
import { logAgentAction } from "../lib/agentLog";
import { requireRole, requireUser } from "../lib/authz";
import { dispatchStatusValidator } from "../schema";
import { scheduleDispatchReview } from "../responders";

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

      let resolvedImageUrl = inc.imageUrl?.startsWith("https://") ? inc.imageUrl : undefined;
      if (inc.imageStorageId) {
        resolvedImageUrl = (await ctx.storage.getUrl(inc.imageStorageId)) ?? undefined;
      }

      const contributingReports = [];
      for (const link of links) {
        const rep = await ctx.db.get("reports", link.reportId);
        if (rep) {
          let repImg = rep.imageUrl?.startsWith("https://") ? rep.imageUrl : undefined;
          if (rep.imageStorageId) {
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

      const analysis = inc.aiAnalysisId ? await ctx.db.get("aiAnalyses", inc.aiAnalysisId) : null;
      const hasImageAnalysis = analysis?.status === "completed" && analysis.imageAnalyzed && analysis.incidentId === inc._id && analysis.eventId === inc.eventId;
      enriched.push({
        ...inc,
        imageAnalysis: hasImageAnalysis ? inc.imageAnalysis : undefined,
        imageConfidence: undefined,
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
      .take(safeLimit(args.limit, 100, 200));
  },
});

/** Live zones with occupancy, risk score, and flow rates */
export const listZonesWithRisk = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.eventId, STAFF_ROLES);

    const zones = await ctx.db
      .query("zones")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(50);
    const responders = await ctx.db.query("responders").withIndex("by_event", (q) => q.eq("eventId", args.eventId)).take(100);
    const assignedCounts = new Map<string, number>();
    for (const responder of responders) if (responder.assignmentZoneId) assignedCounts.set(responder.assignmentZoneId, (assignedCounts.get(responder.assignmentZoneId) ?? 0) + 1);
    return zones
      .map((zone) => {
        const netFlow = zone.inflowRate - zone.outflowRate;
        const projectedOccupancy = Math.max(0, Math.round(zone.currentOccupancy + netFlow * 5));
        return {
          ...zone,
          netFlow,
          flowTrend: netFlow > 5 ? "increasing" as const : netFlow < -5 ? "decreasing" as const : "stable" as const,
          projectedOccupancy,
          projectedDensity: zone.capacity > 0 ? Math.round((projectedOccupancy / zone.capacity) * 100) : 0,
          additionalVolunteersNeeded: zone.telemetryStale || !zone.telemetryAt ? 0 : volunteersNeeded(zone.unmitigatedRiskScore ?? zone.riskScore),
          assignedVolunteerCount: assignedCounts.get(zone._id) ?? 0,
          volunteerShortfall: Math.max(0, (zone.telemetryStale || !zone.telemetryAt ? 0 : volunteersNeeded(zone.unmitigatedRiskScore ?? zone.riskScore)) - (assignedCounts.get(zone._id) ?? 0)),
        };
      })
      .sort((a, b) => b.riskScore - a.riskScore);
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
      const incident = r.incidentId ? await ctx.db.get("incidents", r.incidentId) : null;
      enriched.push({
        ...r,
        affectedZoneName: zone?.name ?? "Zone",
        incidentCode: incident?.incidentCode ?? "Unknown incident",
        incidentVerificationStatus: incident?.verificationStatus ?? "UNVERIFIED",
        approvalReady: Boolean(incident && !incident.isResolved && incident.eventId === r.eventId && incident.verificationStatus === "VERIFIED"),
      });
    }

    return enriched;
  },
});

export const listPublicRoutes = query({
  args: { eventId: v.id("events"), now: v.number() },
  handler: async (ctx, { eventId, now }) => {
    await requireRole(ctx, eventId, ["ATTENDEE", "STAFF", "ORGANIZER"]);
    const routes = await ctx.db.query("routeRecommendations").withIndex("by_event_active", q => q.eq("eventId", eventId).eq("isActive", true)).take(100);
    const approved = routes.filter(route => !route.requiresApproval && route.approvedBy && route.approvedAt && route.expiresAt && route.expiresAt > now);
    if (!approved.length) return [];
    const graph = await loadGraph(ctx, eventId, now);
    const fingerprint = graphFingerprint(graph.zones, graph.edges);
    const zones = new Map<string, (typeof graph.zones)[number]>(graph.zones.map(zone => [zone._id, zone]));
    const guidance = [];
    for (const route of approved) {
      if (route.graphFingerprint !== fingerprint) continue;
      const incident = route.incidentId ? await ctx.db.get("incidents", route.incidentId) : null;
      if (!incident || incident.isResolved || incident.verificationStatus !== "VERIFIED") continue;
      const path: unknown = JSON.parse(route.routePath);
      if (!Array.isArray(path) || path.length < 2 || path.some(id => typeof id !== "string" || !zones.has(id))) continue;
      const names = path.map(id => zones.get(id)!.name);
      guidance.push({ id: route._id, affectedZone: names[0], destination: names[names.length - 1], pathNames: names, pathPoints: path.map(id => ({ x: zones.get(id)!.pinX, y: zones.get(id)!.pinY })), plannedPeople: route.plannedPeople ?? 1, isEvacuation: route.isEvacuation, expiresAt: route.expiresAt });
    }
    return guidance;
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
      .take(100);

    const enriched = [];
    for (const r of responders) {
      const user = await ctx.db.get("users", r.userId);
      const member = await ctx.db.get("memberships", r.membershipId);
      const eligible = Boolean(member && member.eventId === r.eventId && member.userId === r.userId && !member.isBanned && member.role !== "ATTENDEE");
      let currentTaskInstruction: string | undefined;
      if (r.currentTaskId) {
        const task = await ctx.db.get("dispatchTasks", r.currentTaskId);
        currentTaskInstruction = task?.instruction;
      }

      enriched.push({
        ...r,
        eligible,
        assignedZoneName: r.assignmentZoneId ? (await ctx.db.get("zones", r.assignmentZoneId))?.name : undefined,
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

    const tasks = await ctx.db.query("dispatchTasks").withIndex("by_incident", q => q.eq("incidentId", incident._id)).take(101);
    if (tasks.length > 100) throw new Error("Task history requires operator cleanup before resolution.");
    for (const task of tasks) {
      if (!ACTIVE_TASKS.has(task.status)) continue;
      await ctx.db.patch("dispatchTasks", task._id, { status: "canceled", completedAt: Date.now() });
      const responder = await ctx.db.get("responders", task.responderId);
      if (responder?.currentTaskId === task._id) await ctx.db.patch("responders", responder._id, { isAvailable: true, currentTaskId: undefined, updatedAt: Date.now() });
    }
    const routes = await ctx.db.query("routeRecommendations").withIndex("by_incident", q => q.eq("incidentId", incident._id)).take(100);
    for (const route of routes) if (route.isActive) await ctx.db.patch("routeRecommendations", route._id, { isActive: false });
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

    if (!rec.isActive || !rec.expiresAt || rec.expiresAt <= Date.now()) throw new Error("Route is inactive or expired. Recalculate before approval.");
    const incident = rec.incidentId ? await ctx.db.get("incidents", rec.incidentId) : null;
    if (!incident || incident.eventId !== rec.eventId || incident.isResolved) throw new Error("An active incident is required.");
    if (incident.verificationStatus !== "VERIFIED") throw new Error("Public route approval requires a VERIFIED incident.");
    if (rec.isEvacuation) {
      const check = canBroadcastEvacuation(incident.verificationStatus, moderator.userId);
      if (!check.allowed) throw new Error(check.reason);
    }
    const graph = await loadGraph(ctx, rec.eventId, Date.now());
    if (rec.graphFingerprint !== graphFingerprint(graph.zones, graph.edges)) throw new Error("Venue conditions changed. Recalculate route before approval.");
    const path: unknown = JSON.parse(rec.routePath);
    if (!Array.isArray(path) || path.length < 2) throw new Error("Invalid route.");
    const reservations = await loadRouteReservations(ctx, rec.eventId, graph.edges, rec._id);
    const plannedPeople = rec.plannedPeople ?? 1;
    if (pathCapacity(path, graph.zones, graph.edges, reservations) < plannedPeople) throw new Error("Route wave exceeds current capacity. Recalculate before approval.");
    const validated = calculateRoute(graph.zones, graph.edges, path[0], path[path.length - 1], [], plannedPeople, reservations);
    if (!validated.feasible || validated.path.join() !== path.join()) throw new Error("Route is no longer safe.");
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

    const moderator = await requireRole(ctx, task.eventId, STAFF_ROLES);

    if (task.status === args.status) return true;
    assertTaskTransition(task.status, args.status);
    const incident = await ctx.db.get("incidents", task.incidentId);
    if (!incident || incident.isResolved) throw new Error("Incident is closed.");
    const updates: { status: typeof args.status; acceptedAt?: number; completedAt?: number } = { status: args.status };
    const now = Date.now();
    if (args.status === "accepted") updates.acceptedAt = now;
    if (["completed", "rejected", "canceled", "escalated"].includes(args.status)) {
      updates.completedAt = now;
      const responder = await ctx.db.get("responders", task.responderId);
      if (responder?.currentTaskId === task._id) {
        await ctx.db.patch("responders", responder._id, { isAvailable: true, currentTaskId: undefined, updatedAt: now });
        if (args.status === "completed") await scheduleDispatchReview(ctx, task.eventId);
      }
    }

    await ctx.db.patch("dispatchTasks", task._id, updates);

    // A completed response task is the staff confirmation that the on-site
    // intervention is finished. Resolve only after every response task has
    // stopped being active and at least one response task completed. Staff
    // verification tasks are intentionally excluded from this gate.
    if (args.status === "completed" && (task.purpose ?? "response") === "response") {
      const responseTasks = (await ctx.db
        .query("dispatchTasks")
        .withIndex("by_incident", (q) => q.eq("incidentId", task.incidentId))
        .take(101))
        .filter((candidate) => (candidate.purpose ?? "response") === "response");
      const hasActiveResponse = responseTasks.some((candidate) => ACTIVE_TASKS.has(candidate.status));
      const hasCompletedResponse = responseTasks.some((candidate) => candidate.status === "completed");

      if (!hasActiveResponse && hasCompletedResponse && incident.verificationStatus === "VERIFIED") {
        const routes = await ctx.db
          .query("routeRecommendations")
          .withIndex("by_incident", (q) => q.eq("incidentId", task.incidentId))
          .take(100);
        for (const route of routes) {
          if (route.isActive) await ctx.db.patch("routeRecommendations", route._id, { isActive: false });
        }

        await ctx.db.patch("incidents", incident._id, {
          isResolved: true,
          resolvedAt: now,
          resolvedBy: moderator.userId,
          updatedAt: now,
        });
        await logAgentAction(
          ctx,
          task.eventId,
          "orchestrator",
          "auto_resolve_after_staff_confirmation",
          `Incident ${incident.incidentCode} resolved after response task completion`,
          "All response tasks completed; staff completion confirmation recorded.",
          "action",
          incident._id,
        );
      }
    }

    if (args.status === "rejected") await ctx.scheduler.runAfter(0, internal.agents.dispatch.escalate_unaccepted_task, { taskId: task._id });
    if (args.status === "accepted") await ctx.scheduler.runAfter(Math.max(600_000, (task.estimatedEta ?? 0) * 2000), internal.agents.dispatch.checkArrival, { taskId: task._id });

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
    const userId = await requireUser(ctx);
    const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", userId)).take(100);
    const events = [];
    for (const membership of memberships) {
      if (membership.isBanned || membership.role === "ATTENDEE") continue;
      const event = await ctx.db.get("events", membership.eventId);
      if (event) events.push(event);
    }

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
