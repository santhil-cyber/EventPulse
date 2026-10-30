import { v } from "convex/values";
import { mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireRole } from "./lib/authz";
import { logAgentAction } from "./lib/agentLog";

export const configureEgress = mutation({ args: { zoneId: v.id("zones"), isDesignatedEgress: v.boolean() }, handler: async (ctx, args) => {
  const zone = await ctx.db.get("zones", args.zoneId);
  if (!zone) throw new Error("Zone not found.");
  await requireRole(ctx, zone.eventId, ["ORGANIZER"]);
  if (args.isDesignatedEgress && zone.zoneType !== "gate" && zone.zoneType !== "exit" && !zone.isAssemblyPoint) throw new Error("Only a gate, exit or assembly point may be designated as egress.");
  await ctx.db.patch("zones", zone._id, { isDesignatedEgress: args.isDesignatedEgress, updatedAt: Date.now() });
  const routes = await ctx.db.query("routeRecommendations").withIndex("by_event_active", q => q.eq("eventId", zone.eventId).eq("isActive", true)).take(100);
  for (const route of routes) await ctx.db.patch("routeRecommendations", route._id, { isActive: false });
  await logAgentAction(ctx, zone.eventId, "routing", "configure_egress", zone.name, args.isDesignatedEgress ? "Organizer designated this point as an approved egress." : "Organizer removed egress designation; active routes invalidated.", "action");
} });

export const updateZone = mutation({
  args: { zoneId: v.id("zones"), currentOccupancy: v.number(), inflowRate: v.number(), outflowRate: v.number(), exitBlocked: v.boolean() },
  handler: async (ctx, args) => {
    const zone = await ctx.db.get("zones", args.zoneId);
    if (!zone) throw new Error("Zone not found.");
    await requireRole(ctx, zone.eventId, ["ORGANIZER", "STAFF"]);
    for (const value of [args.currentOccupancy,args.inflowRate,args.outflowRate]) if (!Number.isFinite(value) || value < 0 || value > 1_000_000) throw new Error("Invalid telemetry value.");
    const { zoneId, ...values } = args;
    const now = Date.now();
    await ctx.db.patch("zones", zoneId, { ...values, telemetryAt: now, telemetrySource: "manual", telemetryStale: false, updatedAt: now });
    const routes = await ctx.db.query("routeRecommendations").withIndex("by_event_active", q => q.eq("eventId", zone.eventId).eq("isActive", true)).take(100);
    for (const route of routes) await ctx.db.patch("routeRecommendations", route._id, { isActive: false });
    await ctx.scheduler.runAfter(0, internal.agents.crowdIntel.assessAllZones, { eventId: zone.eventId });
    const incidents = await ctx.db.query("incidents").withIndex("by_event_created", q => q.eq("eventId", zone.eventId)).order("desc").filter(q => q.eq(q.field("isResolved"), false)).take(20);
    for (const incident of incidents) await ctx.scheduler.runAfter(0, internal.orchestrator.runCrowdIntel, { incidentId: incident._id });
    await ctx.scheduler.runAfter(120_000, internal.telemetry.expire, { zoneId, telemetryAt: now });
  },
});
export const expire = internalMutation({ args: { zoneId: v.id("zones"), telemetryAt: v.number() }, handler: async (ctx, { zoneId, telemetryAt }) => {
  const zone = await ctx.db.get("zones", zoneId);
  if (!zone || zone.telemetryAt !== telemetryAt) return;
  await ctx.db.patch("zones", zoneId, { telemetryStale: true, updatedAt: Date.now() });
  const routes = await ctx.db.query("routeRecommendations").withIndex("by_event_active", q => q.eq("eventId", zone.eventId).eq("isActive", true)).take(100);
  for (const route of routes) await ctx.db.patch("routeRecommendations", route._id, { isActive: false });
} });
