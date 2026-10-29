import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { logAgentAction } from "../lib/agentLog";
import { canDispatchEmergencyService } from "../lib/safety";
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
    if (!incident) throw new Error("Incident not found");

    const allResponders = await ctx.db
      .query("responders")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(50);

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

    for (const r of allResponders) {
      const posX = r.posX ?? 50;
      const posY = r.posY ?? 50;
      const distPercent = Math.hypot(posX - incident.pinX, posY - incident.pinY);
      const distanceMeters = Math.round(distPercent * 12);
      const etaSeconds = Math.max(30, Math.round(distPercent * 4));

      let skillBonus = 1.0;
      if (incident.incidentType === "medical" && (r.hasFirstAid || r.responderType === "medical")) {
        skillBonus = 2.5;
      } else if (incident.incidentType === "fire" && (r.hasFireTraining || r.responderType === "fire")) {
        skillBonus = 2.5;
      } else if (incident.incidentType === "security" && r.responderType === "security") {
        skillBonus = 2.0;
      } else if (incident.incidentType === "stampede" && (r.responderType === "security" || r.responderType === "volunteer")) {
        skillBonus = 1.8;
      }

      if (args.requiredType && r.responderType === args.requiredType) {
        skillBonus *= 1.5;
      }

      const availBonus = r.isAvailable ? 2.0 : 0.3;
      const distWeight = Math.max(1, distanceMeters);
      const score = (1000 / distWeight) * skillBonus * availBonus;

      scored.push({
        responderId: r._id,
        userId: r.userId,
        name: r.name ?? r.responderType,
        responderType: r.responderType,
        isAvailable: r.isAvailable,
        distanceMeters,
        etaSeconds,
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);
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

    const posX = responder.posX ?? 50;
    const posY = responder.posY ?? 50;
    const distPercent = Math.hypot(posX - incident.pinX, posY - incident.pinY);
    const distanceMeters = Math.round(distPercent * 12);
    const etaSeconds = Math.max(30, Math.round(distPercent * 4));

    return {
      etaSeconds,
      distanceMeters,
      routeDescription: `Direct route: approximately ${distanceMeters}m (${Math.ceil(etaSeconds / 60)} min walk)`,
    };
  },
});

export async function executeAssignResponder(
  ctx: MutationCtx,
  args: {
    responderId: Id<"responders">;
    incidentId: Id<"incidents">;
    instruction?: string;
  },
): Promise<Id<"dispatchTasks">> {
  const responder = await ctx.db.get("responders", args.responderId);
  const incident = await ctx.db.get("incidents", args.incidentId);
  if (!responder || !incident) throw new Error("Responder or Incident not found");

  const posX = responder.posX ?? 50;
  const posY = responder.posY ?? 50;
  const distPercent = Math.hypot(posX - incident.pinX, posY - incident.pinY);
  const distanceMeters = Math.round(distPercent * 12);
  const etaSeconds = Math.max(30, Math.round(distPercent * 4));

  const instruction =
    args.instruction ??
    `Dispatch: Respond to ${incident.incidentType} incident at ${incident.location} (${incident.incidentCode}).`;

  const taskId = await ctx.db.insert("dispatchTasks", {
    eventId: incident.eventId,
    incidentId: incident._id,
    responderId: responder._id,
    instruction,
    status: "pending",
    estimatedEta: etaSeconds,
    distanceMeters,
    assignedAt: Date.now(),
    isEmergencyDispatch: false,
  });

  await ctx.db.patch("responders", responder._id, {
    isAvailable: false,
    currentTaskId: taskId,
    updatedAt: Date.now(),
  });

  await logAgentAction(
    ctx,
    incident.eventId,
    "dispatch",
    "assign_and_notify_responder",
    `Incident ${incident.incidentCode} → ${responder.name ?? responder.responderType}`,
    `Task created. ETA: ${Math.ceil(etaSeconds / 60)} min (${distanceMeters}m). Auto-escalation scheduled.`,
    "action",
    incident._id,
  );

  // Auto escalation check in 3 minutes
  await ctx.scheduler.runAfter(180_000, internal.agents.dispatch.checkTaskAcceptance, {
    taskId,
  });

  return taskId;
}

