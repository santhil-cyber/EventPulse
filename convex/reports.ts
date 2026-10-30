import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireMembership, requireRole } from "./lib/authz";
import { PRIORITY_ORDER, clampPercent, inferLocation } from "./lib/geo";
import { normalizedDescription } from "./lib/dedup";
import { priorityValidator } from "./schema";

const MODERATORS = ["ORGANIZER", "STAFF"] as const;
const MAX_REPORTS = 200;
const MAX_DESCRIPTION = 1000;

/**
 * Stored as the location of a report on a custom uploaded floor plan, where we
 * have no zone names to give. Deliberately neutral: it says only what we know
 * for certain -- that the reporter dropped a pin -- and implies no real place.
 * Occupies the same slot as a zone name, so cards lay out identically.
 */
const NO_ZONE = "Pinned on map";

/** The state machine. `resolved` is a flag, so a resolved report reads as "resolved". */
type ReportState = "pending" | "approved" | "rejected" | "resolved";
const LEGAL_TRANSITIONS: Record<ReportState, ReportState[]> = {
  pending: ["approved", "rejected"],
  approved: ["resolved"],
  rejected: [],
  resolved: [],
};

function stateOf(report: Doc<"reports">): ReportState {
  return report.resolved ? "resolved" : report.status;
}

function assertTransition(report: Doc<"reports">, to: ReportState) {
  const from = stateOf(report);
  if (!LEGAL_TRANSITIONS[from].includes(to)) {
    throw new Error(`A ${from} report cannot be moved to ${to}.`);
  }
}

/** Names and trust scores for the reporters in a page of reports. */
async function reporterIndex(ctx: QueryCtx, eventId: Id<"events">, reports: Doc<"reports">[]) {
  const index = new Map<
    Id<"users">,
    { name: string; trustScore: number; banned: boolean }
  >();
  for (const report of reports) {
    if (index.has(report.reporterId)) continue;
    const [user, membership] = await Promise.all([
      ctx.db.get("users", report.reporterId),
      ctx.db
        .query("memberships")
        .withIndex("by_event_user", (q) => q.eq("eventId", eventId).eq("userId", report.reporterId))
        .unique(),
    ]);
    index.set(report.reporterId, {
      name: user?.name ?? user?.email ?? "Unknown",
      trustScore: membership?.trustScore ?? 60,
      banned: membership?.isBanned ?? false,
    });
  }
  return index;
}

function shape(report: Doc<"reports">, who: { name: string; trustScore: number; banned: boolean }, callerId: Id<"users">) {
  return {
    id: report._id,
    author: who.name,
    authorTrustScore: who.trustScore,
    banned: who.banned,
    location: report.location,
    description: report.description,
    createdAt: report.createdAt,
    status: report.status,
    resolved: report.resolved,
    priority: report.priority,
    pinX: report.pinX,
    pinY: report.pinY,
    views: report.views,
    officialStatement: report.officialStatement,
    imageStorageId: report.imageStorageId,
    imageUrl: report.imageUrl,
    isMine: report.reporterId === callerId,
    reviewedByMe: report.reviewedBy === callerId,
    reviewedAt: report.reviewedAt,
  };
}

/** Collapse linked reports in the feed while retaining evidence in storage. */
async function collapseDuplicates(ctx: QueryCtx, reports: Doc<"reports">[]) {
  const seen = new Set<string>();
  const result: Doc<"reports">[] = [];
  for (const report of reports) {
    const link = await ctx.db.query("incidentReports").withIndex("by_report", q => q.eq("reportId", report._id)).first();
    // Keep separate moderation states and reporters: staff must still be able
    // to assess independent evidence and rejected reports individually.
    const key = link ? `${link.incidentId}:${report.reporterId}:${report.status}:${report.resolved}` : report._id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(report);
  }
  return result;
}

async function loadForModeration(ctx: MutationCtx, reportId: Id<"reports">) {
  const report = await ctx.db.get("reports", reportId);
  if (report === null) throw new Error("That report no longer exists.");
  const moderator = await requireRole(ctx, report.eventId, MODERATORS);
  return { report, moderator };
}

