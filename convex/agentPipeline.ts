import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { logAgentAction } from "./lib/agentLog";

/**
 * Pacing delays for live hackathon showcase demo (in milliseconds).
 * Allows judges and attendees to clearly watch each agent deliberate, call tools, and hand off.
 */
export const SHOWCASE_DELAYS = {
  intake_starting: 700,
  intake_thinking: 1800,
  intake_tool_call: 1200,
  intake_to_verification: 1400,

  verification_starting: 700,
  verification_thinking: 2000,
  verification_tool_call: 1200,
  verification_to_crowd_intel: 1400,

  crowd_intel_starting: 700,
  crowd_intel_thinking: 1800,
  crowd_intel_tool_call: 1200,
  crowd_intel_to_routing: 1400,

  routing_starting: 700,
  routing_thinking: 2400, // Longer for Dijkstra visualization
  routing_tool_call: 1400,
  routing_to_dispatch: 1400,

  dispatch_starting: 700,
  dispatch_thinking: 1800,
  dispatch_tool_call: 1400,
} as const;

/**
 * Helper to update the state of the active pipeline run.
 */
async function updatePipelineProgress(
  ctx: MutationCtx,
  runId: Id<"pipelineRuns">,
  update: {
    activeAgent?: "intake" | "verification" | "crowd_intel" | "routing" | "dispatch" | "completed";
    agentPhase?: "starting" | "thinking" | "tool_call" | "deciding" | "output" | "handoff";
    currentThought?: string;
    currentTool?: string;
    agentReasoning?: string;
    incidentId?: Id<"incidents">;
    status?: "running" | "completed" | "failed";
  },
) {
  const run = await ctx.db.get("pipelineRuns", runId);
  if (!run) return;

  let timestamps: Record<string, { startedAt?: number; completedAt?: number }> = {};
  try {
    timestamps = JSON.parse(run.agentTimestamps || "{}");
  } catch {
    timestamps = {};
  }

  const agent = update.activeAgent ?? run.activeAgent;

  if (update.agentPhase === "starting" && agent && agent !== "completed") {
    timestamps[agent] = {
      ...(timestamps[agent] || {}),
      startedAt: Date.now(),
    };
  }

  if (update.agentPhase === "output" && agent && agent !== "completed") {
    if (timestamps[agent]) {
      timestamps[agent].completedAt = Date.now();
    } else {
      timestamps[agent] = { completedAt: Date.now() };
    }
  }

  const patchData: any = {
    ...update,
    agentTimestamps: JSON.stringify(timestamps),
  };

  if (update.status === "completed") {
    patchData.completedAt = Date.now();
  }

  await ctx.db.patch("pipelineRuns", runId, patchData);
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 1: INTAKE AGENT (NLP classification, language detection, dedup)
// ═══════════════════════════════════════════════════════════════════════════

export const step1_intake_start = internalMutation({
  args: { runId: v.id("pipelineRuns"), reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get("reports", args.reportId);
    if (!report) return;

    await updatePipelineProgress(ctx, args.runId, {
      activeAgent: "intake",
      agentPhase: "starting",
      currentThought: `Ingesting report RPT-${report._id.slice(-4)}: Parsing telemetry and narrative content...`,
      currentTool: "report_ingest",
    });

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.intake_starting,
      internal.agentPipeline.step1_intake_thinking,
      args,
    );
  },
});

export const step1_intake_thinking = internalMutation({
  args: { runId: v.id("pipelineRuns"), reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get("reports", args.reportId);
    if (!report) return;

    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "thinking",
      currentThought: `Running multilingual NLP tokenizer across EN/HI/ES dictionaries on: "${report.description.slice(0, 50)}..."`,
      currentTool: "extract_incident_details",
      agentReasoning: JSON.stringify({
        analyzingText: report.description,
        location: report.location,
        hasImage: Boolean(report.imageUrl || report.imageStorageId),
      }),
    });

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.intake_thinking,
      internal.agentPipeline.step1_intake_tool_call,
      args,
    );
  },
});

