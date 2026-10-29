import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { logAgentAction } from "../lib/agentLog";

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
      densityRatio: z.capacity > 0 ? Math.min(1.0, z.currentOccupancy / z.capacity) : 0,
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

  for (const zone of zones) {
    const densityRatio = zone.capacity > 0 ? Math.min(2.0, zone.currentOccupancy / zone.capacity) : 0;
    const netFlow = zone.inflowRate - zone.outflowRate;
    const rawInflowTrend = zone.capacity > 0 ? netFlow / (zone.capacity * 0.1) : 0;
    const inflowTrend = Math.max(0, Math.min(1.0, (rawInflowTrend + 1) / 2));

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
      40 * Math.min(1.0, densityRatio) +
      25 * inflowTrend +
      25 * exitFactor +
      10 * incidentProximity;

    const riskScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    const factors: string[] = [];
    if (densityRatio > 0.8) factors.push(`High density (${Math.round(densityRatio * 100)}%)`);
    if (netFlow > 15) factors.push(`Rapid surge (+${netFlow}/min)`);
    if (zone.exitBlocked) factors.push("Exit route blocked");
    if (zone.isNarrowPassage) factors.push("Chokepoint / Narrow passage");
    if (incidentProximity > 0) factors.push("Proximity to active incident");

    const riskFactors = factors.length > 0 ? factors.join(", ") : "Normal flow";

    await ctx.db.patch("zones", zone._id, {
      riskScore,
      riskFactors,
      updatedAt: Date.now(),
    });

    updatedZones.push({
      zoneId: zone._id,
      name: zone.name,
      riskScore,
      riskFactors,
    });
  }

  updatedZones.sort((a, b) => b.riskScore - a.riskScore);

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

  const highRiskZones = zones.filter((z) => z.riskScore > 60);
  const recommendations = highRiskZones.map((z) => ({
    zoneId: z._id,
    zoneName: z.name,
    riskScore: z.riskScore,
    additionalVolunteersNeeded: Math.max(1, Math.ceil((z.riskScore - 60) / 10)),
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
    return riskResults;
  },
});
