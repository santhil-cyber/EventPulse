import { v } from "convex/values";
import { internal } from "../_generated/api";
import { env, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { requireRole } from "../lib/authz";
import { aiLimits, aiPool } from "./resources";
import { enabled, STAFF } from "./state";
import { splitKnowledge, validateEmbedding, MAX_KNOWLEDGE_CHUNKS } from "./policy";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { vOnCompleteValidator } from "@convex-dev/workpool";
import { logAgentAction } from "../lib/agentLog";

export const retrievalScope = (eventId: string, model: string) => `${eventId}:${model}`;
const clean = (value: string, max: number) => { const s = value.trim(); if (!s || s.length > max) throw new Error(`Value must contain 1–${max} characters.`); return s; };

export const create = mutation({
  args: { eventId: v.id("events"), title: v.string(), source: v.string(), version: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, args.eventId, ["ORGANIZER"]);
    splitKnowledge(args.text);
    const title = clean(args.title, 160), source = clean(args.source, 240), version = clean(args.version, 80), text = args.text.trim();
    // Bounded storage quota with a clear error; do not silently drop documents.
    const docs = await ctx.db.query("knowledgeDocuments").withIndex("by_eventId_and_createdAt", q => q.eq("eventId", args.eventId)).take(101);
    if (docs.length >= 100) throw new Error("This event has reached its 100-document limit.");
    await aiLimits.limit(ctx, "document", { key: user.userId, throws: true });
    return ctx.db.insert("knowledgeDocuments", { eventId: args.eventId, title, source, version, text,
      contentHash: bytesToHex(sha256(new TextEncoder().encode(text))), createdBy: user.userId, createdAt: Date.now(), status: "draft", approved: false });
  },
});
export const list = query({
  args: { eventId: v.id("events") }, handler: async (ctx, { eventId }) => {
    await requireRole(ctx, eventId, STAFF);
    const rows = await ctx.db.query("knowledgeDocuments").withIndex("by_eventId_and_createdAt", q => q.eq("eventId", eventId)).order("desc").take(100);
    return rows.map(({ text: _text, ...row }) => row);
  },
});
export const preview = query({
  args: { documentId: v.id("knowledgeDocuments") }, handler: async (ctx, { documentId }) => {
    const row = await ctx.db.get("knowledgeDocuments", documentId);
    if (!row) throw new Error("Document not found.");
    await requireRole(ctx, row.eventId, STAFF);
    return row;
  },
});
export const index = mutation({
  args: { documentId: v.id("knowledgeDocuments") }, handler: async (ctx, { documentId }) => {
    const row = await ctx.db.get("knowledgeDocuments", documentId);
    if (!row) throw new Error("Document not found.");
    const user = await requireRole(ctx, row.eventId, ["ORGANIZER"]);
    if (row.status === "indexing") return;
    if (row.approved || row.status === "revoked") throw new Error("Create a new document version to replace approved or revoked content.");
    const config = await ctx.db.query("aiSettings").withIndex("by_eventId", q => q.eq("eventId", row.eventId)).unique();
    if (!enabled() || !config?.ragEnabled || !env.OPENAI_EMBEDDING_MODEL) throw new Error("Enable configured venue knowledge first.");
    await aiLimits.limit(ctx, "document", { key: user.userId, throws: true });
    await aiLimits.limit(ctx, "eventDay", { key: row.eventId, count: splitKnowledge(row.text).length, throws: true });
    const generation = (row.indexGeneration ?? 0) + 1;
    await ctx.db.patch("knowledgeDocuments", row._id, { status: "indexing", indexGeneration: generation, errorCode: undefined });
    await aiPool.enqueueAction(ctx, internal.ai.knowledgeActions.indexDocument, { documentId, generation }, { retry: false, onComplete: internal.ai.knowledge.indexCompleted, context: { documentId, generation } });
    await ctx.scheduler.runAfter(120_000, internal.ai.knowledge.expireIndex, { documentId, generation });
  },
});
export const indexContext = internalQuery({
  args: { documentId: v.id("knowledgeDocuments"), generation: v.number() }, handler: async (ctx, { documentId, generation }) => {
    const row = await ctx.db.get("knowledgeDocuments", documentId);
    if (!enabled() || !row || row.status !== "indexing" || row.indexGeneration !== generation) return null;
    const config = await ctx.db.query("aiSettings").withIndex("by_eventId", q => q.eq("eventId", row.eventId)).unique();
    return config?.ragEnabled ? row : null;
  },
});
export const commitIndex = internalMutation({
  args: { documentId: v.id("knowledgeDocuments"), generation: v.number(), model: v.string(), vectors: v.array(v.array(v.float64())) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("knowledgeDocuments", args.documentId);
    if (!row || row.status !== "indexing" || row.indexGeneration !== args.generation) return;
    const config = await ctx.db.query("aiSettings").withIndex("by_eventId", q => q.eq("eventId", row.eventId)).unique();
    if (!enabled() || !config?.ragEnabled || args.model !== env.OPENAI_EMBEDDING_MODEL) {
      await ctx.db.patch("knowledgeDocuments", row._id, { status: "failed", errorCode: "configuration_changed" }); return;
    }
    const texts = splitKnowledge(row.text);
    if (texts.length !== args.vectors.length) throw new Error("Embedding count mismatch.");
    args.vectors.forEach(validateEmbedding);
    const old = await ctx.db.query("knowledgeChunks").withIndex("by_documentId", q => q.eq("documentId", row._id)).take(MAX_KNOWLEDGE_CHUNKS + 1);
    for (const chunk of old) await ctx.db.delete("knowledgeChunks", chunk._id);
    for (let i = 0; i < texts.length; i++) await ctx.db.insert("knowledgeChunks", { eventId: row.eventId, documentId: row._id, ordinal: i, text: texts[i], embedding: args.vectors[i], model: args.model, retrievalScope: `draft:${row._id}` });
    await ctx.db.patch("knowledgeDocuments", row._id, { status: "ready", embeddingModel: args.model, errorCode: undefined });
  },
});
export const indexCompleted = internalMutation({
  args: vOnCompleteValidator(v.object({ documentId: v.id("knowledgeDocuments"), generation: v.number() })),
  handler: async (ctx, { context, result }) => {
    const row = await ctx.db.get("knowledgeDocuments", context.documentId);
    if (row?.status === "indexing" && row.indexGeneration === context.generation) await ctx.db.patch("knowledgeDocuments", row._id, { status: "failed", errorCode: result.kind === "canceled" ? "canceled" : "index_failed" });
  },
});
export const setApproval = mutation({
  args: { documentId: v.id("knowledgeDocuments"), approved: v.boolean() }, handler: async (ctx, { documentId, approved }) => {
    const row = await ctx.db.get("knowledgeDocuments", documentId);
    if (!row) throw new Error("Document not found.");
    const user = await requireRole(ctx, row.eventId, ["ORGANIZER"]);
    if (approved && (row.status !== "ready" || row.embeddingModel !== env.OPENAI_EMBEDDING_MODEL)) throw new Error("Index this document with the configured embedding model before approval.");
    // One active version per source. Revocation updates the vector filter atomically.
    const documents = await ctx.db.query("knowledgeDocuments").withIndex("by_eventId_and_createdAt", q => q.eq("eventId", row.eventId)).take(101);
    for (const doc of documents) {
      if (doc._id !== row._id && (!approved || doc.source !== row.source || !doc.approved)) continue;
      const active = doc._id === row._id && approved;
      const chunks = await ctx.db.query("knowledgeChunks").withIndex("by_documentId", q => q.eq("documentId", doc._id)).take(MAX_KNOWLEDGE_CHUNKS + 1);
      for (const chunk of chunks) await ctx.db.patch("knowledgeChunks", chunk._id, { retrievalScope: active ? retrievalScope(row.eventId, chunk.model) : `revoked:${doc._id}` });
      await ctx.db.patch("knowledgeDocuments", doc._id, { approved: active, status: active ? "ready" : "revoked", approvedBy: active ? user.userId : undefined, approvedAt: active ? Date.now() : undefined });
    }
    await logAgentAction(ctx, row.eventId, "orchestrator", "knowledge_approval", `${row.title} (${row.version})`, approved ? "Organizer approved document for event-scoped retrieval." : "Document revoked from retrieval.", "info");
  },
});
export const reserveQuestion = internalMutation({
  args: { eventId: v.id("events") }, handler: async (ctx, { eventId }) => {
    const member = await requireRole(ctx, eventId, STAFF);
    const event = await ctx.db.get("events", eventId);
    const config = await ctx.db.query("aiSettings").withIndex("by_eventId", q => q.eq("eventId", eventId)).unique();
    if (!event?.isActive || !enabled() || !config?.ragEnabled || !env.OPENAI_EMBEDDING_MODEL) throw new Error("Venue knowledge is not enabled for this event.");
    await aiLimits.limit(ctx, "question", { key: `${eventId}:${member.userId}`, throws: true });
    await aiLimits.limit(ctx, "eventMinute", { key: eventId, throws: true });
    await aiLimits.limit(ctx, "eventDay", { key: eventId, count: 2, throws: true });
    return { embeddingModel: env.OPENAI_EMBEDDING_MODEL, scope: retrievalScope(eventId, env.OPENAI_EMBEDDING_MODEL) };
  },
});
export const hydrate = internalQuery({
  args: { eventId: v.id("events"), model: v.string(), chunkIds: v.array(v.id("knowledgeChunks")) },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.eventId, STAFF);
    const config = await ctx.db.query("aiSettings").withIndex("by_eventId", q => q.eq("eventId", args.eventId)).unique();
    if (!enabled() || !config?.ragEnabled || args.model !== env.OPENAI_EMBEDDING_MODEL) return [];
    const sources = [];
    for (const id of [...new Set(args.chunkIds)].slice(0, 12)) {
      const chunk = await ctx.db.get("knowledgeChunks", id);
      if (!chunk || chunk.eventId !== args.eventId || chunk.model !== args.model || chunk.retrievalScope !== retrievalScope(args.eventId, args.model)) continue;
      const doc = await ctx.db.get("knowledgeDocuments", chunk.documentId);
      if (!doc || doc.eventId !== args.eventId || !doc.approved || doc.status !== "ready" || doc.embeddingModel !== args.model) continue;
      sources.push({ chunkId: chunk._id, documentId: doc._id, title: doc.title, source: doc.source, version: doc.version, section: chunk.ordinal + 1, text: chunk.text });
    }
    return sources;
  },
});

export const expireIndex = internalMutation({
  args: { documentId: v.id("knowledgeDocuments"), generation: v.number() },
  handler: async (ctx, { documentId, generation }) => {
    const row = await ctx.db.get("knowledgeDocuments", documentId);
    if (row?.status === "indexing" && row.indexGeneration === generation) await ctx.db.patch("knowledgeDocuments", documentId, { status: "failed", errorCode: "index_deadline_exceeded" });
  },
});
