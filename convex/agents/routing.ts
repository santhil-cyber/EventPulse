import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { logAgentAction } from "../lib/agentLog";

/** Tool: Get venue graph representation */
export const get_venue_graph = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const zones = await ctx.db
      .query("zones")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(50);

    const edges = await ctx.db
      .query("venueEdges")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(200);

    const adjacency: Record<string, Array<{ to: string; weight: number; passable: boolean }>> = {};
    for (const z of zones) adjacency[z._id] = [];

    for (const e of edges) {
      if (!adjacency[e.fromZoneId]) adjacency[e.fromZoneId] = [];
      adjacency[e.fromZoneId].push({
        to: e.toZoneId,
        weight: e.currentWeight,
        passable: e.isPassable,
      });
    }

    return { zones, edges, adjacency };
  },
});

/** Tool: Check capacity at exit */
export const check_exit_capacity = internalQuery({
  args: { zoneId: v.id("zones") },
  handler: async (ctx, args) => {
    const zone = await ctx.db.get("zones", args.zoneId);
    if (!zone) throw new Error("Zone not found");

    const capacity = Math.max(1, zone.capacity);
    const utilizationPercent = Math.round((zone.currentOccupancy / capacity) * 100);
    const hasCapacity = utilizationPercent < 85 && !zone.exitBlocked;

    const netInflow = zone.inflowRate - zone.outflowRate;
    let willOverflowInMinutes: number | undefined;
    if (netInflow > 0 && zone.currentOccupancy < capacity) {
      willOverflowInMinutes = Math.round((capacity - zone.currentOccupancy) / netInflow);
    }

    return {
      hasCapacity,
      utilizationPercent,
      willOverflowInMinutes,
      exitBlocked: zone.exitBlocked,
    };
  },
});

export async function executeCalculateSafeRoute(
  ctx: MutationCtx,
  args: {
    eventId: Id<"events">;
    fromZoneId: Id<"zones">;
    toZoneId: Id<"zones">;
    avoidZoneIds?: Id<"zones">[];
  },
): Promise<{
  path: Id<"zones">[];
  pathNames: string[];
  totalWeight: number;
  estimatedTimeSeconds: number;
  feasible: boolean;
}> {
  const zones = await ctx.db
    .query("zones")
    .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
    .take(50);

  const edges = await ctx.db
    .query("venueEdges")
    .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
    .take(200);

  const zoneMap = new Map<string, Doc<"zones">>();
  for (const z of zones) zoneMap.set(z._id, z);

  const fromZone = zoneMap.get(args.fromZoneId);
  const toZone = zoneMap.get(args.toZoneId);
  if (!fromZone || !toZone) {
    throw new Error("Start or destination zone not found");
  }

  const avoidSet = new Set(args.avoidZoneIds ?? []);

  const runDijkstra = (activeAvoidSet: Set<string>) => {
    const distances: Record<string, number> = {};
    const previous: Record<string, string | null> = {};
    const unvisited = new Set<string>();

    for (const z of zones) {
      distances[z._id] = Infinity;
      previous[z._id] = null;
      unvisited.add(z._id);
    }
    distances[args.fromZoneId] = 0;

    while (unvisited.size > 0) {
      let current: string | null = null;
      let smallestDist = Infinity;
      for (const node of unvisited) {
        if (distances[node] < smallestDist) {
          smallestDist = distances[node];
          current = node;
        }
      }

      if (current === null || smallestDist === Infinity) break;
      if (current === args.toZoneId) break;

      unvisited.delete(current);

      const currentZone = zoneMap.get(current);
      const outEdges = edges.filter(
        (e) => e.fromZoneId === current && e.isPassable && !activeAvoidSet.has(e.toZoneId),
      );

      for (const edge of outEdges) {
        const neighborZone = zoneMap.get(edge.toZoneId);
        if (!neighborZone) continue;

        const congestionFactor = Math.min(
          5,
          (currentZone ? currentZone.currentOccupancy / Math.max(1, edge.corridorCapacity) : 1) * 2,
        );
        const maxRisk = Math.max(currentZone?.riskScore ?? 0, neighborZone.riskScore);
        const riskPenalty = maxRisk > 70 ? 60 : maxRisk / 2;

        const edgeWeight = edge.baseWeight * (1 + congestionFactor) + riskPenalty;
        const alt = distances[current] + edgeWeight;

        if (alt < distances[edge.toZoneId]) {
          distances[edge.toZoneId] = alt;
          previous[edge.toZoneId] = current;
        }
      }
    }

    const path: string[] = [];
    let curr: string | null = args.toZoneId;
    if (distances[args.toZoneId] !== Infinity || args.fromZoneId === args.toZoneId) {
      while (curr) {
        path.unshift(curr);
        curr = previous[curr];
      }
    }

    return {
      path,
      totalWeight: distances[args.toZoneId],
      feasible: path.length > 0 && path[0] === args.fromZoneId,
    };
  };

  let result = runDijkstra(avoidSet);

  if (!result.feasible && avoidSet.size > 0) {
    result = runDijkstra(new Set());
  }

  const pathZoneIds = result.path as Array<Id<"zones">>;
  const pathNames = pathZoneIds.map((id) => zoneMap.get(id)?.name ?? "Zone");
  const estimatedTimeSeconds = Math.round(result.totalWeight > 0 && result.totalWeight < 10000 ? result.totalWeight : 120);

  await logAgentAction(
    ctx,
    args.eventId,
    "routing",
    "calculate_safe_route",
    `${fromZone.name} → ${toZone.name}`,
    `Route: ${pathNames.join(" → ")} (Est: ${Math.round(estimatedTimeSeconds / 60)} min)`,
    "action",
  );

  return {
    path: pathZoneIds,
    pathNames,
    totalWeight: result.totalWeight,
    estimatedTimeSeconds,
    feasible: result.feasible,
  };
}

