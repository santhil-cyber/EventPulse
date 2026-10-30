import { v } from "convex/values";

export const aiMode = v.union(v.literal("off"), v.literal("shadow"), v.literal("assist"));
export const analysisOutput = v.object({
  language: v.string(), translatedText: v.union(v.string(), v.null()),
  incidentType: v.union(v.literal("medical"), v.literal("fire"), v.literal("security"), v.literal("stampede"), v.literal("infrastructure"), v.literal("other")),
  suggestedSeverity: v.union(v.literal("critical"), v.literal("high"), v.literal("medium"), v.literal("low")),
  summary: v.string(),
  observations: v.array(v.object({ text: v.string(), source: v.union(v.literal("report_text"), v.literal("image")) })),
  uncertaintyReasons: v.array(v.string()), needsHumanReview: v.boolean(),
});
export const citation = v.object({ chunkId: v.id("knowledgeChunks"), quote: v.string() });
export const analysisStatus = v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("fallback"), v.literal("superseded"));
