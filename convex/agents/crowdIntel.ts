import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { logAgentAction } from "../lib/agentLog";

const AUTO_ASSIGNABLE_TYPES = new Set(["volunteer", "general"]);

function volunteersNeeded(riskScore: number) {
  return riskScore >= 60 ? Math.max(1, Math.ceil((riskScore - 50) / 10)) : 0;
}

/** Keep high-risk zone posts covered by available volunteer responders. */
export async function executeAutoAssignVolunteers(ctx: MutationCtx, eventId: Id<"events">) {
  const event = await ctx.db.get("events", eventId);
  if (!event?.isActive) return { assigned: 0, released: 0 };

  const [zones, responders] = await Promise.all([
    ctx.db.query("zones").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(50),
    ctx.db.query("responders").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(100),
  ]);
  const desired = new Map(zones.map((zone) => [
    zone._id,
    zone.telemetryStale || zone.telemetryAt === undefined ? 0 : volunteersNeeded(zone.riskScore),
  ]));
  const assignedCounts = new Map<string, number>();
  for (const responder of responders) {
    if (responder.assignmentZoneId && (desired.get(responder.assignmentZoneId) ?? 0) > 0) {
      assignedCounts.set(responder.assignmentZoneId, (assignedCounts.get(responder.assignmentZoneId) ?? 0) + 1);
    }
  }

  let released = 0;
  for (const responder of responders) {
    if (!responder.assignmentZoneId) continue;
    const zoneStillNeedsPost = (desired.get(responder.assignmentZoneId) ?? 0) > 0;
    const count = assignedCounts.get(responder.assignmentZoneId) ?? 0;
    const overallocated = count > (desired.get(responder.assignmentZoneId) ?? 0);
    const member = await ctx.db.get("memberships", responder.membershipId);
    const eligible = Boolean(member && member.eventId === eventId && member.userId === responder.userId && !member.isBanned && member.role !== "ATTENDEE");
    if (!zoneStillNeedsPost || overallocated || !eligible || !AUTO_ASSIGNABLE_TYPES.has(responder.responderType)) {
      assignedCounts.set(responder.assignmentZoneId, Math.max(0, count - 1));
      await ctx.db.patch("responders", responder._id, { isAvailable: true, assignmentZoneId: undefined, assignmentAssignedAt: undefined, updatedAt: Date.now() });
      released++;
    }
  }

  const available = [];
  for (const responder of responders) {
    if (!responder.isAvailable || responder.currentTaskId || responder.assignmentZoneId || !AUTO_ASSIGNABLE_TYPES.has(responder.responderType)) continue;
    const member = await ctx.db.get("memberships", responder.membershipId);
    if (member && member.eventId === eventId && member.userId === responder.userId && !member.isBanned && member.role !== "ATTENDEE") available.push(responder);
  }
  const priorityZones = zones.filter((zone) => (desired.get(zone._id) ?? 0) > 0).sort((a, b) => b.riskScore - a.riskScore);
  let assigned = 0;
  for (const zone of priorityZones) {
    while ((assignedCounts.get(zone._id) ?? 0) < (desired.get(zone._id) ?? 0)) {
      const candidate = available
        .filter((responder) => !responder.assignmentZoneId)
        .sort((a, b) => Math.hypot((a.posX ?? 50) - zone.pinX, (a.posY ?? 50) - zone.pinY) - Math.hypot((b.posX ?? 50) - zone.pinX, (b.posY ?? 50) - zone.pinY))[0];
      if (!candidate) break;
      candidate.assignmentZoneId = zone._id;
      await ctx.db.patch("responders", candidate._id, { isAvailable: false, assignmentZoneId: zone._id, assignmentAssignedAt: Date.now(), currentZoneId: zone._id, posX: zone.pinX, posY: zone.pinY, updatedAt: Date.now() });
      assignedCounts.set(zone._id, (assignedCounts.get(zone._id) ?? 0) + 1);
      assigned++;
    }
  }

  if (assigned || released) {
    await logAgentAction(ctx, eventId, "crowd_intel", "auto_assign_volunteers", `${assigned} assigned, ${released} released`, "Available volunteer and general responders were automatically reconciled against current high-risk zone coverage needs.", "action");
  }
  return { assigned, released };
}

