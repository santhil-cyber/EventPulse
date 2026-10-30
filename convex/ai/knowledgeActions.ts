"use node";
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { embedTexts, selectCitations } from "./provider";
import { hasExactQuote, splitKnowledge } from "./policy";
import type { Id } from "../_generated/dataModel";

export const indexDocument = internalAction({
  args: { documentId: v.id("knowledgeDocuments"), generation: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.runQuery(internal.ai.knowledge.indexContext, args);
    if (!row) return;
    // A failed action is caught by workpool's terminal completion callback.
    const result = await embedTexts(splitKnowledge(row.text));
    await ctx.runMutation(internal.ai.knowledge.commitIndex, { ...args, vectors: result.vectors, model: result.model });
  },
});
type Source = { chunkId: Id<"knowledgeChunks">; documentId: Id<"knowledgeDocuments">; title: string; source: string; version: string; section: number; text: string };
type Answer = { status: "answered" | "abstained" | "unavailable"; message: string; citations: Array<Omit<Source, "text"> & { quote: string }> };
export const ask = action({
  args: { eventId: v.id("events"), question: v.string() },
  handler: async (ctx, { eventId, question }): Promise<Answer> => {
    const q = question.trim();
    if (!q || q.length > 1000) throw new Error("Ask a question of 1–1,000 characters.");
    // Authorization and budgets precede every external request.
    const config = await ctx.runMutation(internal.ai.knowledge.reserveQuestion, { eventId });
    try {
      const embedding = await embedTexts([q]);
      if (embedding.model !== config.embeddingModel) throw new Error("configuration_changed");
      const hits = await ctx.vectorSearch("knowledgeChunks", "by_embedding", { vector: embedding.vectors[0], limit: 8, filter: f => f.eq("retrievalScope", config.scope) });
      const sources: Source[] = await ctx.runQuery(internal.ai.knowledge.hydrate, { eventId, model: embedding.model, chunkIds: hits.filter(h => h._score >= 0.25).map(h => h._id) });
      if (!sources.length) return { status: "abstained", message: "No approved venue source supports an answer.", citations: [] };
      const answer = await selectCitations(q, sources);
      if (answer.abstain || !answer.citations.length) return { status: "abstained", message: "The approved documents do not provide a supported answer.", citations: [] };
      const selected = answer.citations.map(c => {
        const source = sources.find(s => s.chunkId === c.chunkId);
        if (!source || !hasExactQuote(source.text, c.quote)) throw new Error("unsupported_citation");
        return { source, quote: c.quote };
      });
      // Check revocation, current permissions, mode and model again after generation.
      const current: Source[] = await ctx.runQuery(internal.ai.knowledge.hydrate, { eventId, model: embedding.model, chunkIds: selected.map(c => c.source.chunkId) });
      if (selected.some(c => !current.some(s => s.chunkId === c.source.chunkId && s.version === c.source.version && hasExactQuote(s.text, c.quote)))) return { status: "abstained", message: "Sources changed during this request. Ask again for current guidance.", citations: [] };
      const seen = new Set<string>();
      const citations = selected.filter(c => { const key = `${c.source.chunkId}:${c.quote}`; if (seen.has(key)) return false; seen.add(key); return true; }).map(({ source: { text: _text, ...source }, quote }) => ({ ...source, quote }));
      return { status: "answered", message: "Relevant excerpts from approved venue documents. These do not describe live conditions or authorize action.", citations };
    } catch {
      return { status: "unavailable", message: "Venue knowledge is temporarily unavailable. Use approved procedures and contact event control.", citations: [] };
    }
  },
});
