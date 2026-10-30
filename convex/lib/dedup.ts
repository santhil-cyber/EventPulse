export function tokenize(text: string): Set<string> {
  return new Set(text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ").split(/\s+/).filter(w => w.length > 1));
}
export function jaccardSimilarity(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter(x => b.has(x)).length;
  return overlap / (a.size + b.size - overlap);
}

/** Location alone never merges unrelated incidents. Unknown categories require review. */
export function duplicateScore(a: { incidentType: string; description: string; pinX: number; pinY: number }, b: typeof a) {
  if (a.incidentType === "other" || a.incidentType !== b.incidentType) return 0;
  const distance = Math.hypot(a.pinX - b.pinX, a.pinY - b.pinY);
  if (distance > 10) return 0;
  const similarity = jaccardSimilarity(tokenize(a.description), tokenize(b.description));
  return similarity >= 0.55 ? Math.min(1, similarity + 0.1 * (1 - distance / 10)) : 0;
}