export const create = mutation({
  args: {
    eventId: v.id("events"),
    clientId: v.string(),
    description: v.string(),
    pinX: v.number(),
    pinY: v.number(),
    imageStorageId: v.optional(v.id("_storage")),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx, args.eventId);

    // Idempotency: the client mints one UUID per submission and retries with it,
    // so a double-tap or a retried mutation returns the first report, not a copy.
    const existing = await ctx.db
      .query("reports")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .unique();
    if (existing !== null) {
      if (existing.reporterId !== membership.userId || existing.eventId !== args.eventId) {
        throw new Error("That report id is already in use.");
      }
      return existing._id;
    }

    // Rate Limiting & Abuse Prevention (Section 9.7)
    // Prevent flooding: maximum 6 reports per user in any 60-second window
    const oneMinuteAgo = Date.now() - 60 * 1000;
    const recentUserReports = await ctx.db
      .query("reports")
      .withIndex("by_event_created", (q) =>
        q.eq("eventId", args.eventId).gte("createdAt", oneMinuteAgo),
      )
      .filter((q) => q.eq(q.field("reporterId"), membership.userId))
      .take(7);

    if (recentUserReports.length >= 6) {
      throw new Error("Report rate limit exceeded. Please wait a minute before submitting further reports.");
    }

    const description = args.description.trim();
    if (!description) throw new Error("Describe the issue before submitting.");
    if (description.length > MAX_DESCRIPTION) throw new Error("That description is too long.");

    const pinX = clampPercent(args.pinX, "pinX");
    const pinY = clampPercent(args.pinY, "pinY");

    // Zone names come from the bundled IIT Delhi campus map only. An event with
    // a custom uploaded floor plan has no zones we can name, so we name none --
    // a confident "IRD Hostel" on a shopping-mall plan is worse than no label.
    // pinX/pinY are exact either way, so the marker is unaffected.
    const event = await ctx.db.get("events", args.eventId);
    if (event === null) throw new Error("That event no longer exists.");
    const location = event.mapStorageId === undefined ? inferLocation(pinX, pinY) : NO_ZONE;

    if (!event.isActive) throw new Error("This event is no longer active.");
    // Resolve stored images server-side; browser blob URLs are never persisted.
    let imageUrl: string | undefined;
    if (args.imageStorageId) {
      const upload = await ctx.db.query("evidenceUploads").withIndex("by_storageId", q => q.eq("storageId", args.imageStorageId!)).unique();
      if (!upload || upload.eventId !== args.eventId || upload.uploaderId !== membership.userId) throw new Error("Upload this image for the current event before attaching it.");
      const metadata = await ctx.db.system.get("_storage", args.imageStorageId);
      if (!metadata || metadata.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(metadata.contentType ?? "")) throw new Error("Attach a JPEG, PNG or WebP image up to 5 MB.");
      imageUrl = (await ctx.storage.getUrl(args.imageStorageId)) ?? undefined;
    } else if (args.imageUrl?.startsWith("https://")) {
      // Legacy showcase photos can display, but external URLs are never sent to AI.
      imageUrl = args.imageUrl.slice(0, 2048);
    }

    // A new client UUID is minted when the form is submitted again. Check the
    // content transactionally too, including while the first intake is queued.
    const recentRepeats = await ctx.db.query("reports")
      .withIndex("by_event_reporter_createdAt", q => q.eq("eventId", args.eventId)
        .eq("reporterId", membership.userId).gte("createdAt", Date.now() - 60_000))
      .order("desc").take(6);
    const repeat = recentRepeats.find(r => !r.resolved && r.status !== "rejected"
      && normalizedDescription(r.description) === normalizedDescription(description)
      && Math.hypot(r.pinX - pinX, r.pinY - pinY) <= 2
      && r.imageStorageId === args.imageStorageId && (args.imageStorageId !== undefined || r.imageUrl === imageUrl));
    if (repeat) {
      const link = await ctx.db.query("incidentReports").withIndex("by_report", q => q.eq("reportId", repeat._id)).first();
      const incident = link ? await ctx.db.get("incidents", link.incidentId) : null;
      if (!incident?.isResolved) return repeat._id;
    }

    // Trusted reporters and event staff skip the moderation queue.
    const autoApprove =
      membership.role === "STAFF" || membership.role === "ORGANIZER" || membership.trustScore > 90;

    const reportId = await ctx.db.insert("reports", {
      eventId: args.eventId,
      reporterId: membership.userId,
      description,
      location,
      pinX,
      pinY,
      status: autoApprove ? "approved" : "pending",
      views: 0,
      resolved: false,
      clientId: args.clientId,
      imageStorageId: args.imageStorageId,
      imageUrl,
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.ai.semanticIntake.processNewReport, { reportId });

    return reportId;
  },
});

/**
 * Reports visible to the caller in this event. Moderators get everything.
 * Everyone else gets only APPROVED reports by non-banned reporters, plus their
 * OWN reports in every status (so "My Reports" can show a pending or rejected
 * report). Other people's pending reports never reach an attendee's device;
 * moderators see those through listForStaff.
 */
export const listForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx, args.eventId);
    const isModerator = membership.role === "ORGANIZER" || membership.role === "STAFF";

    const reports = await ctx.db
      .query("reports")
      .withIndex("by_event_created", (q) => q.eq("eventId", args.eventId))
      .order("desc")
      .take(MAX_REPORTS);

    const index = await reporterIndex(ctx, args.eventId, reports);
    const visible = [];
    for (const report of await collapseDuplicates(ctx, reports)) {
      const who = index.get(report.reporterId)!;
      const mine = report.reporterId === membership.userId;
      if (!isModerator && !mine && (report.status !== "approved" || who.banned)) continue;
      visible.push(shape(report, who, membership.userId));
    }
    return visible;
  },
});