/** Tool: Get zone occupancy stats */
export const get_zone_occupancy = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const zones = await ctx.db
      .query("zones")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(50);

    return zones.map((z) => ({
      zoneId: z._id,
      name: z.name,
      capacity: z.capacity,
      currentOccupancy: z.currentOccupancy,
      densityRatio: z.capacity > 0 ? Math.min(2.0, z.currentOccupancy / z.capacity) : 0,
      zoneType: z.zoneType,
      riskScore: z.riskScore,
    }));
  },
});

/** Tool: Get crowd flow metrics */
export const get_crowd_flow_metrics = internalQuery({
  args: {
    eventId: v.id("events"),
    zoneId: v.optional(v.id("zones")),
  },
  handler: async (ctx, args) => {
    if (args.zoneId) {
      const zone = await ctx.db.get("zones", args.zoneId);
      if (!zone) throw new Error("Zone not found");
      const netFlow = zone.inflowRate - zone.outflowRate;
      const trend = netFlow > 5 ? "increasing" : netFlow < -5 ? "decreasing" : "stable";
      return [{
        zoneId: zone._id,
        name: zone.name,
        inflowRate: zone.inflowRate,
        outflowRate: zone.outflowRate,
        netFlow,
        trend,
      }];
    }

    const zones = await ctx.db
      .query("zones")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(50);

    return zones.map((z) => {
      const netFlow = z.inflowRate - z.outflowRate;
      const trend = netFlow > 5 ? "increasing" : netFlow < -5 ? "decreasing" : "stable";
      return {
        zoneId: z._id,
        name: z.name,
        inflowRate: z.inflowRate,
        outflowRate: z.outflowRate,
        netFlow,
        trend,
      };
    });
  },
});

