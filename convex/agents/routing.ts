import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { logAgentAction } from "../lib/agentLog";
import { calculateRoute, emptyReservations, graphFingerprint, pathCapacity, reservePath, ROUTE_UTILIZATION_CAP } from "../lib/routeGraph";

export async function loadGraph(ctx: MutationCtx | QueryCtx, eventId: Id<"events">, asOf?: number) {
  const zones = await ctx.db.query("zones").withIndex("by_event", q => q.eq("eventId", eventId)).take(101);
  const edges = await ctx.db.query("venueEdges").withIndex("by_event", q => q.eq("eventId", eventId)).take(401);
  if (zones.length > 100 || edges.length > 400) throw new Error("Venue exceeds the validated graph limit; operator review required.");
  return { zones: zones.map(zone => ({ ...zone, telemetryStale: !zone.telemetryAt || zone.telemetryStale !== false || (asOf !== undefined && asOf - zone.telemetryAt > 120_000) })), edges };
}
export const get_venue_graph = internalQuery({ args: { eventId: v.id("events") }, handler: async (ctx, { eventId }) => {
  const graph = await loadGraph(ctx, eventId);
  const adjacency: Record<string, Array<{ to: string; weight: number; passable: boolean }>> = {};
  for (const z of graph.zones) adjacency[z._id] = [];
  for (const e of graph.edges) adjacency[e.fromZoneId]?.push({ to: e.toZoneId, weight: e.currentWeight, passable: e.isPassable });
  return { ...graph, adjacency };
} });
export const check_exit_capacity = internalQuery({ args: { zoneId: v.id("zones") }, handler: async (ctx, { zoneId }) => {
  const zone = await ctx.db.get("zones", zoneId);
  if (!zone) throw new Error("Zone not found.");
  const active = await ctx.db.query("routeRecommendations").withIndex("by_event_active", q => q.eq("eventId", zone.eventId).eq("isActive", true)).take(101);
  if (active.length > 100) throw new Error("Too many active routes; operator review required.");
  let reservedPeople = 0;
  for (const route of active) {
    const path: unknown = JSON.parse(route.routePath);
    if (!Array.isArray(path)) throw new Error("Invalid active route reservation.");
    if (path.includes(zoneId)) reservedPeople += route.plannedPeople ?? 1;
  }
  const utilizationPercent = zone.capacity > 0 ? Math.round(zone.currentOccupancy / zone.capacity * 100) : 100;
  const availablePeople = Math.max(0, Math.floor(zone.capacity * ROUTE_UTILIZATION_CAP) - zone.currentOccupancy - reservedPeople);
  const approvedDestination = zone.zoneType === "exit" || zone.isAssemblyPoint === true || zone.isDesignatedEgress === true;
  return { hasCapacity: approvedDestination && availablePeople > 0 && !zone.exitBlocked && Boolean(zone.telemetryAt) && zone.telemetryStale === false, approvedDestination, utilizationPercent, reservedPeople, exitBlocked: zone.exitBlocked, availablePeople };
} });
export async function loadRouteReservations(ctx: MutationCtx, eventId: Id<"events">, edges: Awaited<ReturnType<typeof loadGraph>>["edges"], excludeId?: Id<"routeRecommendations">) {
  const rows = await ctx.db.query("routeRecommendations").withIndex("by_event_active", q => q.eq("eventId", eventId).eq("isActive", true)).take(101);
  if (rows.length > 100) throw new Error("Too many active routes; operator review required.");
  const reservations = emptyReservations();
  for (const row of rows) {
    if (row._id === excludeId || (row.expiresAt && row.expiresAt <= Date.now())) continue;
    const path: unknown = JSON.parse(row.routePath);
    if (!Array.isArray(path) || path.some(id => typeof id !== "string")) throw new Error("Invalid active route reservation.");
    reservePath(path, row.plannedPeople ?? 1, edges, reservations);
  }
  return reservations;
}
export async function executeCalculateSafeRoute(ctx: MutationCtx, args: { eventId: Id<"events">; fromZoneId: Id<"zones">; toZoneId: Id<"zones">; avoidZoneIds?: Id<"zones">[] }) {
  const graph = await loadGraph(ctx, args.eventId, Date.now());
  const route = calculateRoute(graph.zones, graph.edges, args.fromZoneId, args.toZoneId, args.avoidZoneIds);
  return { ...route, path: route.path as Id<"zones">[], pathNames: route.path.map(id => graph.zones.find(z => z._id === id)?.name ?? "Zone") };
}
export const calculate_safe_route = internalMutation({ args: { eventId: v.id("events"), fromZoneId: v.id("zones"), toZoneId: v.id("zones"), avoidZoneIds: v.optional(v.array(v.id("zones"))) }, handler: executeCalculateSafeRoute });
export async function executePublishRoute(ctx: MutationCtx, args: { eventId: Id<"events">; incidentId?: Id<"incidents">; affectedZoneId: Id<"zones">; routePath: string; instruction: string; isEvacuation: boolean; plannedPeople?: number; replaceExisting?: boolean }) {
  const graph = await loadGraph(ctx, args.eventId, Date.now());
  const ids: unknown = JSON.parse(args.routePath);
  if (!Array.isArray(ids) || ids.length < 2 || ids.some(id => typeof id !== "string") || ids[0] !== args.affectedZoneId) throw new Error("Invalid route path.");
  const destination = graph.zones.find(z => z._id === ids[ids.length - 1]);
  if (!destination || (destination.zoneType !== "exit" && !destination.isAssemblyPoint && !destination.isDesignatedEgress)) throw new Error("Destination is not an approved egress or assembly point.");
  const existing = await ctx.db.query("routeRecommendations").withIndex("by_event_active", q => q.eq("eventId", args.eventId).eq("isActive", true)).take(101);
  if (existing.length > 100) throw new Error("Too many active routes; operator review required.");
  if (args.replaceExisting !== false) for (const rec of existing.filter(r => r.affectedZoneId === args.affectedZoneId)) await ctx.db.patch("routeRecommendations", rec._id, { isActive: false });
  const plannedPeople = args.plannedPeople ?? 1;
  const reservations = await loadRouteReservations(ctx, args.eventId, graph.edges);
  if (pathCapacity(ids, graph.zones, graph.edges, reservations) < plannedPeople) throw new Error("Route wave exceeds destination or corridor capacity.");
  const route = calculateRoute(graph.zones, graph.edges, ids[0], ids[ids.length - 1], [], plannedPeople, reservations);
  if (!route.feasible || route.path.join() !== ids.join()) throw new Error("Route is no longer valid.");
  const now = Date.now();
  const { replaceExisting: _replaceExisting, ...stored } = args;
  const recId = await ctx.db.insert("routeRecommendations", { ...stored, plannedPeople, requiresApproval: true, isActive: true, createdAt: now, expiresAt: now + 120_000, graphFingerprint: graphFingerprint(graph.zones,graph.edges) });
  await ctx.scheduler.runAfter(120_000, internal.agents.routing.expireRoute, { recommendationId: recId });
  await logAgentAction(ctx, args.eventId, "routing", "publish_route_recommendation", "Route proposed", "Awaiting staff approval; expires after two minutes or a graph change.", "info", args.incidentId);
  return recId;
}
export const publish_route_recommendation = internalMutation({ args: { eventId: v.id("events"), incidentId: v.optional(v.id("incidents")), affectedZoneId: v.id("zones"), routePath: v.string(), instruction: v.string(), isEvacuation: v.boolean(), plannedPeople: v.optional(v.number()) }, handler: executePublishRoute });
export const expireRoute = internalMutation({ args: { recommendationId: v.id("routeRecommendations") }, handler: async (ctx, { recommendationId }) => {
  const row = await ctx.db.get("routeRecommendations", recommendationId);
  if (row && row.expiresAt && row.expiresAt <= Date.now()) await ctx.db.patch("routeRecommendations", row._id, { isActive: false });
} });
export const computeAlternativeRoutes = internalMutation({ args: { eventId: v.id("events"), incidentId: v.id("incidents") }, handler: async (ctx, args) => {
  const incident = await ctx.db.get("incidents", args.incidentId);
  if (!incident || incident.eventId !== args.eventId || incident.isResolved) return null;
  const { zones, edges } = await loadGraph(ctx, args.eventId, Date.now());
  const affected = [...zones].sort((a,b) => Math.hypot(a.pinX-incident.pinX,a.pinY-incident.pinY) - Math.hypot(b.pinX-incident.pinX,b.pinY-incident.pinY))[0];
  if (!affected) return null;
  const old = await ctx.db.query("routeRecommendations").withIndex("by_event_active", q => q.eq("eventId", args.eventId).eq("isActive", true)).take(101);
  if (old.length > 100) throw new Error("Too many active routes; operator review required.");
  for (const row of old.filter(r => r.affectedZoneId === affected._id)) await ctx.db.patch("routeRecommendations", row._id, { isActive: false });
  const reservations = await loadRouteReservations(ctx, args.eventId, edges);
  const candidates = zones.filter(z => z._id !== affected._id && (z.zoneType === "exit" || z.isAssemblyPoint || z.isDesignatedEgress) && !z.exitBlocked && !z.telemetryStale && z.riskScore < 60);
  let remaining = Math.max(0, Math.floor(affected.currentOccupancy));
  const plans: Array<{ recId: Id<"routeRecommendations">; destinationId: Id<"zones">; plannedPeople: number; instruction: string; route: ReturnType<typeof calculateRoute> & { pathNames: string[] } }> = [];
  for (let i = 0; i < candidates.length && remaining > 0; i++) {
    const routes = candidates.filter(z => !plans.some(p => p.destinationId === z._id)).map(z => ({ z, route: calculateRoute(zones, edges, affected._id, z._id, [], 1, reservations) })).filter(x => x.route.feasible).sort((a,b) => a.route.totalWeight - b.route.totalWeight);
    const best = routes[0];
    if (!best) break;
    const plannedPeople = Math.min(remaining, pathCapacity(best.route.path, zones, edges, reservations));
    if (plannedPeople < 1) break;
    const pathNames = best.route.path.map(id => zones.find(z => z._id === id)!.name);
    const instruction = `Guide up to ${plannedPeople} people via ${pathNames.join(" → ")}. Await control-room approval; follow staff instructions.`;
    const recId = await executePublishRoute(ctx, { ...args, affectedZoneId: affected._id, routePath: JSON.stringify(best.route.path), instruction, isEvacuation: incident.severity === "critical" || affected.riskScore > 75, plannedPeople, replaceExisting: false });
    reservePath(best.route.path, plannedPeople, edges, reservations);
    plans.push({ recId, destinationId: best.z._id, plannedPeople, instruction, route: { ...best.route, pathNames } });
    remaining -= plannedPeople;
  }
  if (remaining > 0) await logAgentAction(ctx, args.eventId, "routing", "capacity_hold", incident.incidentCode, `${remaining} people have no validated route in this guidance wave. Hold for supervised phased movement; reassess telemetry before another wave.`, "warn", incident._id);
  return { plans, remaining };
} });