export const step1_intake_tool_call = internalMutation({
  args: { runId: v.id("pipelineRuns"), reportId: v.id("reports") },
  handler: async (ctx, args) => {
    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "tool_call",
      currentThought: "Calling spatial clustering & Jaccard deduplication engine against active incidents...",
      currentTool: "find_duplicate_reports",
    });

    // Execute actual intake logic
    const intakeResult = await ctx.runMutation(internal.agents.intake.processReport, {
      reportId: args.reportId,
    });

    await updatePipelineProgress(ctx, args.runId, {
      incidentId: intakeResult.incidentId,
    });

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.intake_tool_call,
      internal.agentPipeline.step1_intake_output,
      {
        runId: args.runId,
        incidentId: intakeResult.incidentId,
        isNew: intakeResult.isNew,
        incidentType: intakeResult.incidentType,
        severity: intakeResult.severity,
      },
    );
  },
});

export const step1_intake_output = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    incidentId: v.id("incidents"),
    isNew: v.boolean(),
    incidentType: v.string(),
    severity: v.string(),
  },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);

    const decisionText = args.isNew
      ? `Created Master Incident ${incident?.incidentCode ?? "INC"} [${args.incidentType.toUpperCase()}, ${args.severity.toUpperCase()}]`
      : `Corroborated and merged into existing ${incident?.incidentCode ?? "INC"} via similarity match`;

    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "output",
      currentThought: `Intake Complete: ${decisionText}`,
      currentTool: "create_or_update_incident",
      agentReasoning: JSON.stringify({
        incidentCode: incident?.incidentCode,
        isNew: args.isNew,
        incidentType: args.incidentType,
        severity: args.severity,
        location: incident?.location,
      }),
    });

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.intake_to_verification,
      internal.agentPipeline.step2_verification_start,
      { runId: args.runId, incidentId: args.incidentId },
    );
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STEP 2: VERIFICATION AGENT (Source independence, CV validation, trust score)
// ═══════════════════════════════════════════════════════════════════════════

export const step2_verification_start = internalMutation({
  args: { runId: v.id("pipelineRuns"), incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) return;

    await updatePipelineProgress(ctx, args.runId, {
      activeAgent: "verification",
      agentPhase: "starting",
      currentThought: `Verification Agent invoked for ${incident.incidentCode}: Inspecting ground truth signals...`,
      currentTool: "check_source_independence",
    });

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.verification_starting,
      internal.agentPipeline.step2_verification_thinking,
      args,
    );
  },
});

export const step2_verification_thinking = internalMutation({
  args: { runId: v.id("pipelineRuns"), incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) return;

    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "thinking",
      currentThought: `Evaluating multi-source trust: ${incident.independentSourceCount} independent source(s) · CV Vision conf: ${incident.imageConfidence ?? "N/A"}%`,
      currentTool: "analyse_media_consistency",
      agentReasoning: JSON.stringify({
        independentSources: incident.independentSourceCount,
        hasImageEvidence: incident.hasImageEvidence,
        imageAnalysis: incident.imageAnalysis,
        priorStatus: incident.verificationStatus,
      }),
    });

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.verification_thinking,
      internal.agentPipeline.step2_verification_tool_call,
      args,
    );
  },
});

export const step2_verification_tool_call = internalMutation({
  args: { runId: v.id("pipelineRuns"), incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "tool_call",
      currentThought: "Computing mathematical confidence score against safety threshold matrix...",
      currentTool: "evaluateIncident",
    });

    // Execute actual verification logic
    const verificationResult = await ctx.runMutation(
      internal.agents.verification.evaluateIncident,
      { incidentId: args.incidentId },
    );

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.verification_tool_call,
      internal.agentPipeline.step2_verification_output,
      {
        runId: args.runId,
        incidentId: args.incidentId,
        newStatus: verificationResult.newStatus,
        avgTrustScore: verificationResult.avgTrustScore,
        independentCount: verificationResult.independentCount,
      },
    );
  },
});

export const step2_verification_output = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    incidentId: v.id("incidents"),
    newStatus: v.string(),
    avgTrustScore: v.number(),
    independentCount: v.number(),
  },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);

    const isVerified = args.newStatus === "VERIFIED";
    const statusChip = isVerified ? "VERIFIED (Full Clearance)" : "CORROBORATED (Internal Only)";

    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "output",
      currentThought: `Verification Status: ${statusChip} | Trust: ${args.avgTrustScore}/100 | Sources: ${args.independentCount}`,
      currentTool: "update_verification_status",
      agentReasoning: JSON.stringify({
        status: args.newStatus,
        trustScore: args.avgTrustScore,
        independentSources: args.independentCount,
        verificationReason: incident?.verificationReason,
      }),
    });

    // Hand off to Crowd Intel Agent
    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.verification_to_crowd_intel,
      internal.agentPipeline.step3_crowd_intel_start,
      { runId: args.runId, incidentId: args.incidentId },
    );
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STEP 3: CROWD INTELLIGENCE AGENT (Density, inflow surge, chokepoint risk)
// ═══════════════════════════════════════════════════════════════════════════