/** Every report in the event, critical first. Moderators only. */
export const listForStaff = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const membership = await requireRole(ctx, args.eventId, MODERATORS);

    const reports = await ctx.db
      .query("reports")
      .withIndex("by_event_created", (q) => q.eq("eventId", args.eventId))
      .order("desc")
      .take(MAX_REPORTS);

    const index = await reporterIndex(ctx, args.eventId, reports);
    // Already newest-first; a stable sort by priority keeps that as the tiebreak.
    return (await collapseDuplicates(ctx, reports))
      .map((report) => shape(report, index.get(report.reporterId)!, membership.userId))
      .sort((a, b) => (PRIORITY_ORDER[a.priority ?? "low"] ?? 3) - (PRIORITY_ORDER[b.priority ?? "low"] ?? 3));
  },
});

export const updateStatus = mutation({
  args: {
    reportId: v.id("reports"),
    status: v.union(v.literal("approved"), v.literal("rejected"), v.literal("resolved")),
  },
  handler: async (ctx, args) => {
    const { report, moderator } = await loadForModeration(ctx, args.reportId);
    assertTransition(report, args.status);

    if (args.status === "resolved") {
      await ctx.db.patch("reports", report._id, { resolved: true });
      return null;
    }

    await ctx.db.patch("reports", report._id, {
      status: args.status,
      reviewedBy: moderator.userId,
      reviewedAt: Date.now(),
    });

    const incidentLink = await ctx.db.query("incidentReports").withIndex("by_report", q => q.eq("reportId", report._id)).first();
    if (incidentLink) await ctx.scheduler.runAfter(0, internal.orchestrator.onEvidenceUpdate, { incidentId: incidentLink.incidentId });

    if (args.status === "approved") {
      const reporter = await ctx.db
        .query("memberships")
        .withIndex("by_event_user", (q) =>
          q.eq("eventId", report.eventId).eq("userId", report.reporterId),
        )
        .unique();
      if (reporter !== null) {
        await ctx.db.patch("memberships", reporter._id, {
          trustScore: Math.min(100, reporter.trustScore + 5),
        });
      }
    } else if (args.status === "rejected") {
      // Abuse penalty: deduct 5 trust points for false/rejected reports (Section 9.7)
      const reporter = await ctx.db
        .query("memberships")
        .withIndex("by_event_user", (q) =>
          q.eq("eventId", report.eventId).eq("userId", report.reporterId),
        )
        .unique();
      if (reporter !== null) {
        await ctx.db.patch("memberships", reporter._id, {
          trustScore: Math.max(0, reporter.trustScore - 5),
        });
      }
    }
    return null;
  },
});

export const setPriority = mutation({
  args: { reportId: v.id("reports"), priority: priorityValidator },
  handler: async (ctx, args) => {
    const { report } = await loadForModeration(ctx, args.reportId);
    await ctx.db.patch("reports", report._id, { priority: args.priority });
    return null;
  },
});

/**
 * Mark critical and attach the statement broadcast to attendees. A pending
 * report is approved in the same step — that is the legal pending -> approved
 * transition. A rejected report cannot be resurrected this way.
 */
export const setCritical = mutation({
  args: { reportId: v.id("reports"), statement: v.string() },
  handler: async (ctx, args) => {
    const { report, moderator } = await loadForModeration(ctx, args.reportId);
    const statement = args.statement.trim();
    if (!statement) throw new Error("An official statement is required.");
    if (statement.length > MAX_DESCRIPTION) throw new Error("That statement is too long.");

    const state = stateOf(report);
    if (state === "rejected" || state === "resolved") {
      throw new Error(`A ${state} report cannot be marked critical.`);
    }

    await ctx.db.patch("reports", report._id, {
      priority: "critical",
      officialStatement: statement,
      status: "approved",
      reviewedBy: moderator.userId,
      reviewedAt: Date.now(),
    });
    return null;
  },
});

/** One view per member per report — the client keeps the "Seen" state. */
export const markViewed = mutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get("reports", args.reportId);
    if (report === null) throw new Error("That report no longer exists.");
    await requireMembership(ctx, report.eventId);
    await ctx.db.patch("reports", report._id, { views: report.views + 1 });
    return null;
  },
});

/** Ban the reporter from the event and reject the report that prompted it. */
export const banReporter = mutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const { report, moderator } = await loadForModeration(ctx, args.reportId);
    if (report.reporterId === moderator.userId) throw new Error("You cannot ban yourself.");

    const reporter = await ctx.db
      .query("memberships")
      .withIndex("by_event_user", (q) =>
        q.eq("eventId", report.eventId).eq("userId", report.reporterId),
      )
      .unique();
    if (reporter === null) throw new Error("That reporter is no longer in this event.");
    if (reporter.role === "ORGANIZER") throw new Error("The organizer cannot be banned.");

    await ctx.db.patch("memberships", reporter._id, { isBanned: true });
    if (stateOf(report) === "pending") {
      await ctx.db.patch("reports", report._id, {
        status: "rejected",
        reviewedBy: moderator.userId,
        reviewedAt: Date.now(),
      });
    }
    return null;
  },
});
