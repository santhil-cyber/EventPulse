import { z } from "zod";
export const IntakeSchema = z.object({
  language: z.string().min(2).max(32), translatedText: z.string().max(3000).nullable(),
  incidentType: z.enum(["medical", "fire", "security", "stampede", "infrastructure", "other"]),
  suggestedSeverity: z.enum(["critical", "high", "medium", "low"]),
  summary: z.string().min(1).max(1200),
  observations: z.array(z.object({ text: z.string().min(1).max(500), source: z.enum(["report_text", "image"]) })).max(12),
  uncertaintyReasons: z.array(z.string().max(300)).max(8), needsHumanReview: z.boolean(),
});
export const AnswerSchema = z.object({
  abstain: z.boolean(),
  citations: z.array(z.object({ chunkId: z.string(), quote: z.string().min(8).max(1000) })).max(5),
});
