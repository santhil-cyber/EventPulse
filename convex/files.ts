import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMembership, requireUser } from "./lib/authz";

/** Short-lived URL the browser POSTs the file to. Signed-in callers only. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const getFileUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const evidence = await ctx.db.query("evidenceUploads").withIndex("by_storageId", q => q.eq("storageId", args.storageId)).unique();
    if (evidence) await requireMembership(ctx, evidence.eventId);
    return await ctx.storage.getUrl(args.storageId);
  },
});

/** Register new report media with its event and uploader before attachment. */
export const registerEvidence = mutation({
  args: { eventId: v.id("events"), storageId: v.id("_storage") },
  handler: async (ctx, { eventId, storageId }) => {
    const member = await requireMembership(ctx, eventId);
    const meta = await ctx.db.system.get("_storage", storageId);
    if (!meta || meta.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(meta.contentType ?? "")) throw new Error("Invalid evidence image.");
    const existing = await ctx.db.query("evidenceUploads").withIndex("by_storageId", q => q.eq("storageId", storageId)).unique();
    if (existing) {
      if (existing.eventId !== eventId || existing.uploaderId !== member.userId) throw new Error("Image already belongs to another upload.");
      return;
    }
    // Storage IDs alone are unguessable capabilities, but old files must not be claimed as new.
    if (Date.now() - meta._creationTime > 10 * 60_000) throw new Error("Upload expired. Upload the image again.");
    await ctx.db.insert("evidenceUploads", { eventId, uploaderId: member.userId, storageId, createdAt: Date.now() });
  },
});
