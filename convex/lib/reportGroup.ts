import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** The first linked report owns moderation for the whole incident. */
export async function reportGroup(ctx: Pick<QueryCtx, "db">, report: Doc<"reports">) {
  const link = await ctx.db.query("incidentReports").withIndex("by_report", q => q.eq("reportId", report._id)).first();
  if (!link) return { original: report, incidentId: null };
  const first = await ctx.db.query("incidentReports").withIndex("by_incident", q => q.eq("incidentId", link.incidentId)).first();
  const original = first ? await ctx.db.get("reports", first.reportId) : null;
  return { original: original?.eventId === report.eventId ? original : report, incidentId: link.incidentId };
}

export function sourcePriority(count: number): "high" | "critical" | null {
  return count >= 5 ? "critical" : count >= 3 ? "high" : null;
}
