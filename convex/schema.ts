import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { aiMode, analysisOutput, analysisStatus } from "./ai/validators";

/** Role lives on the membership document — never on the client, never on the user. */
export const roleValidator = v.union(
  v.literal("ORGANIZER"),
  v.literal("STAFF"),
  v.literal("ATTENDEE"),
);

export const reportStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);

export const priorityValidator = v.union(
  v.literal("critical"),
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);

// ─────────────────────────────────────────────────────────────────────────────
// Agentic AI validators — used by agent tool functions and the orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export const incidentTypeValidator = v.union(
  v.literal("medical"),
  v.literal("fire"),
  v.literal("security"),
  v.literal("stampede"),
  v.literal("infrastructure"),
  v.literal("other"),
);

export const verificationStatusValidator = v.union(
  v.literal("UNVERIFIED"),
  v.literal("CORROBORATED"),
  v.literal("VERIFIED"),
);

export const severityValidator = v.union(
  v.literal("critical"),
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);

export const zoneTypeValidator = v.union(
  v.literal("gate"),
  v.literal("corridor"),
  v.literal("open_area"),
  v.literal("stage"),
  v.literal("exit"),
  v.literal("medical_post"),
  v.literal("other"),
);

export const responderTypeValidator = v.union(
  v.literal("security"),
  v.literal("medical"),
  v.literal("fire"),
  v.literal("volunteer"),
  v.literal("general"),
);

export const dispatchStatusValidator = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("en_route"),
  v.literal("on_scene"),
  v.literal("completed"),
  v.literal("rejected"),
  v.literal("escalated"),
  v.literal("canceled"),
);

export const agentNameValidator = v.union(
  v.literal("intake"),
  v.literal("verification"),
  v.literal("crowd_intel"),
  v.literal("routing"),
  v.literal("dispatch"),
  v.literal("orchestrator"),
  v.literal("safety"),
);

