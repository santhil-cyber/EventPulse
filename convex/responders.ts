import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query, internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireRole } from "./lib/authz";
import { responderTypeValidator } from "./schema";
import { logAgentAction } from "./lib/agentLog";

export const eligibleMembers = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireRole(ctx, eventId, ["ORGANIZER"]);
    const members = [
      ...await ctx.db.query("memberships").withIndex("by_event_role", q => q.eq("eventId", eventId).eq("role", "STAFF")).take(200),
      ...await ctx.db.query("memberships").withIndex("by_event_role", q => q.eq("eventId", eventId).eq("role", "ORGANIZER")).take(50),
    ];
    const roster = await ctx.db.query("responders").withIndex("by_event", q => q.eq("eventId", eventId)).take(101);
    const registered = new Set(roster.map(r => r.userId));
    const result = [];
    for (const member of members) {
      if (member.isBanned || member.role === "ATTENDEE" || registered.has(member.userId)) continue;
      const user = await ctx.db.get("users", member.userId);
      if (user) result.push({ membershipId: member._id, name: user.name ?? user.email ?? `Event ${member.role.toLowerCase()} (${member._id.slice(-6)})`, role: member.role });
    }
    return result;
  },
});

/**
 * Whether this caller's phone should ring for new incidents. Only STAFF
 * memberships ring; organizers watch the Command view instead. A staff member
 * the organizer marked off duty (unavailable with no task or zone post) is
 * muted. Staff without a responder profile are on duty by default.
 */
export const myAlertStatus = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const member = await requireRole(ctx, eventId, ["ORGANIZER", "STAFF", "ATTENDEE"]);
    if (member.role !== "STAFF") return { ring: false, reason: "not_staff" as const };
    const event = await ctx.db.get("events", eventId);
    if (!event?.isActive) return { ring: false, reason: "event_inactive" as const };
    const responder = await ctx.db.query("responders").withIndex("by_user_event", q => q.eq("userId", member.userId).eq("eventId", eventId)).first();
    const offDuty = responder !== null && !responder.isAvailable && !responder.currentTaskId && !responder.assignmentZoneId;
    if (offDuty) return { ring: false, reason: "off_duty" as const };
    return { ring: true, reason: "on_duty" as const };
  },
});

export async function scheduleDispatchReview(ctx: MutationCtx, eventId: Id<"events">) {
  await ctx.scheduler.runAfter(0, internal.responders.reviewWaiting, { eventId });
  await ctx.scheduler.runAfter(0, internal.agents.crowdIntel.assessAllZones, { eventId });
}

export const register = mutation({
  args: { eventId: v.id("events"), membershipId: v.optional(v.id("memberships")), name: v.string(), responderType: responderTypeValidator, hasFirstAid: v.boolean(), hasFireTraining: v.boolean(), isAvailable: v.boolean() },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.eventId, ["ORGANIZER"]);
    const event = await ctx.db.get("events", args.eventId);
    if (!event?.isActive) throw new Error("The event is not active.");
    const name = args.name.trim();
    if (!name || name.length > 100) throw new Error("Enter a responder name of 1–100 characters.");
    let member = args.membershipId ? await ctx.db.get("memberships", args.membershipId) : null;
    if (args.membershipId && !member) throw new Error("Selected staff membership was not found.");
    if (!args.membershipId) {
      const now = Date.now();
      const demoUserId = await ctx.db.insert("users", { name: `[Demo staff] ${name}` });
      const demoMembershipId = await ctx.db.insert("memberships", { eventId: args.eventId, userId: demoUserId, role: "STAFF", isBanned: false, trustScore: 100, joinedAt: now, lastOpenedAt: now });
      member = await ctx.db.get("memberships", demoMembershipId);
    }
    if (!member || member.eventId !== args.eventId || member.isBanned || member.role === "ATTENDEE") throw new Error("Select a current staff or organizer membership for this event.");
    const existing = await ctx.db.query("responders").withIndex("by_user_event", q => q.eq("userId", member.userId).eq("eventId", args.eventId)).first();
    if (existing) throw new Error("This member already has a responder profile.");
    const rows = await ctx.db.query("responders").withIndex("by_event", q => q.eq("eventId", args.eventId)).take(100);
    if (rows.length >= 100) throw new Error("The event responder limit is 100.");
    const id = await ctx.db.insert("responders", { eventId: args.eventId, userId: member.userId, membershipId: member._id, name, responderType: args.responderType, hasFirstAid: args.hasFirstAid, hasFireTraining: args.hasFireTraining, isAvailable: args.isAvailable, updatedAt: Date.now() });
    await logAgentAction(ctx, args.eventId, "dispatch", "register_responder", name, `${args.membershipId ? "Organizer recorded" : "Demo staff profile created and recorded"} ${args.responderType} capability; ${args.isAvailable ? "available for assignment" : "off duty"}.` , "info");
    if (args.isAvailable) await scheduleDispatchReview(ctx, args.eventId);
    return id;
  },
});

export const setAvailability = mutation({
  args: { responderId: v.id("responders"), isAvailable: v.boolean() },
  handler: async (ctx, { responderId, isAvailable }) => {
    const responder = await ctx.db.get("responders", responderId);
    if (!responder) throw new Error("Responder not found.");
    await requireRole(ctx, responder.eventId, ["ORGANIZER"]);
    const event = await ctx.db.get("events", responder.eventId);
    if (!event?.isActive) throw new Error("The event is not active.");
    const member = await ctx.db.get("memberships", responder.membershipId);
    if (!member || member.userId !== responder.userId || member.eventId !== responder.eventId || member.isBanned || member.role === "ATTENDEE") throw new Error("Responder must have an eligible staff membership.");
    if (responder.currentTaskId) throw new Error("Complete or cancel the current task before changing availability.");
    if (responder.assignmentZoneId) throw new Error("Responder is automatically assigned to a zone; wait for risk coverage to be released.");
    await ctx.db.patch("responders", responderId, { isAvailable, updatedAt: Date.now() });
    await logAgentAction(ctx, responder.eventId, "dispatch", "responder_availability", responder.name ?? responderId, isAvailable ? "Available for assignment." : "Marked off duty.", "info");
    if (isAvailable) await scheduleDispatchReview(ctx, responder.eventId);
  },
});

export const retryWaiting = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireRole(ctx, eventId, ["ORGANIZER", "STAFF"]);
    await scheduleDispatchReview(ctx, eventId);
  },
});

export const reviewWaiting = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get("events", eventId);
    if (!event?.isActive) return;
    // Bounded review. Assignment itself checks eligibility and active/completed tasks.
    const recent = await ctx.db.query("incidents").withIndex("by_event_created", q => q.eq("eventId", eventId)).order("desc").take(50);
    const priority = { critical: 0, high: 1, medium: 2, low: 3 };
    const waiting = recent.filter(i => !i.isResolved && i.verificationStatus === "VERIFIED").sort((a, b) => priority[a.severity] - priority[b.severity] || a.createdAt - b.createdAt);
    for (const incident of waiting) await ctx.scheduler.runAfter(0, internal.orchestrator.runResponsePlanning, { incidentId: incident._id });
    for (const incident of recent) if (!incident.isResolved && incident.verificationStatus === "UNVERIFIED" && !incident.staffVerificationRequested && (incident.severity === "high" || incident.severity === "critical")) await ctx.scheduler.runAfter(0, internal.agents.verification.request_staff_verification, { eventId, incidentId: incident._id });
  },
});