export async function executePredictZoneRisk(ctx: MutationCtx, eventId: Id<"events">) {
  const zones = await ctx.db
    .query("zones")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .take(50);

  if (zones.length === 0) return [];

  // Query active incidents for proximity weighting
  const activeIncidents = await ctx.db
    .query("incidents")
    .withIndex("by_event_created", (q) => q.eq("eventId", eventId))
    .filter((q) => q.eq(q.field("isResolved"), false))
    .take(30);

  const updatedZones: Array<{
    zoneId: Doc<"zones">["_id"];
    name: string;
    riskScore: number;
    riskFactors: string;
  }> = [];
  let routingStateChanged = false;

  for (const zone of zones) {
    const densityRatio = zone.capacity > 0 ? Math.min(2.0, zone.currentOccupancy / zone.capacity) : 0;
    const netFlow = zone.inflowRate - zone.outflowRate;
    const projectedOccupancy = Math.max(0, zone.currentOccupancy + netFlow * 5);
    const projectedDensity = zone.capacity > 0 ? projectedOccupancy / zone.capacity : 0;
    const projectedPressure = Math.max(0, Math.min(1, (projectedDensity - densityRatio) / 0.5));
    const inflowTrend = zone.capacity > 0
      ? Math.max(0, Math.min(1, netFlow / Math.max(1, zone.capacity * 0.05)))
      : 0;

    let exitFactor = 0;
    if (zone.exitBlocked) {
      exitFactor = 1.0;
    } else if (zone.isNarrowPassage) {
      exitFactor = 0.6;
    }

    let incidentProximity = 0;
    for (const inc of activeIncidents) {
      const dist = Math.hypot(zone.pinX - inc.pinX, zone.pinY - inc.pinY);
      if (dist < 15) {
        incidentProximity = Math.max(incidentProximity, 1.0);
      } else if (dist < 28) {
        incidentProximity = Math.max(incidentProximity, 0.5);
      }
    }

    const rawScore =
      35 * Math.min(1.0, densityRatio) +
      15 * inflowTrend +
      10 * projectedPressure +
      25 * exitFactor +
      10 * incidentProximity;

    const telemetryStale = zone.telemetryAt === undefined || Date.now() - zone.telemetryAt > 120_000;
    const riskScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    const factors: string[] = [];
    if (telemetryStale) factors.push("Telemetry unknown or stale; risk score is not a current safety assessment");
    if (densityRatio > 0.8) factors.push(`High density (${Math.round(densityRatio * 100)}%)`);
    if (netFlow > 15) factors.push(`Rapid surge (+${netFlow}/min)`);
    else if (netFlow < -5) factors.push(`Net outflow (${netFlow}/min)`);
    if (projectedDensity > 0.8 && projectedDensity > densityRatio) {
      factors.push(`5-minute projection ${Math.round(projectedDensity * 100)}% capacity`);
    }
    if (zone.exitBlocked) factors.push("Exit route blocked");
    if (zone.isNarrowPassage) factors.push("Chokepoint / Narrow passage");
    if (incidentProximity > 0) factors.push("Proximity to active incident");

    const riskFactors = factors.length > 0 ? factors.join(", ") : "Normal flow";

    const changed = zone.riskScore !== riskScore || zone.telemetryStale !== telemetryStale;
    routingStateChanged ||= changed;
    await ctx.db.patch("zones", zone._id, {
      riskScore,
      riskFactors,
      telemetryStale,
      ...(changed ? { updatedAt: Date.now() } : {}),
    });

    updatedZones.push({
      zoneId: zone._id,
      name: zone.name,
      riskScore,
      riskFactors,
    });
  }

  updatedZones.sort((a, b) => b.riskScore - a.riskScore);
  if (routingStateChanged) {
    const routes = await ctx.db.query("routeRecommendations").withIndex("by_event_active", q => q.eq("eventId", eventId).eq("isActive", true)).take(100);
    for (const route of routes) await ctx.db.patch("routeRecommendations", route._id, { isActive: false });
  }

  const topHigh = updatedZones.filter((z) => z.riskScore >= 60);
  const summary = updatedZones
    .slice(0, 3)
    .map((z) => `${z.name}=${z.riskScore}`)
    .join(", ");

  await logAgentAction(
    ctx,
    eventId,
    "crowd_intel",
    "predict_zone_risk",
    `Assessed ${zones.length} venue zones`,
    `Top risks: ${summary}. ${topHigh.length} critical/high zones.`,
    topHigh.length > 0 ? "warn" : "info",
  );

  return updatedZones;
}

/** Tool: Compute & update zone risk scores */
export const predict_zone_risk = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    return await executePredictZoneRisk(ctx, args.eventId);
  },
});

export async function executeRecommendResourceAllocation(ctx: MutationCtx, eventId: Id<"events">) {
  const zones = await ctx.db
    .query("zones")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .take(50);

  const highRiskZones = zones.filter((z) => z.riskScore >= 60);
  const recommendations = highRiskZones.map((z) => ({
    zoneId: z._id,
    zoneName: z.name,
    riskScore: z.riskScore,
      additionalVolunteersNeeded: Math.max(1, Math.ceil((z.riskScore - 50) / 10)),
    recommendedAction:
      z.riskScore > 80
        ? "Immediate crowd diversion & perimeter control"
        : "Deploy crowd marshals and open overflow corridors",
  }));

  if (recommendations.length > 0) {
    await logAgentAction(
      ctx,
      eventId,
      "crowd_intel",
      "recommend_resource_allocation",
      `${recommendations.length} zones exceeding 60 risk threshold`,
      recommendations
        .map((r) => `${r.zoneName}: +${r.additionalVolunteersNeeded} marshals`)
        .join(" | "),
      "action",
    );
  }

  return recommendations;
}

/** Tool: Recommend resource & staff allocation */
export const recommend_resource_allocation = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    return await executeRecommendResourceAllocation(ctx, args.eventId);
  },
});

/** Workflow step: Complete crowd intel assessment */
export const assessAllZones = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const riskResults = await executePredictZoneRisk(ctx, args.eventId);
    await executeRecommendResourceAllocation(ctx, args.eventId);
    await executeAutoAssignVolunteers(ctx, args.eventId);
    return riskResults;
  },
});
