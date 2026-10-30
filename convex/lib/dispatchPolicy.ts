import type { Doc } from "../_generated/dataModel";
export const ACTIVE_TASKS = new Set(["pending", "accepted", "en_route", "on_scene"]);
const transitions: Record<string, readonly string[]> = {
  pending: ["accepted", "rejected", "escalated", "canceled"],
  accepted: ["en_route", "on_scene", "canceled"],
  en_route: ["on_scene", "canceled"], on_scene: ["completed", "canceled"],
  completed: [], rejected: [], escalated: [], canceled: [],
};
export function assertTaskTransition(from: string, to: string) {
  if (from !== to && !transitions[from]?.includes(to)) throw new Error(`Cannot move task from ${from} to ${to}.`);
}
export function qualifiedResponder(r: Pick<Doc<"responders">, "responderType" | "hasFirstAid" | "hasFireTraining">, type: string) {
  if (type === "medical") return r.responderType === "medical" || r.hasFirstAid;
  if (type === "fire") return r.responderType === "fire" || r.hasFireTraining;
  if (type === "security") return r.responderType === "security";
  return true;
}
export const INITIAL_SEARCH_RADIUS_METERS = 100;
export function responderDistance(r: Pick<Doc<"responders">, "posX" | "posY">, incident: Pick<Doc<"incidents">, "pinX" | "pinY">) {
  return Math.round(Math.hypot((r.posX ?? 50) - incident.pinX, (r.posY ?? 50) - incident.pinY) * 12);
}
export function responderEta(distanceMeters: number) {
  return Math.max(30, Math.round(distanceMeters / 3));
}
export function rankResponders<T extends Pick<Doc<"responders">, "responderType" | "hasFirstAid" | "hasFireTraining" | "posX" | "posY" | "isAvailable" | "currentTaskId">>(responders: T[], incident: Pick<Doc<"incidents">, "pinX" | "pinY" | "incidentType">, workload: Record<string, number> = {}, requireQualification = true) {
  const eligible = responders.filter(r => r.isAvailable && !r.currentTaskId && (!requireQualification || qualifiedResponder(r, incident.incidentType)));
  const near = eligible.filter(r => responderDistance(r, incident) <= INITIAL_SEARCH_RADIUS_METERS);
  const pool = near.length ? near : eligible;
  return [...pool].sort((a, b) => {
    const skill = (r: T) => incident.incidentType === "medical" ? (r.responderType === "medical" ? 2 : r.hasFirstAid ? 1 : 0) : incident.incidentType === "fire" ? (r.responderType === "fire" ? 2 : r.hasFireTraining ? 1 : 0) : incident.incidentType === "security" || incident.incidentType === "stampede" ? (r.responderType === "security" ? 2 : r.responderType === "volunteer" ? 1 : 0) : 1;
    const aId = "_id" in a ? String(a._id) : "";
    const bId = "_id" in b ? String(b._id) : "";
    return skill(b) - skill(a) || (workload[aId] ?? 0) - (workload[bId] ?? 0) || responderDistance(a, incident) - responderDistance(b, incident);
  });
}