export const step3_crowd_intel_start = internalMutation({
  args: { runId: v.id("pipelineRuns"), incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) return;

    await updatePipelineProgress(ctx, args.runId, {
      activeAgent: "crowd_intel",
      agentPhase: "starting",
      currentThought: "Crowd Intelligence Agent activated: Ingesting sensor grid and turnstile telemetry...",
      currentTool: "get_zone_occupancy",
    });

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.crowd_intel_starting,
      internal.agentPipeline.step3_crowd_intel_thinking,
      { runId: args.runId, eventId: incident.eventId, incidentId: args.incidentId },
    );
  },
});

export const step3_crowd_intel_thinking = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    eventId: v.id("events"),
    incidentId: v.id("incidents"),
  },
  handler: async (ctx, args) => {
    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "thinking",
      currentThought: "Evaluating multi-factor risk equation: 40% Density + 25% Inflow Surge + 25% Chokepoint + 10% Proximity...",
      currentTool: "predict_zone_risk",
    });

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.crowd_intel_thinking,
      internal.agentPipeline.step3_crowd_intel_tool_call,
      args,
    );
  },
});

export const step3_crowd_intel_tool_call = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    eventId: v.id("events"),
    incidentId: v.id("incidents"),
  },
  handler: async (ctx, args) => {
    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "tool_call",
      currentThought: "Computing risk scores for all 12 zones & recommending safety marshal allocations...",
      currentTool: "assessAllZones",
    });

    // Actually execute crowd assessment
    await ctx.runMutation(internal.agents.crowdIntel.assessAllZones, {
      eventId: args.eventId,
    });

    const zones = await ctx.db
      .query("zones")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(50);

    const sortedZones = [...zones].sort((a, b) => b.riskScore - a.riskScore);
    const topZone = sortedZones[0];
    const highRiskCount = zones.filter((z) => z.riskScore > 60).length;

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.crowd_intel_tool_call,
      internal.agentPipeline.step3_crowd_intel_output,
      {
        runId: args.runId,
        eventId: args.eventId,
        incidentId: args.incidentId,
        topZoneName: topZone?.name ?? "Unknown",
        topRiskScore: topZone?.riskScore ?? 0,
        highRiskCount,
      },
    );
  },
});

export const step3_crowd_intel_output = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    eventId: v.id("events"),
    incidentId: v.id("incidents"),
    topZoneName: v.string(),
    topRiskScore: v.number(),
    highRiskCount: v.number(),
  },
  handler: async (ctx, args) => {
    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "output",
      currentThought: `Crowd Telemetry: Peak risk at ${args.topZoneName} (${args.topRiskScore}%). ${args.highRiskCount} sector(s) require intervention.`,
      currentTool: "recommend_resource_allocation",
      agentReasoning: JSON.stringify({
        peakZone: args.topZoneName,
        peakRisk: args.topRiskScore,
        criticalZonesCount: args.highRiskCount,
      }),
    });

    // Hand off to Dynamic Routing Agent
    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.crowd_intel_to_routing,
      internal.agentPipeline.step4_routing_start,
      { runId: args.runId, eventId: args.eventId, incidentId: args.incidentId },
    );
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STEP 4: ROUTING AGENT (Graph model, dynamic edge weights, Dijkstra detour)
// ═══════════════════════════════════════════════════════════════════════════

export const step4_routing_start = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    eventId: v.id("events"),
    incidentId: v.id("incidents"),
  },
  handler: async (ctx, args) => {
    await updatePipelineProgress(ctx, args.runId, {
      activeAgent: "routing",
      agentPhase: "starting",
      currentThought: "Routing Agent activated: Loading venue topological graph (12 nodes, 26 edges)...",
      currentTool: "get_venue_graph",
    });

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.routing_starting,
      internal.agentPipeline.step4_routing_thinking,
      args,
    );
  },
});