/** Tool: Dijkstra calculation for safest path */
export const calculate_safe_route = internalMutation({
  args: {
    eventId: v.id("events"),
    fromZoneId: v.id("zones"),
    toZoneId: v.id("zones"),
    avoidZoneIds: v.optional(v.array(v.id("zones"))),
  },
  handler: async (ctx, args) => {
    return await executeCalculateSafeRoute(ctx, args);
  },
});

export async function executePublishRoute(
  ctx: MutationCtx,
  args: {
    eventId: Id<"events">;
    incidentId?: Id<"incidents">;
    affectedZoneId: Id<"zones">;
    routePath: string;
    instruction: string;
    isEvacuation: boolean;
  },
): Promise<Id<"routeRecommendations">> {
  const existing = await ctx.db
    .query("routeRecommendations")
    .withIndex("by_event_active", (q) =>
      q.eq("eventId", args.eventId).eq("isActive", true),
    )
    .filter((q) => q.eq(q.field("affectedZoneId"), args.affectedZoneId))
    .take(10);

  for (const rec of existing) {
    await ctx.db.patch("routeRecommendations", rec._id, { isActive: false });
  }

  const recId = await ctx.db.insert("routeRecommendations", {
    eventId: args.eventId,
    incidentId: args.incidentId,
    affectedZoneId: args.affectedZoneId,
    routePath: args.routePath,
    instruction: args.instruction,
    isEvacuation: args.isEvacuation,
    requiresApproval: args.isEvacuation,
    isActive: true,
    createdAt: Date.now(),
  });

  const affected = await ctx.db.get("zones", args.affectedZoneId);
  await logAgentAction(
    ctx,
    args.eventId,
    "routing",
    "publish_route_recommendation",
    `Zone ${affected?.name ?? "Zone"} recommendation`,
    args.instruction + (args.isEvacuation ? " [Requires Organizer Approval]" : ""),
    args.isEvacuation ? "warn" : "action",
    args.incidentId,
  );

  return recId;
}

/** Tool: Publish route recommendation */
export const publish_route_recommendation = internalMutation({
  args: {
    eventId: v.id("events"),
    incidentId: v.optional(v.id("incidents")),
    affectedZoneId: v.id("zones"),
    routePath: v.string(),
    instruction: v.string(),
    isEvacuation: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await executePublishRoute(ctx, args);
  },
});

/** Workflow step: Compute alternative routes */
export const computeAlternativeRoutes = internalMutation({
  args: {
    eventId: v.id("events"),
    incidentId: v.id("incidents"),
  },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) return null;

    const zones = await ctx.db
      .query("zones")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(50);

    if (zones.length === 0) return null;

    let affectedZone: Doc<"zones"> | null = null;
    let minDistance = Infinity;
    for (const z of zones) {
      const dist = Math.hypot(z.pinX - incident.pinX, z.pinY - incident.pinY);
      if (dist < minDistance) {
        minDistance = dist;
        affectedZone = z;
      }
    }

    if (!affectedZone) return null;

    const exitZones = zones.filter(
      (z) =>
        (z.zoneType === "exit" || z.zoneType === "gate" || z.zoneType === "open_area") &&
        z._id !== affectedZone?._id &&
        !z.exitBlocked &&
        z.riskScore < 60,
    );

    const destinationZone =
      exitZones.length > 0
        ? exitZones.reduce((prev, curr) => (curr.riskScore < prev.riskScore ? curr : prev))
        : zones.find((z) => z._id !== affectedZone?._id);

    if (!destinationZone) return null;

    const route = await executeCalculateSafeRoute(ctx, {
      eventId: args.eventId,
      fromZoneId: affectedZone._id,
      toZoneId: destinationZone._id,
      avoidZoneIds: [affectedZone._id],
    });

    if (route.feasible && route.path.length > 0) {
      const instruction = `Divert crowd from ${affectedZone.name} towards ${destinationZone.name} via ${route.pathNames.slice(1, -1).join(", ") || destinationZone.name}. Proceed steadily.`;
      const isEvacuation = incident.severity === "critical" || affectedZone.riskScore > 75;

      const recId = await executePublishRoute(ctx, {
        eventId: args.eventId,
        incidentId: incident._id,
        affectedZoneId: affectedZone._id,
        routePath: JSON.stringify(route.path),
        instruction,
        isEvacuation,
      });

      return { recId, instruction, route };
    }

    return null;
  },
});