/** Tool: Assign and notify responder */
export const assign_and_notify_responder = internalMutation({
  args: {
    responderId: v.id("responders"),
    incidentId: v.id("incidents"),
    instruction: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await executeAssignResponder(ctx, args);
  },
});

export async function executeEscalateTask(
  ctx: MutationCtx,
  taskId: Id<"dispatchTasks">,
): Promise<Id<"dispatchTasks"> | null> {
  const task = await ctx.db.get("dispatchTasks", taskId);
  if (!task || task.status !== "pending") return null;

  const originalResponder = await ctx.db.get("responders", task.responderId);
  const incident = await ctx.db.get("incidents", task.incidentId);
  if (!incident) return null;

  if (originalResponder) {
    await ctx.db.patch("responders", originalResponder._id, {
      isAvailable: true,
      currentTaskId: undefined,
      updatedAt: Date.now(),
    });
  }

  const available = await ctx.db
    .query("responders")
    .withIndex("by_event_available", (q) =>
      q.eq("eventId", incident.eventId).eq("isAvailable", true),
    )
    .filter((q) => q.neq(q.field("_id"), task.responderId))
    .take(10);

  let nextResponder: Doc<"responders"> | null = null;
  let minDistance = Infinity;

  for (const r of available) {
    const dist = Math.hypot((r.posX ?? 50) - incident.pinX, (r.posY ?? 50) - incident.pinY);
    if (dist < minDistance) {
      minDistance = dist;
      nextResponder = r;
    }
  }

  if (nextResponder) {
    const newTaskId = await ctx.db.insert("dispatchTasks", {
      eventId: incident.eventId,
      incidentId: incident._id,
      responderId: nextResponder._id,
      instruction: `[ESCALATED] ${task.instruction}`,
      status: "pending",
      estimatedEta: Math.round(minDistance * 4),
      distanceMeters: Math.round(minDistance * 12),
      assignedAt: Date.now(),
      isEmergencyDispatch: false,
    });

    await ctx.db.patch("responders", nextResponder._id, {
      isAvailable: false,
      currentTaskId: newTaskId,
      updatedAt: Date.now(),
    });

    await ctx.db.patch("dispatchTasks", task._id, {
      status: "escalated",
      escalatedToTaskId: newTaskId,
    });

    await logAgentAction(
      ctx,
      incident.eventId,
      "dispatch",
      "escalate_unaccepted_task",
      `Task for ${incident.incidentCode} unaccepted by ${originalResponder?.name ?? "responder"}`,
      `Reassigned to ${nextResponder.name ?? nextResponder.responderType} (ETA ~${Math.ceil((minDistance * 4) / 60)} min)`,
      "warn",
      incident._id,
    );

    return newTaskId;
  } else {
    await ctx.db.patch("dispatchTasks", task._id, { status: "escalated" });
    await logAgentAction(
      ctx,
      incident.eventId,
      "dispatch",
      "escalate_unaccepted_task",
      `Task for ${incident.incidentCode} timed out`,
      "No other available responders to escalate to; manual staff intervention needed",
      "error",
      incident._id,
    );
    return null;
  }
}

/** Tool: Escalate unaccepted dispatch task */
export const escalate_unaccepted_task = internalMutation({
  args: { taskId: v.id("dispatchTasks") },
  handler: async (ctx, args) => {
    return await executeEscalateTask(ctx, args.taskId);
  },
});