export default defineSchema({
  // Convex Auth owns `users`, `authAccounts`, `authSessions`, … — extend, never duplicate.
  ...authTables,

  events: defineTable({
    name: v.string(),
    venue: v.string(),
    date: v.string(),
    // Last calendar day of the event, "YYYY-MM-DD". Absent means single-day,
    // i.e. the same as `date`. An event is one continuous range from startTime
    // to endTime, live overnight included.
    endDate: v.optional(v.string()),
    // ms timestamps. Optional: events created before these existed have none.
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    // Plain text, at most 2,000 words / 20,000 characters (events.create).
    // Optional: events created before this existed have none.
    description: v.optional(v.string()),
    organizerId: v.id("users"),
    attendeeCode: v.string(),
    staffCode: v.string(),
    mapStorageId: v.optional(v.id("_storage")),
    mapWidth: v.optional(v.number()),
    mapHeight: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
    incidentSequence: v.optional(v.number()),
  })
    .index("by_attendeeCode", ["attendeeCode"])
    .index("by_staffCode", ["staffCode"])
    .index("by_organizer", ["organizerId"]),

  memberships: defineTable({
    eventId: v.id("events"),
    userId: v.id("users"),
    role: roleValidator,
    isBanned: v.boolean(),
    trustScore: v.number(),
    joinedAt: v.number(),
    // When the member last opened this event. The newest one is the active
    // event. Optional: memberships written before this field existed have none
    // and sort after every membership that has one.
    lastOpenedAt: v.optional(v.number()),
    responderRegistered: v.optional(v.boolean()),
  })
    .index("by_event_user", ["eventId", "userId"])
    .index("by_event_role", ["eventId", "role"])
    .index("by_user", ["userId"])
    .index("by_user_lastOpenedAt", ["userId", "lastOpenedAt"]),

  reports: defineTable({
    eventId: v.id("events"),
    reporterId: v.id("users"),
    description: v.string(),
    location: v.string(),
    // Percentages 0-100 of the floor-map extent. Never 0-1.
    pinX: v.number(),
    pinY: v.number(),
    status: reportStatusValidator,
    // Absent until a moderator sets one — a brand-new report shows no chip,
    // exactly as the reference UI renders it.
    priority: v.optional(priorityValidator),
    views: v.number(),
    resolved: v.boolean(),
    officialStatement: v.optional(v.string()),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    clientId: v.string(),
    isSimulated: v.optional(v.boolean()),
    imageStorageId: v.optional(v.id("_storage")),
    imageUrl: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_event_created", ["eventId", "createdAt"])
    .index("by_clientId", ["clientId"]),

  mapPins: defineTable({
    eventId: v.id("events"),
    emoji: v.string(),
    label: v.string(),
    // Percentages 0-100, same convention as reports.
    x: v.number(),
    y: v.number(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_event", ["eventId"]),

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENTIC AI TABLES — Multi-agent incident response system
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Master incidents — deduplicated from individual reports by the Intake
   * Agent. One incident may have many contributing reports linked via the
   * incidentReports join table.
   */
  incidents: defineTable({
    eventId: v.id("events"),
    /** Human-readable code like "INC-001". */
    incidentCode: v.string(),
    /** Merged description from all contributing reports. */
    description: v.string(),
    location: v.string(),
    pinX: v.number(),
    pinY: v.number(),
    incidentType: incidentTypeValidator,
    /** Verification lifecycle: UNVERIFIED → CORROBORATED → VERIFIED. */
    verificationStatus: verificationStatusValidator,
    verificationReason: v.optional(v.string()),
    severity: severityValidator,
    /** Count of truly independent reporters (not copies). */
    independentSourceCount: v.number(),
    staffVerificationRequested: v.boolean(),
    staffVerifiedBy: v.optional(v.id("users")),
    staffVerifiedAt: v.optional(v.number()),
    isResolved: v.boolean(),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.id("users")),
    hasImageEvidence: v.optional(v.boolean()),
    imageStorageId: v.optional(v.id("_storage")),
    imageUrl: v.optional(v.string()),
    imageAnalysis: v.optional(v.string()),
    imageConfidence: v.optional(v.number()),
    averageTrustScore: v.optional(v.number()),
    aiSummary: v.optional(v.string()),
    aiAnalysisId: v.optional(v.id("aiAnalyses")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_event_created", ["eventId", "createdAt"])
    .index("by_event_status", ["eventId", "verificationStatus"])
    .index("by_incidentCode", ["incidentCode"]),

  /**
   * Join table linking incidents to their contributing reports. Lets us
   * trace every report back to the master incident it was merged into.
   */
  incidentReports: defineTable({
    incidentId: v.id("incidents"),
    reportId: v.id("reports"),
    /** True for the report that originally created this incident. */
    isOriginal: v.boolean(),
    /** Similarity score from deduplication matching (0-1). */
    similarityScore: v.number(),
    addedAt: v.number(),
  })
    .index("by_incident", ["incidentId"])
    .index("by_report", ["reportId"]),

  /**
   * Venue zones with live crowd data. The Crowd Intelligence Agent reads
   * and writes occupancy, flow rates, and risk scores here.
   */
  zones: defineTable({
    eventId: v.id("events"),
    name: v.string(),
    /** Zone centre for display on the map (percentage 0-100). */
    pinX: v.number(),
    pinY: v.number(),
    capacity: v.number(),
    currentOccupancy: v.number(),
    /** People per minute entering / leaving the zone. */
    inflowRate: v.number(),
    outflowRate: v.number(),
    /** Composite risk score computed by the Crowd Intelligence Agent (0-100). */
    riskScore: v.number(),
    /** JSON string listing the top risk contributors. */
    riskFactors: v.optional(v.string()),
    zoneType: zoneTypeValidator,
    exitBlocked: v.boolean(),
    isNarrowPassage: v.boolean(),
    updatedAt: v.number(),
    telemetryAt: v.optional(v.number()),
    telemetrySource: v.optional(v.union(v.literal("manual"), v.literal("sensor"), v.literal("simulation"))),
    telemetryStale: v.optional(v.boolean()),
    isAssemblyPoint: v.optional(v.boolean()),
    isDesignatedEgress: v.optional(v.boolean()),
  })
    .index("by_event", ["eventId"])
    .index("by_event_risk", ["eventId", "riskScore"]),

  /**
   * Edges of the venue graph. Nodes are zones; edges carry dynamic weights
   * that the Routing Agent updates based on congestion and risk.
   */
  venueEdges: defineTable({
    eventId: v.id("events"),
    fromZoneId: v.id("zones"),
    toZoneId: v.id("zones"),
    /** Walking time in seconds under uncongested conditions. */
    baseWeight: v.number(),
    /** Current weight after factoring congestion + risk. */
    currentWeight: v.number(),
    /** People the corridor can move per minute. */
    corridorCapacity: v.number(),
    isPassable: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_from", ["fromZoneId"]),

  /**
   * Route recommendations generated by the Routing Agent. Evacuation
   * routes require control-room approval before public broadcast.
   */
  routeRecommendations: defineTable({
    eventId: v.id("events"),
    incidentId: v.optional(v.id("incidents")),
    affectedZoneId: v.id("zones"),
    /** JSON array of zone IDs forming the path. */
    routePath: v.string(),
    /** Maximum people assigned to this one-minute guidance wave. */
    plannedPeople: v.optional(v.number()),
    /** Human-readable guidance text. */
    instruction: v.string(),
    isEvacuation: v.boolean(),
    requiresApproval: v.boolean(),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
    graphFingerprint: v.optional(v.string()),
  })
    .index("by_event_active", ["eventId", "isActive"])
    .index("by_incident", ["incidentId"]),

  /**
   * Responder profiles — staff who have been registered for dispatch.
   * Position is zone-based; precise pinX/pinY is for the demo map.
   */
  responders: defineTable({
    eventId: v.id("events"),
    userId: v.id("users"),
    membershipId: v.id("memberships"),
    responderType: responderTypeValidator,
    currentZoneId: v.optional(v.id("zones")),
    /** Zone post assigned automatically by Crowd Intelligence when risk requires coverage. */
    assignmentZoneId: v.optional(v.id("zones")),
    assignmentAssignedAt: v.optional(v.number()),
    /** Simulated precise map position for the demo overlay. */
    posX: v.optional(v.number()),
    posY: v.optional(v.number()),
    isAvailable: v.boolean(),
    currentTaskId: v.optional(v.id("dispatchTasks")),
    hasFirstAid: v.boolean(),
    hasFireTraining: v.boolean(),
    /** Display name cached from the user doc for quick reads. */
    name: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_event_available", ["eventId", "isAvailable"])
    .index("by_user_event", ["userId", "eventId"]),

  /**
   * Dispatch tasks assigned to responders by Agent 5. Tracks the full
   * lifecycle from assignment through arrival to completion or escalation.
   */
  dispatchTasks: defineTable({
    eventId: v.id("events"),
    incidentId: v.id("incidents"),
    responderId: v.id("responders"),
    instruction: v.string(),
    status: dispatchStatusValidator,
    estimatedEta: v.optional(v.number()),
    distanceMeters: v.optional(v.number()),
    assignedAt: v.number(),
    acceptedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    escalatedToTaskId: v.optional(v.id("dispatchTasks")),
    isEmergencyDispatch: v.boolean(),
    purpose: v.optional(v.union(v.literal("verification"), v.literal("response"))),
    escalationCount: v.optional(v.number()),
    simulated: v.optional(v.boolean()),
    emergencyService: v.optional(v.union(
      v.literal("ambulance"),
      v.literal("fire_brigade"),
      v.literal("police"),
    )),
  })
    .index("by_event", ["eventId"])
    .index("by_incident", ["incidentId"])
    .index("by_responder_status", ["responderId", "status"]),

  /**
   * Audit log of every agent tool call, state change, and safety decision.
   * The live-log dashboard reads this table with a reactive query.
   */
  agentLogs: defineTable({
    eventId: v.id("events"),
    agentName: agentNameValidator,
    toolName: v.string(),
    inputSummary: v.string(),
    outputSummary: v.string(),
    level: v.union(
      v.literal("info"),
      v.literal("warn"),
      v.literal("error"),
      v.literal("action"),
    ),
    incidentId: v.optional(v.id("incidents")),
    createdAt: v.number(),
  })
    .index("by_event_created", ["eventId", "createdAt"])
    .index("by_event_agent", ["eventId", "agentName"]),

  /**
   * Real-time tracker for individual agent pipeline executions.
   * Powers the visible step-by-step showcase for hackathons and control room displays.
   */
  evidenceUploads: defineTable({
    eventId: v.id("events"), uploaderId: v.id("users"), storageId: v.id("_storage"), createdAt: v.number(),
  }).index("by_storageId", ["storageId"]),

  aiSettings: defineTable({
    eventId: v.id("events"), mode: aiMode, visionEnabled: v.boolean(), ragEnabled: v.boolean(),
    updatedBy: v.id("users"), updatedAt: v.number(),
  }).index("by_eventId", ["eventId"]),

  aiAnalyses: defineTable({
    eventId: v.id("events"), reportId: v.id("reports"), incidentId: v.id("incidents"),
    version: v.string(), promptVersion: v.string(), mode: aiMode, status: analysisStatus,
    queuedAt: v.optional(v.number()), attempts: v.number(), inputHash: v.string(), model: v.optional(v.string()), output: v.optional(analysisOutput),
    imageAnalyzed: v.boolean(), errorCode: v.optional(v.string()),
    inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()),
    createdAt: v.number(), startedAt: v.optional(v.number()), completedAt: v.optional(v.number()),
  }).index("by_reportId_and_version", ["reportId", "version"])
    .index("by_eventId_and_createdAt", ["eventId", "createdAt"]),

  reportEmbeddings: defineTable({
    eventId: v.id("events"), reportId: v.id("reports"), incidentId: v.id("incidents"),
    embedding: v.array(v.float64()), model: v.string(), createdAt: v.number(),
  }).index("by_reportId", ["reportId"]).vectorIndex("by_embedding", {
    vectorField: "embedding", dimensions: 1536, filterFields: ["eventId"],
  }),

  duplicateSuggestions: defineTable({
    eventId: v.id("events"), analysisId: v.id("aiAnalyses"),
    incidentId: v.id("incidents"), candidateId: v.id("incidents"), score: v.number(),
    status: v.union(v.literal("pending"), v.literal("dismissed")), createdAt: v.number(),
  }).index("by_eventId_and_status", ["eventId", "status"])
    .index("by_analysisId", ["analysisId"]),

  knowledgeDocuments: defineTable({
    eventId: v.id("events"), title: v.string(), source: v.string(), version: v.string(),
    text: v.string(), contentHash: v.string(), createdBy: v.id("users"), createdAt: v.number(),
    status: v.union(v.literal("draft"), v.literal("indexing"), v.literal("ready"), v.literal("failed"), v.literal("revoked")),
    approved: v.boolean(), approvedBy: v.optional(v.id("users")), approvedAt: v.optional(v.number()),
    indexGeneration: v.optional(v.number()),
    embeddingModel: v.optional(v.string()), errorCode: v.optional(v.string()),
  }).index("by_eventId_and_createdAt", ["eventId", "createdAt"]),

  knowledgeChunks: defineTable({
    eventId: v.id("events"), documentId: v.id("knowledgeDocuments"), ordinal: v.number(),
    text: v.string(), embedding: v.array(v.float64()), model: v.string(), retrievalScope: v.string(),
  }).index("by_documentId", ["documentId"]).vectorIndex("by_embedding", {
    vectorField: "embedding", dimensions: 1536, filterFields: ["retrievalScope"],
  }),

  pipelineRuns: defineTable({
    eventId: v.id("events"),
    incidentId: v.optional(v.id("incidents")),
    reportId: v.id("reports"),
    runCode: v.string(),
    activeAgent: v.union(
      v.literal("intake"),
      v.literal("verification"),
      v.literal("crowd_intel"),
      v.literal("routing"),
      v.literal("dispatch"),
      v.literal("completed"),
    ),
    agentPhase: v.union(
      v.literal("starting"),
      v.literal("thinking"),
      v.literal("tool_call"),
      v.literal("deciding"),
      v.literal("output"),
      v.literal("handoff"),
    ),
    currentThought: v.string(),
    currentTool: v.optional(v.string()),
    agentReasoning: v.optional(v.string()),
    agentTimestamps: v.string(), // JSON: Record<agentName, {startedAt, completedAt}>
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    dismissed: v.optional(v.boolean()),
    isDemo: v.optional(v.boolean()),
  })
    .index("by_event_status", ["eventId", "status"])
    .index("by_event_startedAt", ["eventId", "startedAt"])
    .index("by_reportId", ["reportId"]),
});
