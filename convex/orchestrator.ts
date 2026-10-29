import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { logAgentAction } from "./lib/agentLog";

/** Main entry point — called when a new report is created */
export const processNewReport = internalMutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get("reports", args.reportId);
    if (!report) return;

    await logAgentAction(
      ctx,
      report.eventId,
      "orchestrator",
      "processNewReport",
      `Received report RPT-${report._id.slice(-4)}`,
      "Pipeline started: Intake → Verification → Crowd Intel → Routing → Dispatch",
      "info",
    );

    // Step 1: Run Intake Agent
    const intakeResult = await ctx.runMutation(internal.agents.intake.processReport, {
      reportId: args.reportId,
    });

    // Step 2: Schedule Verification Agent
    await ctx.scheduler.runAfter(0, internal.orchestrator.runVerification, {
      incidentId: intakeResult.incidentId,
    });
  },
});

/** Step 2: Run Verification Agent */
export const runVerification = internalMutation({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) return;

    const verificationResult = await ctx.runMutation(
      internal.agents.verification.evaluateIncident,
      { incidentId: args.incidentId },
    );

    // Step 3: Always run Crowd Intel (independent of verification state)
    await ctx.scheduler.runAfter(0, internal.orchestrator.runCrowdIntel, {
      incidentId: args.incidentId,
    });

    // Step 4: If VERIFIED or CORROBORATED, start response planning
    if (verificationResult.newStatus !== "UNVERIFIED") {
      await ctx.scheduler.runAfter(0, internal.orchestrator.runResponsePlanning, {
        incidentId: args.incidentId,
      });
    }
  },
});

/** Step 3: Run Crowd Intel Agent */
export const runCrowdIntel = internalMutation({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) return;

    // Assess all zones in the venue
    await ctx.runMutation(internal.agents.crowdIntel.assessAllZones, {
      eventId: incident.eventId,
    });

    // Run dynamic routing agent
    await ctx.scheduler.runAfter(0, internal.orchestrator.runRouting, {
      eventId: incident.eventId,
      incidentId: args.incidentId,
    });
  },
});

/** Step 4: Run Routing Agent */
export const runRouting = internalMutation({
  args: {
    eventId: v.id("events"),
    incidentId: v.id("incidents"),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.agents.routing.computeAlternativeRoutes, {
      eventId: args.eventId,
      incidentId: args.incidentId,
    });
  },
});

/** Step 5: Run Response Planning / Dispatch Agent */
export const runResponsePlanning = internalMutation({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) return;

    const canDispatchInternal = incident.verificationStatus !== "UNVERIFIED";
    const canDispatchExternal = incident.verificationStatus === "VERIFIED";

    if (canDispatchInternal) {
      await ctx.runMutation(internal.agents.dispatch.dispatchResponders, {
        incidentId: args.incidentId,
        allowEmergencyServices: canDispatchExternal,
      });
    }
  },
});

/** When new evidence arrives, re-evaluate verification and response */
export const onEvidenceUpdate = internalMutation({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.orchestrator.runVerification, {
      incidentId: args.incidentId,
    });
  },
});