export const step4_routing_thinking = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    eventId: v.id("events"),
    incidentId: v.id("incidents"),
  },
  handler: async (ctx, args) => {
    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "thinking",
      currentThought: "Penalizing congested corridors and chokepoints in graph matrix. Computing safest Dijkstra path...",
      currentTool: "calculate_safe_route",
    });

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.routing_thinking,
      internal.agentPipeline.step4_routing_tool_call,
      args,
    );
  },
});

export const step4_routing_tool_call = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    eventId: v.id("events"),
    incidentId: v.id("incidents"),
  },
  handler: async (ctx, args) => {
    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "tool_call",
      currentThought: "Generating optimal detour vectors away from incident epicentre...",
      currentTool: "computeAlternativeRoutes",
    });

    // Actually execute alternative route computation
    const routingResult = await ctx.runMutation(
      internal.agents.routing.computeAlternativeRoutes,
      {
        eventId: args.eventId,
        incidentId: args.incidentId,
      },
    );

    const hasRoute = Boolean(routingResult?.route?.feasible);
    const instruction = routingResult?.instruction ?? "Standard evacuation corridors remain passable.";

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.routing_tool_call,
      internal.agentPipeline.step4_routing_output,
      {
        runId: args.runId,
        incidentId: args.incidentId,
        hasRoute,
        instruction,
      },
    );
  },
});

export const step4_routing_output = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    incidentId: v.id("incidents"),
    hasRoute: v.boolean(),
    instruction: v.string(),
  },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) return;

    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "output",
      currentThought: `Dynamic Routing Complete: ${args.instruction}`,
      currentTool: "publish_route_recommendation",
      agentReasoning: JSON.stringify({
        hasFeasibleAlternative: args.hasRoute,
        instruction: args.instruction,
      }),
    });

    // Check safety policy for dispatch
    const canDispatch = incident.verificationStatus !== "UNVERIFIED";

    if (canDispatch) {
      await ctx.scheduler.runAfter(
        SHOWCASE_DELAYS.routing_to_dispatch,
        internal.agentPipeline.step5_dispatch_start,
        { runId: args.runId, incidentId: args.incidentId },
      );
    } else {
      // Unverified incidents are held by safety gate from dispatching units
      await updatePipelineProgress(ctx, args.runId, {
        activeAgent: "dispatch",
        agentPhase: "output",
        currentThought: "🛑 Safety Gate Engaged: Automated dispatch held pending corroboration/verification.",
        currentTool: "canDispatchEmergencyService",
        status: "completed",
      });
      await logAgentAction(
        ctx,
        incident.eventId,
        "safety",
        "pipeline_safety_gate",
        `Pipeline completed for ${incident.incidentCode}`,
        "Automated dispatch held: Incident remains UNVERIFIED. Waiting for staff or corroborating report.",
        "info",
        incident._id,
      );
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STEP 5: DISPATCH AGENT (Proximity, skill qualification, task assignment)
// ═══════════════════════════════════════════════════════════════════════════

export const step5_dispatch_start = internalMutation({
  args: { runId: v.id("pipelineRuns"), incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) return;

    await updatePipelineProgress(ctx, args.runId, {
      activeAgent: "dispatch",
      agentPhase: "starting",
      currentThought: `Safety Gate Cleared: Scanning available responders for ${incident.incidentType} profile...`,
      currentTool: "find_available_responders",
    });

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.dispatch_starting,
      internal.agentPipeline.step5_dispatch_thinking,
      args,
    );
  },
});

export const step5_dispatch_thinking = internalMutation({
  args: { runId: v.id("pipelineRuns"), incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "thinking",
      currentThought: "Ranking candidates: Distance weight × Skill affinity (medical/fire/security) × Availability status...",
      currentTool: "calculate_responder_eta",
    });

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.dispatch_thinking,
      internal.agentPipeline.step5_dispatch_tool_call,
      args,
    );
  },
});

