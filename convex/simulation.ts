import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { logAgentAction } from "./lib/agentLog";
import { requireRole } from "./lib/authz";

export async function executeSeedZones(ctx: MutationCtx, eventId: Id<"events">): Promise<boolean> {
  const existingZones = await ctx.db
    .query("zones")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .take(1);

  if (existingZones.length > 0) {
    return true;
  }

  const ZONES_DATA = [
    { name: "Gate 1", pinX: 18, pinY: 28, capacity: 500, type: "gate" as const, isNarrow: false },
    { name: "Gate 2", pinX: 32, pinY: 24, capacity: 300, type: "gate" as const, isNarrow: true },
    { name: "Gate 3", pinX: 65, pinY: 45, capacity: 600, type: "gate" as const, isNarrow: false },
    { name: "Gate 4", pinX: 85, pinY: 40, capacity: 400, type: "gate" as const, isNarrow: false },
    { name: "Main Stage", pinX: 50, pinY: 60, capacity: 2000, type: "stage" as const, isNarrow: false },
    { name: "Corridor A", pinX: 40, pinY: 35, capacity: 150, type: "corridor" as const, isNarrow: true },
    { name: "Corridor B", pinX: 75, pinY: 42, capacity: 200, type: "corridor" as const, isNarrow: false },
    { name: "Medical Post", pinX: 55, pinY: 30, capacity: 50, type: "medical_post" as const, isNarrow: false },
    { name: "Food Court", pinX: 60, pinY: 55, capacity: 800, type: "open_area" as const, isNarrow: false },
    { name: "Exit North", pinX: 50, pinY: 10, capacity: 400, type: "exit" as const, isNarrow: false },
    { name: "Exit South", pinX: 50, pinY: 90, capacity: 300, type: "exit" as const, isNarrow: true },
    { name: "Parking Area", pinX: 20, pinY: 80, capacity: 1000, type: "open_area" as const, isNarrow: false },
  ];

  const zoneIds: Record<string, Id<"zones">> = {};

  for (const zone of ZONES_DATA) {
    const id = await ctx.db.insert("zones", {
      eventId,
      name: zone.name,
      pinX: zone.pinX,
      pinY: zone.pinY,
      capacity: zone.capacity,
      currentOccupancy: Math.floor(zone.capacity * 0.25),
      inflowRate: 10,
      outflowRate: 8,
      riskScore: 15,
      zoneType: zone.type,
      exitBlocked: false,
      isNarrowPassage: zone.isNarrow,
      updatedAt: Date.now(),
    });
    zoneIds[zone.name] = id;
  }

  const EDGES: Array<[string, string, number]> = [
    ["Gate 1", "Corridor A", 60],
    ["Gate 2", "Corridor A", 45],
    ["Corridor A", "Main Stage", 90],
    ["Gate 3", "Corridor B", 50],
    ["Corridor B", "Gate 4", 55],
    ["Corridor B", "Food Court", 40],
    ["Main Stage", "Food Court", 70],
    ["Main Stage", "Medical Post", 80],
    ["Gate 3", "Food Court", 65],
    ["Food Court", "Exit South", 100],
    ["Medical Post", "Exit North", 90],
    ["Gate 1", "Parking Area", 120],
    ["Parking Area", "Exit South", 110],
  ];

  for (const [from, to, weight] of EDGES) {
    const fromId = zoneIds[from];
    const toId = zoneIds[to];
    if (!fromId || !toId) continue;

    await ctx.db.insert("venueEdges", {
      eventId,
      fromZoneId: fromId,
      toZoneId: toId,
      baseWeight: weight,
      currentWeight: weight,
      corridorCapacity: 200,
      isPassable: true,
      updatedAt: Date.now(),
    });

    await ctx.db.insert("venueEdges", {
      eventId,
      fromZoneId: toId,
      toZoneId: fromId,
      baseWeight: weight,
      currentWeight: weight,
      corridorCapacity: 200,
      isPassable: true,
      updatedAt: Date.now(),
    });
  }

  return true;
}

/** Seed the venue zones and network graph for an event */
export const seedVenueZones = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    return await executeSeedZones(ctx, args.eventId);
  },
});

