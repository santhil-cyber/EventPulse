"use node";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { analyzeInput, embedTexts, providerErrorCode } from "./provider";

/** Only validated stored attachments are read. Never fetch an attendee-provided URL. */
function imageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return "image/png";
  if (Buffer.from(bytes.slice(0,4)).toString() === "RIFF" && Buffer.from(bytes.slice(8,12)).toString() === "WEBP") return "image/webp";
  return null;
}
export const analyzeReport = internalAction({
  args: { analysisId: v.id("aiAnalyses"), attempt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const context = await ctx.runMutation(internal.ai.state.beginAnalysis, args);
    if (!context) return;
    try {
      let imageDataUrl: string | undefined;
      if (context.imageAllowed && context.report.imageStorageId) {
        const blob = await ctx.storage.get(context.report.imageStorageId);
        if (blob && blob.size <= 5 * 1024 * 1024) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const mime = imageMime(bytes);
          if (mime) imageDataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
        }
      }
      const result = await analyzeInput(context.report.description, imageDataUrl);
      const committed = await ctx.runMutation(internal.ai.state.commitAnalysis, { ...args, ...result, imageAnalyzed: Boolean(imageDataUrl) });
      if (committed && context.embeddingAllowed) {
        // Embeddings are optional: their failure must not turn valid analysis into failure.
        try {
          const embedding = await embedTexts([context.report.description]);
          const candidates = await ctx.vectorSearch("reportEmbeddings", "by_embedding", {
            vector: embedding.vectors[0], limit: 8, filter: q => q.eq("eventId", context.report.eventId),
          });
          await ctx.runMutation(internal.ai.duplicates.recordCandidates, { ...args, embedding: embedding.vectors[0], model: embedding.model, candidates: candidates.map(c => ({ id: c._id, score: c._score })) });
        } catch { /* Analysis is complete; semantic suggestions are best effort. */ }
      }
    } catch (error) {
      await ctx.runMutation(internal.ai.state.failAnalysis, { ...args, errorCode: providerErrorCode(error) });
    }
  },
});