export const step5_dispatch_tool_call = internalMutation({
  args: { runId: v.id("pipelineRuns"), incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) return;

    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "tool_call",
      currentThought: "Dispatching highest-affinity responder with auto-escalation timeout...",
      currentTool: "assign_and_notify_responder",
    });

    // Actually execute dispatch
    const isVerified = incident.verificationStatus === "VERIFIED";
    await ctx.runMutation(internal.agents.dispatch.dispatchResponders, {
      incidentId: args.incidentId,
      allowEmergencyServices: isVerified,
    });

    // Find the task created for this incident
    const tasks = await ctx.db
      .query("dispatchTasks")
      .withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId))
      .order("desc")
      .take(1);

    const task = tasks[0];
    let responderName = "Field Unit";
    if (task) {
      const resp = await ctx.db.get("responders", task.responderId);
      if (resp) responderName = resp.name ?? resp.responderType;
    }

    await ctx.scheduler.runAfter(
      SHOWCASE_DELAYS.dispatch_tool_call,
      internal.agentPipeline.step5_dispatch_output,
      {
        runId: args.runId,
        incidentId: args.incidentId,
        responderName,
        etaSeconds: task?.estimatedEta ?? 120,
        distanceMeters: task?.distanceMeters ?? 45,
      },
    );
  },
});

export const step5_dispatch_output = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    incidentId: v.id("incidents"),
    responderName: v.string(),
    etaSeconds: v.number(),
    distanceMeters: v.number(),
  },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) return;

    const etaMin = Math.ceil(args.etaSeconds / 60);
    const summary = `Unit Deployed: ${args.responderName} assigned (ETA: ~${etaMin} min, ${args.distanceMeters}m). Auto-escalation active.`;

    await updatePipelineProgress(ctx, args.runId, {
      agentPhase: "output",
      currentThought: summary,
      currentTool: "dispatchResponders",
      agentReasoning: JSON.stringify({
        assignedResponder: args.responderName,
        estimatedEtaSeconds: args.etaSeconds,
        distanceMeters: args.distanceMeters,
        emergencyServicesCalled: incident.verificationStatus === "VERIFIED",
      }),
    });

    // Mark entire pipeline completed
    await updatePipelineProgress(ctx, args.runId, {
      activeAgent: "completed",
      agentPhase: "output",
      currentThought: `✅ Full 5-Agent Pipeline successfully executed for ${incident.incidentCode}.`,
      status: "completed",
    });

    await logAgentAction(
      ctx,
      incident.eventId,
      "orchestrator",
      "showcasePipelineCompleted",
      `Pipeline Run Finished for ${incident.incidentCode}`,
      "All 5 autonomous agents (Intake → Verification → Crowd Intel → Routing → Dispatch) completed tasks successfully.",
      "action",
      incident._id,
    );
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC ENTRY POINT & QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trigger a visible showcase pipeline run for a report.
 */
export const startShowcaseRun = internalMutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get("reports", args.reportId);
    if (!report) return null;

    const runCode = `RUN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

    const runId = await ctx.db.insert("pipelineRuns", {
      eventId: report.eventId,
      reportId: args.reportId,
      runCode,
      activeAgent: "intake",
      agentPhase: "starting",
      currentThought: `Pipeline Initiated for report RPT-${report._id.slice(-4)}: Ingesting sensor and crowd signals...`,
      currentTool: "pipeline_init",
      agentReasoning: JSON.stringify({ reportId: report._id, initialLocation: report.location }),
      agentTimestamps: JSON.stringify({ intake: { startedAt: Date.now() } }),
      status: "running",
      startedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(
      200,
      internal.agentPipeline.step1_intake_start,
      { runId, reportId: args.reportId },
    );

    return runId;
  },
});

/**
 * Reactive query for the active or most recent showcase pipeline run.
 */
export const getActivePipelineRun = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    // Check if there is an actively running pipeline
    const runningRun = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_event_status", (q) =>
        q.eq("eventId", args.eventId).eq("status", "running"),
      )
      .order("desc")
      .first();

    if (runningRun) {
      return runningRun;
    }

    // Otherwise return the most recently completed pipeline run
    const lastRun = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_event_startedAt", (q) => q.eq("eventId", args.eventId))
      .order("desc")
      .first();

    return lastRun;
  },
});

/**
 * Reactive query to list recent pipeline runs.
 */
export const listRecentPipelineRuns = query({
  args: { eventId: v.id("events"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;
    return await ctx.db
      .query("pipelineRuns")
      .withIndex("by_event_startedAt", (q) => q.eq("eventId", args.eventId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Public UI mutation: Reset or dismiss an active pipeline run.
 */
export const resetActivePipelineRun = mutation({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, args) => {
    await ctx.db.patch("pipelineRuns", args.runId, {
      status: "completed",
      currentThought: "Pipeline reset manually by operator.",
      completedAt: Date.now(),
    });
  },
});
