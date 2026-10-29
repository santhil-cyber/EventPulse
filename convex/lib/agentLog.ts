import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export type AgentName =
  | "intake"
  | "verification"
  | "crowd_intel"
  | "routing"
  | "dispatch"
  | "orchestrator"
  | "safety";

export type LogLevel = "info" | "warn" | "error" | "action";

export async function logAgentAction(
  ctx: MutationCtx,
  eventId: Id<"events">,
  agentName: AgentName,
  toolName: string,
  inputSummary: string,
  outputSummary: string,
  level: LogLevel = "info",
  incidentId?: Id<"incidents">,
) {
  return await ctx.db.insert("agentLogs", {
    eventId,
    agentName,
    toolName,
    inputSummary,
    outputSummary,
    level,
    incidentId,
    createdAt: Date.now(),
  });
}