export async function executeSeedResponders(ctx: MutationCtx, eventId: Id<"events">): Promise<boolean> {
  const existing = await ctx.db
    .query("responders")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .take(1);

  if (existing.length > 0) return true;

  const members = await ctx.db
    .query("memberships")
    .withIndex("by_event_role", (q) => q.eq("eventId", eventId))
    .take(10);

  const fallbackUserId = members[0]?.userId;
  const fallbackMembershipId = members[0]?._id;
  if (!fallbackUserId || !fallbackMembershipId) return false;

  const ROSTER = [
    {
      name: "Officer Ravi Kumar",
      type: "security" as const,
      posX: 70,
      posY: 48,
      firstAid: true,
      fire: false,
    },
    {
      name: "Dr. Priya Sharma",
      type: "medical" as const,
      posX: 56,
      posY: 32,
      firstAid: true,
      fire: false,
    },
    {
      name: "Captain Arjun Singh",
      type: "fire" as const,
      posX: 22,
      posY: 62,
      firstAid: false,
      fire: true,
    },
    {
      name: "Sunita Patel (Lead Marshal)",
      type: "volunteer" as const,
      posX: 62,
      posY: 42,
      firstAid: true,
      fire: false,
    },
    {
      name: "Vikram Das (Rapid Response)",
      type: "security" as const,
      posX: 34,
      posY: 26,
      firstAid: false,
      fire: false,
    },
  ];

  for (let i = 0; i < ROSTER.length; i++) {
    const r = ROSTER[i];
    const member = members[i % members.length] ?? members[0];

    await ctx.db.insert("responders", {
      eventId,
      userId: member.userId,
      membershipId: member._id,
      name: r.name,
      responderType: r.type,
      posX: r.posX,
      posY: r.posY,
      isAvailable: true,
      hasFirstAid: r.firstAid,
      hasFireTraining: r.fire,
      updatedAt: Date.now(),
    });
  }

  return true;
}

/** Seed responders for simulation and testing */
export const seedResponders = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    return await executeSeedResponders(ctx, args.eventId);
  },
});

/** Helper to inject a simulated report and invoke the orchestrator */
export const injectReport = internalMutation({
  args: {
    eventId: v.id("events"),
    description: v.string(),
    pinX: v.number(),
    pinY: v.number(),
    priority: v.optional(v.union(v.literal("critical"), v.literal("high"), v.literal("medium"), v.literal("low"))),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query("memberships")
      .withIndex("by_event_role", (q) => q.eq("eventId", args.eventId))
      .take(15);

    const randomMember = members[Math.floor(Math.random() * members.length)] ?? members[0];
    if (!randomMember) return;

    const clientId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const reportId = await ctx.db.insert("reports", {
      eventId: args.eventId,
      reporterId: randomMember.userId,
      description: args.description,
      location: "Gate 3",
      pinX: args.pinX,
      pinY: args.pinY,
      status: "approved",
      views: 0,
      resolved: false,
      clientId,
      priority: args.priority,
      imageUrl: args.imageUrl,
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.agentPipeline.startShowcaseRun, { reportId });
  },
});

/** Helper to update crowd dynamics at a zone */
export const updateCrowdData = internalMutation({
  args: {
    eventId: v.id("events"),
    zoneName: v.string(),
    occupancy: v.number(),
    inflowRate: v.number(),
    outflowRate: v.number(),
    exitBlocked: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const zones = await ctx.db
      .query("zones")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .filter((q) => q.eq(q.field("name"), args.zoneName))
      .take(1);

    const zone = zones[0];
    if (!zone) return;

    await ctx.db.patch("zones", zone._id, {
      currentOccupancy: args.occupancy,
      inflowRate: args.inflowRate,
      outflowRate: args.outflowRate,
      exitBlocked: args.exitBlocked ?? zone.exitBlocked,
      updatedAt: Date.now(),
    });

    await logAgentAction(
      ctx,
      args.eventId,
      "crowd_intel",
      "updateCrowdData",
      `Zone sensor update: ${args.zoneName}`,
      `Occupancy=${args.occupancy}/${zone.capacity}, Inflow=${args.inflowRate}/min, Outflow=${args.outflowRate}/min`,
      "warn",
    );

    await ctx.scheduler.runAfter(0, internal.agents.crowdIntel.assessAllZones, {
      eventId: args.eventId,
    });
  },
});

export async function executeSimulateCrisis(ctx: MutationCtx, eventId: Id<"events">) {
  await logAgentAction(
    ctx,
    eventId,
    "orchestrator",
    "simulateGate3Crisis",
    "CRISIS SIMULATION INITIATED: Gate 3 Surge & Multi-Agent Response",
    "Injecting paced multi-agent incidents demonstrating Vision, Deduplication, Multi-lingual NLP & Dispatch",
    "action",
  );

  // Carefully paced sequence for hackathon demonstrations:
  // Each pipeline run takes ~16-20 seconds with full visible agent deliberation
  const SIMULATED_STREAM = [
    {
      // Incident 1: Demonstrates Multi-modal Vision + NLP + Corroboration + Dijkstra Evacuation
      desc: "Massive crowd buildup at Gate 3 entrance, people pushing violently against turnstiles",
      pinX: 65,
      pinY: 45,
      delay: 0,
      priority: "high" as const,
      imageUrl: "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=600&auto=format&fit=crop&q=80",
    },
    {
      // Incident 2: Demonstrates Deduplication & Semantic Merging (Jaccard similarity > 0.8)
      desc: "Gate 3 turnstiles jammed, barricade bowing under intense crowd pressure",
      pinX: 66,
      pinY: 44,
      delay: 20000,
      priority: "critical" as const,
    },
    {
      // Incident 3: Demonstrates Multilingual NLP (Hindi token classification to STAMPEDE)
      desc: "Gate 3 pe bhagdad mach gayi hai, log gir rahe hain emergency madad chahiye",
      pinX: 64,
      pinY: 46,
      delay: 36000,
      priority: "critical" as const,
    },
    {
      // Incident 4: Demonstrates Parallel Independent Zone Incident & Medical Dispatch
      desc: "Medical emergency! Someone collapsed near Food Court, unconscious and needing first aid",
      pinX: 60,
      pinY: 55,
      delay: 52000,
      priority: "high" as const,
      imageUrl: "https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=600&auto=format&fit=crop&q=80",
    },
  ];

  for (const item of SIMULATED_STREAM) {
    await ctx.scheduler.runAfter(item.delay, internal.simulation.injectReport, {
      eventId,
      description: item.desc,
      pinX: item.pinX,
      pinY: item.pinY,
      priority: item.priority,
      imageUrl: item.imageUrl,
    });
  }

  // Sensor telemetry updates synced with narrative
  await ctx.scheduler.runAfter(3500, internal.simulation.updateCrowdData, {
    eventId,
    zoneName: "Gate 3",
    occupancy: 580,
    inflowRate: 55,
    outflowRate: 12,
    exitBlocked: false,
  });

  await ctx.scheduler.runAfter(24000, internal.simulation.updateCrowdData, {
    eventId,
    zoneName: "Gate 3",
    occupancy: 780,
    inflowRate: 70,
    outflowRate: 4,
    exitBlocked: true,
  });
}

/** Full scenario: Simulate Gate 3 Crisis */
export const simulateGate3Crisis = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await executeSimulateCrisis(ctx, args.eventId);
  },
});

