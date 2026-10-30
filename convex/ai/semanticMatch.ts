"use node";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { compareIncidentReports } from "./provider";

export const compare = internalAction({
  args: { reportId: v.id("reports"), candidateIds: v.array(v.id("incidents")) },
  returns: v.union(v.null(), v.object({ incidentId: v.id("incidents"), confidence: v.number() })),
  handler: async (ctx, args): Promise<{ incidentId: Id<"incidents">; confidence: number } | null> => {
    const context = await ctx.runQuery(internal.ai.semanticIntake.candidates, { reportId: args.reportId, now: Date.now() });
    if (!context) return null;
    const candidates = context.candidates.filter(x => args.candidateIds.includes(x._id));
    if (!candidates.length) return null;
    if (!await ctx.runMutation(internal.ai.semanticIntake.reserveComparison, { reportId: args.reportId })) return null;
    const result = await compareIncidentReports(context.report.description, candidates.map(x => ({ id: x._id, description: x.description })));
    const match = candidates.find(x => x._id === result.candidateId);
    return match && result.confidence >= 0.95 ? { incidentId: match._id, confidence: result.confidence } : null;
  },
});
