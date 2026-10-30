import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { logAgentAction } from "../lib/agentLog";
import { canDispatchEmergencyService } from "../lib/safety";
import { ACTIVE_TASKS, INITIAL_SEARCH_RADIUS_METERS, qualifiedResponder, rankResponders, responderDistance, responderEta } from "../lib/dispatchPolicy";
import { responderTypeValidator } from "../schema";

/** Tool: Find available responders ranked by proximity and skill match */
export const find_available_responders = internalQuery({
  args: {
    eventId: v.id("events"),
    incidentId: v.id("incidents"),
    requiredType: v.optional(responderTypeValidator),
  },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident || incident.eventId !== args.eventId) throw new Error("Incident event mismatch");

    const allResponders = await ctx.db
      .query("responders")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(100);

    const scored: Array<{
      responderId: Id<"responders">;
      userId: Id<"users">;
      name: string;
      responderType: string;
      isAvailable: boolean;
      distanceMeters: number;
      etaSeconds: number;
      score: number;
    }> = [];

    const valid = [];
    for (const r of allResponders) {
      const member = await ctx.db.get("memberships", r.membershipId);
      if (member && member.eventId === incident.eventId && member.userId === r.userId && !member.isBanned && member.role !== "ATTENDEE" && (!args.requiredType || r.responderType === args.requiredType)) valid.push(r);
    }
    const recentTasks = await ctx.db.query("dispatchTasks").withIndex("by_event", q => q.eq("eventId", incident.eventId)).order("desc").take(100);
    const workload: Record<string, number> = {};
    for (const task of recentTasks) workload[task.responderId] = (workload[task.responderId] ?? 0) + 1;
    const ranked = rankResponders(valid, incident, workload);
    for (const r of ranked) {
      const distanceMeters = responderDistance(r, incident);
      const etaSeconds = responderEta(distanceMeters);
      scored.push({
        responderId: r._id,
        userId: r.userId,
        name: r.name ?? r.responderType,
        responderType: r.responderType,
        isAvailable: r.isAvailable,
        distanceMeters,
        etaSeconds,
        score: ranked.length - scored.length,
      });
    }
    return scored;
  },
});

/** Tool: Calculate ETA and walking route */
export const calculate_responder_eta = internalQuery({
  args: {
    responderId: v.id("responders"),
    incidentId: v.id("incidents"),
  },
  handler: async (ctx, args) => {
    const responder = await ctx.db.get("responders", args.responderId);
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!responder || !incident) throw new Error("Responder or Incident not found");

    if (responder.eventId !== incident.eventId) throw new Error("Responder and incident event mismatch.");
    const distanceMeters = responderDistance(responder, incident);
    const etaSeconds = responderEta(distanceMeters);

    return {
      etaSeconds,
      distanceMeters,
      routeDescription: `Straight-line map estimate: approximately ${distanceMeters}m (${Math.ceil(etaSeconds / 60)} min). Confirm the passable staff-access route on site.`,
    };
  },
});