/** Public UI entry: Trigger Gate 3 simulation */
export const triggerGate3Simulation = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.eventId, ["ORGANIZER", "STAFF"]);

    await executeSeedZones(ctx, args.eventId);
    await executeSeedResponders(ctx, args.eventId);

    await executeSimulateCrisis(ctx, args.eventId);

    return { success: true, message: "Gate 3 crisis simulation triggered successfully" };
  },
});

/** Public UI entry: Trigger a single showcase report to walk through all 5 agents */
export const triggerSingleShowcaseReport = mutation({
  args: {
    eventId: v.id("events"),
    scenarioType: v.optional(v.union(v.literal("stampede"), v.literal("medical"), v.literal("fire"), v.literal("hindi"))),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.eventId, ["ORGANIZER", "STAFF"]);
    await executeSeedZones(ctx, args.eventId);
    await executeSeedResponders(ctx, args.eventId);

    const type = args.scenarioType ?? "stampede";
    let desc = "Massive crowd buildup at Gate 3 entrance, people pushing violently against turnstiles";
    let pinX = 65;
    let pinY = 45;
    let imageUrl = "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=600&auto=format&fit=crop&q=80";

    if (type === "medical") {
      desc = "Medical emergency! Person unconscious and bleeding near Food Court ramp";
      pinX = 60;
      pinY = 55;
      imageUrl = "https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=600&auto=format&fit=crop&q=80";
    } else if (type === "fire") {
      desc = "Smoke and flames detected behind Main Stage lighting rig, evacuation needed";
      pinX = 50;
      pinY = 60;
      imageUrl = "https://images.unsplash.com/photo-1584438784894-089d6a62b8fa?w=600&auto=format&fit=crop&q=80";
    } else if (type === "hindi") {
      desc = "Gate 3 turnstile pe bohot bheed aur bhagdad hai, log dab rahe hain madad bhejo";
      pinX = 65;
      pinY = 45;
      imageUrl = "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=600&auto=format&fit=crop&q=80";
    }

    if (type === "stampede" || type === "hindi") {
      await ctx.scheduler.runAfter(2500, internal.simulation.updateCrowdData, {
        eventId: args.eventId,
        zoneName: "Gate 3",
        occupancy: 620,
        inflowRate: 65,
        outflowRate: 8,
        exitBlocked: false,
      });
    }

    await ctx.scheduler.runAfter(0, internal.simulation.injectReport, {
      eventId: args.eventId,
      description: desc,
      pinX,
      pinY,
      priority: type === "stampede" || type === "fire" ? "critical" : "high",
      imageUrl,
    });

    return { success: true, message: `Showcase scenario (${type}) initiated` };
  },
});

/** Public UI entry: Manually verify an incident on the ground */
export const verifyIncidentByStaff = mutation({
  args: {
    incidentId: v.id("incidents"),
  },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) throw new Error("Incident not found");

    const moderator = await requireRole(ctx, incident.eventId, ["ORGANIZER", "STAFF"]);

    await ctx.db.patch("incidents", incident._id, {
      verificationStatus: "VERIFIED",
      verificationReason: "Physical on-site verification confirmed by event staff",
      staffVerifiedBy: moderator.userId,
      staffVerifiedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await logAgentAction(
      ctx,
      incident.eventId,
      "verification",
      "verifyIncidentByStaff",
      `Staff ${moderator.role} confirmed ${incident.incidentCode}`,
      "Status escalated to VERIFIED. Emergency response unlocked.",
      "action",
      incident._id,
    );

    await ctx.scheduler.runAfter(0, internal.orchestrator.runResponsePlanning, {
      incidentId: incident._id,
    });

    return true;
  },
});