/** Auto-escalation timeout handler */
export const checkTaskAcceptance = internalMutation({
  args: { taskId: v.id("dispatchTasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get("dispatchTasks", args.taskId);
    if (task && task.status === "pending") {
      await executeEscalateTask(ctx, args.taskId);
    }
  },
});

export async function executeEmergencyDispatch(
  ctx: MutationCtx,
  incidentId: Id<"incidents">,
  service: "ambulance" | "fire_brigade" | "police",
): Promise<{ success: boolean; reason: string }> {
  const incident = await ctx.db.get("incidents", incidentId);
  if (!incident) throw new Error("Incident not found");

  const safetyCheck = canDispatchEmergencyService(incident.verificationStatus);

  if (!safetyCheck.allowed) {
    await logAgentAction(
      ctx,
      incident.eventId,
      "safety",
      "canDispatchEmergencyService",
      `${service.toUpperCase()} request for ${incident.incidentCode} (Status=${incident.verificationStatus})`,
      `BLOCKED: ${safetyCheck.reason}`,
      "warn",
      incident._id,
    );
    return { success: false, reason: safetyCheck.reason };
  }

  const responders = await ctx.db
    .query("responders")
    .withIndex("by_event", (q) => q.eq("eventId", incident.eventId))
    .take(1);

  const mockResponderId = responders[0]?._id;
  if (mockResponderId) {
    await ctx.db.insert("dispatchTasks", {
      eventId: incident.eventId,
      incidentId: incident._id,
      responderId: mockResponderId,
      instruction: `MOCK DISPATCH: Outgoing call to city ${service.toUpperCase()} for ${incident.location} (${incident.description})`,
      status: "accepted",
      assignedAt: Date.now(),
      acceptedAt: Date.now(),
      isEmergencyDispatch: true,
      emergencyService: service,
    });
  }

  await logAgentAction(
    ctx,
    incident.eventId,
    "dispatch",
    "request_emergency_dispatch",
    `Incident ${incident.incidentCode} [VERIFIED]`,
    `MOCK DISPATCH: City ${service.toUpperCase()} requested for ${incident.location}`,
    "action",
    incident._id,
  );

  return { success: true, reason: "Emergency service dispatched" };
}

/** Tool: External emergency service request with safety check */
export const request_emergency_dispatch = internalMutation({
  args: {
    incidentId: v.id("incidents"),
    service: v.union(v.literal("ambulance"), v.literal("fire_brigade"), v.literal("police")),
  },
  handler: async (ctx, args) => {
    return await executeEmergencyDispatch(ctx, args.incidentId, args.service);
  },
});

/** Workflow step: Dispatch planning */
export const dispatchResponders = internalMutation({
  args: {
    incidentId: v.id("incidents"),
    allowEmergencyServices: v.boolean(),
  },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) return null;

    if (incident.verificationStatus === "UNVERIFIED") {
      await logAgentAction(
        ctx,
        incident.eventId,
        "dispatch",
        "dispatchResponders",
        `Incident ${incident.incidentCode} is UNVERIFIED`,
        "Internal dispatch held until corroboration",
        "info",
        incident._id,
      );
      return null;
    }

    const availableResponders = await ctx.db
      .query("responders")
      .withIndex("by_event_available", (q) =>
        q.eq("eventId", incident.eventId).eq("isAvailable", true),
      )
      .take(20);

    let assignedId: Id<"dispatchTasks"> | null = null;
    if (availableResponders.length > 0) {
      let best = availableResponders[0];
      let bestDist = Infinity;

      for (const r of availableResponders) {
        const dist = Math.hypot((r.posX ?? 50) - incident.pinX, (r.posY ?? 50) - incident.pinY);
        if (dist < bestDist) {
          bestDist = dist;
          best = r;
        }
      }

      assignedId = await executeAssignResponder(ctx, {
        responderId: best._id,
        incidentId: incident._id,
      });
    }

    if (incident.incidentType === "medical" || incident.incidentType === "stampede" || incident.incidentType === "fire") {
      const service =
        incident.incidentType === "medical" || incident.incidentType === "stampede"
          ? "ambulance"
          : incident.incidentType === "fire"
          ? "fire_brigade"
          : "police";

      await executeEmergencyDispatch(ctx, incident._id, service);
    }

    return assignedId;
  },
});
