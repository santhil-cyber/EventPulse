export type IncidentType =
  | "medical"
  | "fire"
  | "security"
  | "stampede"
  | "infrastructure"
  | "other";

export interface VerificationThreshold {
  minIndependentSources: number;
  minTrustScoreAvg: number;
  requiresMediaEvidence: boolean;
}

export const THRESHOLDS: Record<IncidentType, VerificationThreshold> = {
  fire: { minIndependentSources: 2, minTrustScoreAvg: 50, requiresMediaEvidence: false },
  medical: { minIndependentSources: 1, minTrustScoreAvg: 60, requiresMediaEvidence: false },
  stampede: { minIndependentSources: 3, minTrustScoreAvg: 40, requiresMediaEvidence: false },
  security: { minIndependentSources: 3, minTrustScoreAvg: 50, requiresMediaEvidence: false },
  infrastructure: { minIndependentSources: 2, minTrustScoreAvg: 60, requiresMediaEvidence: false },
  other: { minIndependentSources: 3, minTrustScoreAvg: 60, requiresMediaEvidence: false },
};

