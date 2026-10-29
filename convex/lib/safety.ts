import type { Id } from "../_generated/dataModel";
import type { VerificationThreshold } from "./verificationThresholds";

export type VerificationStatus = "UNVERIFIED" | "CORROBORATED" | "VERIFIED";
export type Severity = "critical" | "high" | "medium" | "low";

/** Pure deterministic functions — no DB access, no side effects */

export function canDispatchEmergencyService(
  verificationStatus: VerificationStatus,
): { allowed: boolean; reason: string } {
  if (verificationStatus !== "VERIFIED") {
    return {
      allowed: false,
      reason: `Emergency dispatch requires VERIFIED status. Current: ${verificationStatus}`,
    };
  }
  return { allowed: true, reason: "Incident is VERIFIED" };
}

export function canMarkVerified(
  incident: { independentSourceCount: number; staffVerifiedBy?: Id<"users"> },
  threshold: VerificationThreshold,
  avgTrustScore: number,
): { allowed: boolean; reason: string } {
  // Staff physical verification always qualifies
  if (incident.staffVerifiedBy) {
    return { allowed: true, reason: "Staff physical verification completed" };
  }
  // Threshold check
  if (incident.independentSourceCount < threshold.minIndependentSources) {
    return {
      allowed: false,
      reason: `Need ${threshold.minIndependentSources} independent sources, have ${incident.independentSourceCount}`,
    };
  }
  if (avgTrustScore < threshold.minTrustScoreAvg) {
    return {
      allowed: false,
      reason: `Average trust score ${avgTrustScore} below threshold ${threshold.minTrustScoreAvg}`,
    };
  }
  return { allowed: true, reason: "Evidence threshold satisfied" };
}

export function canBroadcastEvacuation(
  verificationStatus: VerificationStatus,
  approvedBy?: Id<"users">,
): { allowed: boolean; reason: string } {
  if (verificationStatus !== "VERIFIED") {
    return { allowed: false, reason: "Evacuation requires VERIFIED incident" };
  }
  if (!approvedBy) {
    return { allowed: false, reason: "Evacuation broadcast requires control room approval" };
  }
  return { allowed: true, reason: "Approved by control room" };
}

/** Urgent-but-unverified: alert nearby staff for immediate eyes-on-ground */
export function shouldAlertNearbyStaff(
  verificationStatus: VerificationStatus,
  severity: Severity,
): boolean {
  return (
    verificationStatus === "UNVERIFIED" &&
    (severity === "critical" || severity === "high")
  );
}

