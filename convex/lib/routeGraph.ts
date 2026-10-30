import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
export const ROUTE_UTILIZATION_CAP = 0.85;
export type RouteZone = { _id: string; name: string; currentOccupancy: number; capacity: number; riskScore: number; exitBlocked: boolean; telemetryStale?: boolean; isDesignatedEgress?: boolean; isAssemblyPoint?: boolean; updatedAt: number };
export type RouteEdge = { _id: string; fromZoneId: string; toZoneId: string; baseWeight: number; corridorCapacity: number; isPassable: boolean; updatedAt: number };
export type RouteReservations = { zones: Record<string, number>; edges: Record<string, number> };
export const emptyReservations = (): RouteReservations => ({ zones: {}, edges: {} });
export function pathCapacity(path: string[], zones: RouteZone[], edges: RouteEdge[], reservations: RouteReservations = emptyReservations()) {
  if (path.length < 2 || new Set(path).size !== path.length) return 0;
  const zoneMap = new Map(zones.map(z => [z._id, z]));
  let headroom = Infinity;
  for (let i = 1; i < path.length; i++) {
    const zone = zoneMap.get(path[i]);
    const edge = edges.find(e => e.fromZoneId === path[i - 1] && e.toZoneId === path[i] && e.isPassable);
    if (!zone || !edge || zone.exitBlocked || zone.telemetryStale || zone.riskScore >= 80 || !Number.isFinite(zone.capacity) || !Number.isFinite(zone.currentOccupancy) || !Number.isFinite(edge.corridorCapacity) || !Number.isFinite(edge.baseWeight) || edge.baseWeight <= 0) return 0;
    headroom = Math.min(headroom, Math.floor(zone.capacity * ROUTE_UTILIZATION_CAP) - zone.currentOccupancy - (reservations.zones[zone._id] ?? 0), Math.floor(edge.corridorCapacity * ROUTE_UTILIZATION_CAP) - (reservations.edges[edge._id] ?? 0));
  }
  return Math.max(0, Math.floor(headroom));
}
export function reservePath(path: string[], people: number, edges: RouteEdge[], reservations: RouteReservations) {
  if (!Number.isSafeInteger(people) || people < 1) throw new Error("Invalid planned group size.");
  for (let i = 1; i < path.length; i++) {
    reservations.zones[path[i]] = (reservations.zones[path[i]] ?? 0) + people;
    const edge = edges.find(e => e.fromZoneId === path[i - 1] && e.toZoneId === path[i] && e.isPassable);
    if (!edge) throw new Error("Route edge is unavailable.");
    reservations.edges[edge._id] = (reservations.edges[edge._id] ?? 0) + people;
  }
}
export function graphFingerprint(zones: RouteZone[], edges: RouteEdge[]) {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([zones.map(z => [z._id,z.currentOccupancy,z.capacity,z.riskScore,z.exitBlocked,z.telemetryStale,z.isDesignatedEgress,z.isAssemblyPoint,z.updatedAt]).sort(),edges.map(e => [e._id,e.fromZoneId,e.toZoneId,e.baseWeight,e.corridorCapacity,e.isPassable,e.updatedAt]).sort()]))));
}
export function calculateRoute(zones: RouteZone[], edges: RouteEdge[], from: string, to: string, avoid: string[] = [], people = 1, reservations: RouteReservations = emptyReservations()) {
  const map = new Map(zones.map(z => [z._id,z]));
  const excluded = new Set(avoid);
  const distance = new Map(zones.map(z => [z._id, Infinity]));
  const previous = new Map<string,string>();
  const remaining = new Set(zones.map(z => z._id));
  const infeasible = { path: [] as string[], totalWeight: 0, feasible: false, estimatedTimeSeconds: 0 };
  if (!map.has(from) || !map.has(to) || from === to || !Number.isSafeInteger(people) || people < 1) return infeasible;
  const allowed = (id: string) => { const z = map.get(id); return z && !excluded.has(id) && !z.exitBlocked && z.riskScore < 80 && !z.telemetryStale && z.capacity > 0 && z.currentOccupancy + (reservations.zones[id] ?? 0) + people <= Math.floor(z.capacity * ROUTE_UTILIZATION_CAP); };
  if (!allowed(to)) return infeasible;
  distance.set(from,0);
  while (remaining.size) {
    let current: string | undefined;
    let best = Infinity;
    for (const id of remaining) if ((distance.get(id) ?? Infinity) < best) { current = id; best = distance.get(id)!; }
    if (!current) break;
    if (current === to) break;
    remaining.delete(current);
    const origin = map.get(current)!;
    for (const edge of edges) {
      if (edge.fromZoneId !== current || !edge.isPassable || !remaining.has(edge.toZoneId) || !allowed(edge.toZoneId) || !Number.isFinite(edge.baseWeight) || edge.baseWeight <= 0 || !Number.isFinite(edge.corridorCapacity) || (reservations.edges[edge._id] ?? 0) + people > Math.floor(edge.corridorCapacity * ROUTE_UTILIZATION_CAP)) continue;
      const target = map.get(edge.toZoneId)!;
      const congestion = Math.min(5, Math.max(0, origin.currentOccupancy) / edge.corridorCapacity * 2);
      const weight = edge.baseWeight * (1 + congestion) + Math.max(origin.riskScore,target.riskScore)/2;
      const alternative = best + weight;
      if (alternative < (distance.get(target._id) ?? Infinity)) { distance.set(target._id, alternative); previous.set(target._id,current); }
    }
  }
  if (!Number.isFinite(distance.get(to))) return infeasible;
  const path = [to];
  while (path[0] !== from) { const parent = previous.get(path[0]); if (!parent || path.length > zones.length) return infeasible; path.unshift(parent); }
  return { path, totalWeight: distance.get(to)!, feasible: true, estimatedTimeSeconds: Math.round(distance.get(to)!) };
}