export async function executeAssignResponder(ctx: MutationCtx, args: {
  responderId: Id<"responders">; incidentId: Id<"incidents">; instruction?: string;
  purpose?: "verification" | "response"; escalationCount?: number;
}): Promise<Id<"dispatchTasks">> {
  const responder = await ctx.db.get("responders", args.responderId);
  const incident = await ctx.db.get("incidents", args.incidentId);
  if (!responder || !incident || responder.eventId !== incident.eventId) throw new Error("Responder or incident event mismatch.");
  if (incident.isResolved) throw new Error("Incident is resolved.");
  const purpose = args.purpose ?? "response";
  if (purpose === "response" && incident.verificationStatus !== "VERIFIED") throw new Error("Response requires verified evidence; request staff verification instead.");
  const existing = await ctx.db.query("dispatchTasks").withIndex("by_incident", q => q.eq("incidentId", incident._id)).take(101);
  if (existing.length > 100) throw new Error("Task history limit reached; operator review required.");
  const active = existing.find(t => !t.isEmergencyDispatch && ACTIVE_TASKS.has(t.status) && (t.purpose ?? "response") === purpose);
  if (active) return active._id;
  if (!responder.isAvailable || responder.currentTaskId || responder.assignmentZoneId) throw new Error("Responder is already assigned.");
  const member = await ctx.db.get("memberships", responder.membershipId);
  if (!member || member.eventId !== incident.eventId || member.userId !== responder.userId || member.isBanned || member.role === "ATTENDEE") throw new Error("Responder is not authorized for this event.");
  if (purpose === "response" && !qualifiedResponder(responder, incident.incidentType)) throw new Error("Responder does not have the required capability.");
  const distanceMeters = responderDistance(responder, incident);
  const taskId = await ctx.db.insert("dispatchTasks", { eventId: incident.eventId, incidentId: incident._id, responderId: responder._id,
    instruction: (args.instruction ?? `Respond to ${incident.incidentType} at ${incident.location} (${incident.incidentCode}).`).slice(0, 1500),
    status: "pending", estimatedEta: responderEta(distanceMeters), distanceMeters,
    assignedAt: Date.now(), isEmergencyDispatch: false, purpose, escalationCount: args.escalationCount ?? 0 });
  await ctx.db.patch("responders", responder._id, { isAvailable: false, currentTaskId: taskId, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(180_000, internal.agents.dispatch.checkTaskAcceptance, { taskId });
  await logAgentAction(ctx, incident.eventId, "dispatch", "assign_and_notify_responder", `${incident.incidentCode}: ${purpose}`, `Task assigned in app; ${distanceMeters}m away (${distanceMeters > INITIAL_SEARCH_RADIUS_METERS ? "expanded search" : "initial 100m search"}). Waiting for acknowledgment; ETA is an estimate.`, "action", incident._id);
  return taskId;
}
export const assign_and_notify_responder = internalMutation({
  args: { responderId: v.id("responders"), incidentId: v.id("incidents"), instruction: v.optional(v.string()) }, handler: executeAssignResponder,
});
export async function executeEscalateTask(ctx: MutationCtx, taskId: Id<"dispatchTasks">): Promise<Id<"dispatchTasks"> | null> {
  const task = await ctx.db.get("dispatchTasks", taskId);
  if (!task || (task.status !== "pending" && task.status !== "rejected") || task.isEmergencyDispatch) return null;
  if (task.escalatedToTaskId) return task.escalatedToTaskId;
  const incident = await ctx.db.get("incidents", task.incidentId);
  const original = await ctx.db.get("responders", task.responderId);
  if (original?.currentTaskId === task._id) await ctx.db.patch("responders", original._id, { isAvailable: true, currentTaskId: undefined, updatedAt: Date.now() });
  if (task.status === "pending") await ctx.db.patch("dispatchTasks", task._id, { status: incident?.isResolved ? "canceled" : "escalated", completedAt: Date.now() });
  if (!incident || incident.isResolved) return null;
  const count = task.escalationCount ?? 0;
  const purpose = task.purpose ?? "response";
  const responders = count < 2 ? await ctx.db.query("responders").withIndex("by_event_available", q => q.eq("eventId", task.eventId).eq("isAvailable", true)).take(100) : [];
  const available = [];
  for (const responder of responders) {
    if (responder._id === task.responderId || responder.currentTaskId || (purpose === "response" && !qualifiedResponder(responder, incident.incidentType))) continue;
    const member = await ctx.db.get("memberships", responder.membershipId);
    if (member && member.eventId === incident.eventId && member.userId === responder.userId && !member.isBanned && member.role !== "ATTENDEE") available.push(responder);
  }
  const recentTasks = await ctx.db.query("dispatchTasks").withIndex("by_event", q => q.eq("eventId", incident.eventId)).order("desc").take(100);
  const workload: Record<string, number> = {};
  for (const item of recentTasks) workload[item.responderId] = (workload[item.responderId] ?? 0) + 1;
  const ranked = rankResponders(available, incident, workload, purpose === "response");
  if (ranked[0]) {
    const next = await executeAssignResponder(ctx, { responderId: ranked[0]._id, incidentId: incident._id, purpose, instruction: `[ESCALATED] ${task.instruction}`, escalationCount: count + 1 });
    await ctx.db.patch("dispatchTasks", task._id, { escalatedToTaskId: next });
    return next;
  }
  await logAgentAction(ctx, incident.eventId, "dispatch", "escalation_requires_operator", incident.incidentCode, "No qualified replacement or escalation limit reached. Contact event control manually.", "error", incident._id);
  if (purpose === "verification") await ctx.db.patch("incidents", incident._id, { staffVerificationRequested: false, updatedAt: Date.now() });
  return null;
}
export const escalate_unaccepted_task = internalMutation({ args: { taskId: v.id("dispatchTasks") }, handler: async (ctx, { taskId }) => executeEscalateTask(ctx, taskId) });
export const checkTaskAcceptance = internalMutation({ args: { taskId: v.id("dispatchTasks") }, handler: async (ctx, { taskId }) => executeEscalateTask(ctx, taskId) });
export const checkArrival = internalMutation({ args: { taskId: v.id("dispatchTasks") }, handler: async (ctx, { taskId }) => {
  const task = await ctx.db.get("dispatchTasks", taskId);
  if (!task || (task.status !== "accepted" && task.status !== "en_route")) return;
  const incident = await ctx.db.get("incidents", task.incidentId);
  if (!incident || incident.isResolved) return;
  await logAgentAction(ctx, task.eventId, "dispatch", "arrival_overdue", incident.incidentCode, "Responder has not marked on scene by the review deadline. Control room must confirm location or reassign.", "warn", incident._id);
} });
export async function executeEmergencyDispatch(ctx: MutationCtx, incidentId: Id<"incidents">, service: "ambulance" | "fire_brigade" | "police") {
  const incident = await ctx.db.get("incidents", incidentId);
  if (!incident || incident.isResolved) return { success: false, reason: "No active incident.", simulated: false };
  const check = canDispatchEmergencyService(incident.verificationStatus);
  await logAgentAction(ctx, incident.eventId, "safety", "external_dispatch_held", `${incident.incidentCode}: ${service}`, check.allowed ? "External delivery is not configured. Operator must contact emergency services through the venue procedure." : check.reason, "warn", incidentId);
  return { success: false, reason: check.allowed ? "External dispatch is not configured; no emergency service was contacted." : check.reason, simulated: false };
}
export const request_emergency_dispatch = internalMutation({
  args: { incidentId: v.id("incidents"), service: v.union(v.literal("ambulance"), v.literal("fire_brigade"), v.literal("police")) }, handler: async (ctx, args) => executeEmergencyDispatch(ctx, args.incidentId, args.service),
});
export const dispatchResponders = internalMutation({
  args: { incidentId: v.id("incidents"), allowEmergencyServices: v.boolean() }, handler: async (ctx, args): Promise<Id<"dispatchTasks"> | null> => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident || incident.isResolved || incident.verificationStatus !== "VERIFIED") return null;
    const tasks = await ctx.db.query("dispatchTasks").withIndex("by_incident", q => q.eq("incidentId", incident._id)).take(101);
    if (tasks.length > 100) return null;
    const existing = tasks.find(t => !t.isEmergencyDispatch && ACTIVE_TASKS.has(t.status) && (t.purpose ?? "response") === "response");
    if (existing) return existing._id;
    // Completed responses do not silently create a new assignment on evidence updates.
    if (tasks.some(t => (t.purpose ?? "response") === "response" && t.status === "completed")) return null;
    const responders = await ctx.db.query("responders").withIndex("by_event_available", q => q.eq("eventId", incident.eventId).eq("isAvailable", true)).take(100);
    const eligible = [];
    for (const r of responders) {
      const member = await ctx.db.get("memberships", r.membershipId);
      if (!r.currentTaskId && qualifiedResponder(r, incident.incidentType) && member && member.userId === r.userId && member.eventId === incident.eventId && !member.isBanned && member.role !== "ATTENDEE") eligible.push(r);
    }
    const recentTasks = await ctx.db.query("dispatchTasks").withIndex("by_event", q => q.eq("eventId", incident.eventId)).order("desc").take(100);
    const workload: Record<string, number> = {};
    for (const task of recentTasks) workload[task.responderId] = (workload[task.responderId] ?? 0) + 1;
    const ranked = rankResponders(eligible, incident, workload);
    const taskId = ranked[0] ? await executeAssignResponder(ctx, { responderId: ranked[0]._id, incidentId: incident._id }) : null;
    if (!taskId) await logAgentAction(ctx, incident.eventId, "dispatch", "no_qualified_responder", incident.incidentCode, "No qualified available responder. Operator intervention required.", "warn", incident._id);
    if (args.allowEmergencyServices) {
      const service = incident.incidentType === "fire" ? "fire_brigade" : incident.incidentType === "security" ? "police" : "ambulance";
      await executeEmergencyDispatch(ctx, incident._id, service);
    }
    return taskId;
  },
});
