import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import campusMap from "@/imports/iitd-campus-map.jpg.jpeg";
import { ZoneTelemetryEditor } from "./ZoneTelemetryEditor";
import { AIWorkspace } from "./AIWorkspace";
import { ResponderRoster } from "./ResponderRoster";
import { AgentPipelineVisualizer } from "./AgentPipelineVisualizer";

interface AgentCommandCenterProps {
  eventId: Id<"events">;
  role: "organizer" | "staff" | "attendee";
  mapUrl?: string | null;
  onSwitchToMap?: () => void;
}

type CommandSection = "overview" | "incidents" | "zones" | "routes" | "dispatch" | "analytics" | "ai";
type ViewMode = "split" | "map" | "console";
type MapLayerFilter = "all" | "incidents" | "zones" | "routes" | "responders";

interface SelectedEvidence {
  incidentCode: string;
  incidentType: string;
  severity: string;
  description: string;
  location: string;
  imageUrl?: string;
  imageAnalysis?: string;
  imageConfidence?: number;
  averageTrustScore?: number;
  verificationStatus: string;
  verificationReason?: string;
  contributingReports?: any[];
}

/**
 * Animated KPI Counter Component
 * Interpolates numeric changes smoothly with a refined ease-out curve.
 */
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    prevRef.current = value;
    if (start === end) return;

    const diff = end - start;
    const duration = 350;
    const startTime = performance.now();

    const frame = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + diff * eased));
      if (progress < 1) {
        requestAnimationFrame(frame);
      }
    };

    const handle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle);
  }, [value]);

  return <span>{display}</span>;
}

/**
 * Incident Lifecycle Timeline Bar
 * Refined step progression: Reported -> Classified -> Corroborated -> Verified -> Dispatched -> Resolved
 */
function IncidentLifecycleTimeline({
  incident,
  hasTasks,
}: {
  incident: any;
  hasTasks: boolean;
}) {
  const isVerified = incident.verificationStatus === "VERIFIED";
  const isCorroborated = incident.verificationStatus === "CORROBORATED" || isVerified;
  const isDispatched = hasTasks;
  const isResolved = incident.isResolved;

  const steps = [
    { label: "Report", done: true, agent: "Attendee" },
    { label: "Classified", done: true, agent: "Intake" },
    { label: "Corroborated", done: isCorroborated, agent: "Verification" },
    { label: "Verified", done: isVerified, agent: "Safety Gate" },
    { label: "Dispatched", done: isDispatched, agent: "Dispatch" },
    { label: "Resolved", done: isResolved, agent: "Control" },
  ];

  return (
    <div className="p-3 rounded-2xl bg-[#faf8f5] border border-[rgba(0,0,0,0.07)]">
      <div className="text-[11px] font-mono uppercase tracking-wider mb-2.5 flex items-center justify-between text-[#8a7f6e]">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-2 h-2 rounded-full bg-[#5b3ff8]" />
          Incident Lifecycle Stage
        </span>
        <span className="font-semibold text-[#5b3ff8]">
          {isResolved
            ? "Resolved"
            : isDispatched
              ? "Dispatched"
              : isVerified
                ? "Verified"
                : isCorroborated
                  ? "Corroborated"
                  : "Classified"}
        </span>
      </div>
      <div className="flex items-center justify-between relative px-1">
        <div className="absolute top-2.5 left-4 right-4 h-[2px] bg-[#e8e4dc] z-0" />
        {steps.map((st, idx) => (
          <div key={st.label} className="relative z-10 flex flex-col items-center">
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold transition-all ${st.done
                ? "bg-[#16a34a] text-white shadow-xs"
                : "bg-[#edeae4] text-[#8a7f6e] border border-[#ded7cb]"
                }`}
            >
              {st.done ? "✓" : idx + 1}
            </div>
            <span
              className={`text-[10px] mt-1 font-medium ${st.done ? "text-[#16a34a] font-semibold" : "text-[#8a7f6e]"
                }`}
            >
              {st.label}
            </span>
            <span className="text-[9px] font-mono text-[#a09585] hidden sm:block">
              {st.agent}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentCommandCenter({
  eventId,
  role,
  mapUrl,
  onSwitchToMap,
}: AgentCommandCenterProps) {
  const [section, setSection] = useState<CommandSection>("overview");
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [logSearch, setLogSearch] = useState<string>("");
  const [isSimulating, setIsSimulating] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<{ id: Id<"routeRecommendations">; message: string } | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [evidenceModal, setEvidenceModal] = useState<SelectedEvidence | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [mapLayer, setMapLayer] = useState<MapLayerFilter>("all");

  // Map pan and zoom state
  const [mapScale, setMapScale] = useState(1);
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });
  const mapDragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Queries
  const agentLogs = useQuery(api.agents.queries.listAgentLogs, { eventId, limit: 150 });
  const incidents = useQuery(api.agents.queries.listIncidents, { eventId });
  const zones = useQuery(api.agents.queries.listZonesWithRisk, { eventId });
  const routes = useQuery(api.agents.queries.listActiveRoutes, { eventId });
  const responders = useQuery(api.agents.queries.listResponders, { eventId });
  const dispatchTasks = useQuery(api.agents.queries.listDispatchTasks, { eventId });
  const analyticsData = useQuery(api.agents.queries.getIncidentAnalytics, { eventId });
  const auditExportData = useQuery(api.agents.queries.exportAuditTrail, { eventId });

  const recommendedVolunteers = zones?.reduce((total, zone) => total + zone.volunteerShortfall, 0) ?? 0;
  const risingZones = zones?.filter((zone) => zone.flowTrend === "increasing") ?? [];
  const availableResponders = responders?.filter((responder) => responder.isAvailable && !responder.currentTaskId).length ?? 0;

  // Mutations
  const triggerSimulation = useMutation(api.simulation.triggerGate3Simulation);
  const ensureZones = useMutation(api.simulation.ensureZones);
  const verifyIncident = useMutation(api.simulation.verifyIncidentByStaff);
  const resolveIncident = useMutation(api.agents.queries.resolveIncident);
  const approveRoute = useMutation(api.agents.queries.approveRoute);
  const updateTaskStatus = useMutation(api.agents.queries.updateTaskStatus);

  useEffect(() => {
    void ensureZones({ eventId }).catch(() => {
      // The zones query remains available if the event is being closed or the session expires.
    });
  }, [ensureZones, eventId]);

  // Auto-scroll log terminal
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = 0;
    }
  }, [agentLogs, autoScroll]);

  // Simulation runner
  const handleSimulate = async () => {
    try {
      setIsSimulating(true);
      setActionSuccess("Multi-Report Crisis Simulation Initiated: 4 staged incidents with autonomous agent deliberation.");

      await triggerSimulation({ eventId });

      setTimeout(() => {
        setIsSimulating(false);
      }, 55000); // Duration of the 4-report stream sequence
    } catch (err: any) {
      alert("Error starting simulation: " + err.message);
      setIsSimulating(false);
    }
  };

  const handleVerify = async (incidentId: Id<"incidents">) => {
    try {
      await verifyIncident({ incidentId });
      setActionSuccess("Staff verification recorded; response policy reevaluating.");
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      alert("Verification failed: " + err.message);
    }
  };

  const handleResolve = async (incidentId: Id<"incidents">) => {
    try {
      await resolveIncident({ incidentId });
      setActionSuccess("Incident marked resolved.");
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      alert("Failed to resolve: " + err.message);
    }
  };

  const handleApproveRoute = async (recId: Id<"routeRecommendations">) => {
    setRouteError(null);
    try {
      await approveRoute({ recommendationId: recId });
      setActionSuccess("Capacity-checked route approved for guidance.");
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: unknown) {
      const details = err instanceof Error ? err.message : "";
      const message = details.includes("VERIFIED")
        ? "Verify the linked incident before approving public guidance."
        : details.includes("expired") || details.includes("inactive")
          ? "This proposal expired. Update telemetry to calculate a fresh route."
          : details.includes("changed") || details.includes("capacity") || details.includes("safe")
            ? "Venue conditions changed. Reassess the corridor and calculate a fresh route."
            : "Approval failed. Review the incident and current venue conditions.";
      setRouteError({ id: recId, message });
    }
  };

  const handleUpdateTask = async (taskId: Id<"dispatchTasks">, status: any) => {
    try {
      await updateTaskStatus({ taskId, status });
      setActionSuccess(`Task status updated to ${status}.`);
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      alert("Task update failed: " + err.message);
    }
  };

  // CSV Export Engine
  const handleExportCSV = () => {
    if (!auditExportData || auditExportData.length === 0) {
      alert("No audit records available to export.");
      return;
    }

    const headers = [
      "Timestamp",
      "ISO_Time",
      "Agent",
      "Tool",
      "Level",
      "IncidentCode",
      "IncidentType",
      "Severity",
      "VerificationStatus",
      "InputSummary",
      "OutputSummary",
    ];

    const rows = auditExportData.map((row) => [
      row.timestamp,
      row.timeISO,
      row.agent,
      row.tool,
      row.level,
      row.incidentCode,
      row.incidentType,
      row.severity,
      row.verificationStatus,
      `"${row.input}"`,
      `"${row.output}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `eventpulse_audit_trail_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // JSON Export Engine
  const handleExportJSON = () => {
    if (!auditExportData || auditExportData.length === 0) {
      alert("No audit records available to export.");
      return;
    }
    const jsonStr = JSON.stringify(auditExportData, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `eventpulse_audit_trail_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered logs
  const filteredLogs = useMemo(() => {
    if (!agentLogs) return [];
    return agentLogs.filter((log) => {
      const matchesAgent = agentFilter === "all" || log.agentName === agentFilter;
      const matchesSearch =
        !logSearch ||
        log.toolName.toLowerCase().includes(logSearch.toLowerCase()) ||
        log.inputSummary.toLowerCase().includes(logSearch.toLowerCase()) ||
        log.outputSummary.toLowerCase().includes(logSearch.toLowerCase());
      return matchesAgent && matchesSearch;
    });
  }, [agentLogs, agentFilter, logSearch]);

  // Statistics
  const activeIncidents = useMemo(() => {
    return (incidents ?? []).filter((i) => !i.isResolved);
  }, [incidents]);

  const verifiedCount = useMemo(() => {
    return activeIncidents.filter((i) => i.verificationStatus === "VERIFIED").length;
  }, [activeIncidents]);

  const corroboratedCount = useMemo(() => {
    return activeIncidents.filter((i) => i.verificationStatus === "CORROBORATED").length;
  }, [activeIncidents]);

  const peakRiskZone = useMemo(() => {
    if (!zones || zones.length === 0) return null;
    return [...zones].sort((a, b) => b.riskScore - a.riskScore)[0];
  }, [zones]);

  const activeRespondersCount = useMemo(() => {
    return (responders ?? []).filter((r) => !r.isAvailable).length;
  }, [responders]);

  // Map mouse dragging
  const handleMapMouseDown = (e: React.MouseEvent) => {
    mapDragRef.current = { startX: e.clientX, startY: e.clientY, ox: mapOffset.x, oy: mapOffset.y };
  };

  const handleMapMouseMove = (e: React.MouseEvent) => {
    if (!mapDragRef.current) return;
    const dx = e.clientX - mapDragRef.current.startX;
    const dy = e.clientY - mapDragRef.current.startY;
    setMapOffset({ x: mapDragRef.current.ox + dx, y: mapDragRef.current.oy + dy });
  };

  const handleMapMouseUp = () => {
    mapDragRef.current = null;
  };

  // Badges aligned with EventPulse palette
  const getAgentBadge = (agent: string) => {
    switch (agent) {
      case "intake":
        return { label: "1. Intake", bg: "bg-blue-50 text-blue-700 border-blue-200" };
      case "verification":
        return { label: "2. Verification", bg: "bg-emerald-50 text-emerald-700 border-emerald-200" };
      case "crowd_intel":
        return { label: "3. Crowd Intel", bg: "bg-amber-50 text-amber-700 border-amber-200" };
      case "routing":
        return { label: "4. Routing", bg: "bg-purple-50 text-purple-700 border-purple-200" };
      case "dispatch":
        return { label: "5. Dispatch", bg: "bg-rose-50 text-rose-700 border-rose-200" };
      case "safety":
        return { label: "Safety Rules", bg: "bg-orange-50 text-orange-700 border-orange-200" };
      default:
        return { label: "Orchestrator", bg: "bg-[#5b3ff8]/10 text-[#5b3ff8] border-[#5b3ff8]/25" };
    }
  };

  const getLevelBadge = (level: string) => {
    switch (level) {
      case "action":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "warn":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "error":
        return "bg-rose-50 text-rose-700 border-rose-200";
      default:
        return "bg-blue-50 text-blue-700 border-blue-200";
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#f5f1ea] text-[#1a1917] font-sans overflow-hidden select-none">
      {/* ─── Top Operational Header ─── */}
      <header className="flex-none px-4 py-3 sm:px-6 bg-[#faf8f5] border-b border-[rgba(0,0,0,0.08)] flex items-center justify-between gap-3 shadow-2xs z-20">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-[#5b3ff8] flex items-center justify-center text-white shadow-xs">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-[#1a1917] tracking-tight">
                Operations Command
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold bg-[#5b3ff8]/10 text-[#5b3ff8] border border-[#5b3ff8]/20">
                Live Console
              </span>
              <span className="hidden sm:inline-block text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-[#edeae4] text-[#6b6456] border border-[#ded7cb]">
                {role}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-[#16a34a] animate-pulse" />
              <p className="text-xs text-[#8a7f6e] font-normal">
                Multi-Agent Safety Pipeline · Dynamic Dijkstra Rerouting · Optional uploaded-photo analysis
              </p>
            </div>
          </div>
        </div>

        {/* Top Controls & Simulation Launcher */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* View Mode Segmented Control */}
          <div className="hidden md:flex items-center p-1 rounded-xl bg-[#ece7de] border border-[#ded7cb] text-xs">
            <button
              onClick={() => setViewMode("split")}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${viewMode === "split"
                ? "bg-white text-[#1a1917] shadow-xs font-semibold"
                : "text-[#6b6456] hover:text-[#1a1917]"
                }`}
            >
              Split View
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${viewMode === "map"
                ? "bg-white text-[#1a1917] shadow-xs font-semibold"
                : "text-[#6b6456] hover:text-[#1a1917]"
                }`}
            >
              Floor Plan
            </button>
            <button
              onClick={() => setViewMode("console")}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${viewMode === "console"
                ? "bg-white text-[#1a1917] shadow-xs font-semibold"
                : "text-[#6b6456] hover:text-[#1a1917]"
                }`}
            >
              Console
            </button>
          </div>

          {/* Guide Documentation Modal Button */}
          <button
            onClick={() => setIsGuideOpen(true)}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold text-[#5c5446] bg-white hover:text-[#1a1917] hover:bg-[#faf8f5] border border-[#ded7cb] transition cursor-pointer shadow-2xs flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <span>Architecture Guide</span>
          </button>

          {onSwitchToMap && (
            <button
              onClick={onSwitchToMap}
              className="px-3 py-1.5 rounded-xl text-xs font-medium text-[#5c5446] bg-white hover:text-[#1a1917] border border-[#ded7cb] transition cursor-pointer shadow-2xs"
            >
              Attendee Map
            </button>
          )}

          {/* Simulation Action Button */}
          <button
            onClick={handleSimulate}
            disabled={isSimulating}
            className="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-semibold text-white bg-[#5b3ff8] hover:bg-[#4d32e6] active:scale-95 transition shadow-xs disabled:opacity-50 flex items-center gap-2 cursor-pointer"
          >
            {isSimulating ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Simulating Surge Stream...</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>Simulate Surge Scenario</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* ─── 5-Agent Interactive Showcase Pipeline Visualizer ─── */}
      <AgentPipelineVisualizer
        eventId={eventId}
        onSimulateFull={handleSimulate}
        isSimulating={isSimulating}
      />

      {/* ─── Action & Notification Toast ─── */}
      {actionSuccess && (
        <div className="flex-none px-4 py-2 text-xs flex items-center justify-between bg-emerald-50 border-b border-emerald-200 text-emerald-900 shadow-2xs">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <span className="font-medium">{actionSuccess}</span>
          </div>
          <button
            onClick={() => setActionSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900 font-bold px-2 py-0.5 rounded cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* ─── Operational Telemetry Metric Tiles (5 KPI Cards) ─── */}
      <div className="flex-none px-4 py-2.5 sm:px-6 bg-[#f5f1ea] border-b border-[rgba(0,0,0,0.08)] grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <div className="p-3 rounded-2xl bg-white border border-[#ded7cb] shadow-2xs">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#8a7f6e] font-semibold">
            Active Incidents
          </div>
          <div className="text-xl font-bold font-mono mt-1 flex items-baseline gap-1.5 text-[#1a1917]">
            <AnimatedNumber value={activeIncidents.length} />
            <span className="text-[11px] font-sans font-normal text-[#8a7f6e]">
              ({verifiedCount} verified · {corroboratedCount} corroborated)
            </span>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-white border border-[#ded7cb] shadow-2xs">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#8a7f6e] font-semibold">
            Peak Venue Risk
          </div>
          <div className="text-xl font-bold font-mono mt-1 flex items-baseline gap-1.5">
            <span className={(peakRiskZone?.riskScore ?? 0) > 60 ? "text-[#dc2626]" : "text-[#d97706]"}>
              <AnimatedNumber value={peakRiskZone?.riskScore ?? 0} />%
            </span>
            <span className="text-[11px] font-sans font-normal text-[#8a7f6e] truncate">
              {peakRiskZone?.name ?? "Gate 3"} ({peakRiskZone?.currentOccupancy ?? 0}/{peakRiskZone?.capacity ?? 0})
            </span>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-white border border-[#ded7cb] shadow-2xs">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#8a7f6e] font-semibold">
            Vision Verified
          </div>
          <div className="text-xl font-bold font-mono mt-1 text-[#16a34a] flex items-baseline gap-1.5">
            <span>
              <AnimatedNumber value={activeIncidents.filter((i) => i.hasImageEvidence).length} /> / {activeIncidents.length}
            </span>
            <span className="text-[11px] font-sans font-normal text-[#8a7f6e]">
              CV matches
            </span>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-white border border-[#ded7cb] shadow-2xs">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#8a7f6e] font-semibold">
            Evacuation Corridors
          </div>
          <div className="text-xl font-bold font-mono mt-1 text-[#5b3ff8] flex items-baseline gap-1.5">
            <AnimatedNumber value={routes?.length ?? 0} />
            <span className="text-[11px] font-sans font-normal text-[#8a7f6e]">
              dynamic paths
            </span>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-white border border-[#ded7cb] shadow-2xs col-span-2 sm:col-span-1">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#8a7f6e] font-semibold">
            Deployed Units
          </div>
          <div className="text-xl font-bold font-mono mt-1 text-[#2563eb] flex items-baseline gap-1.5">
            <span>
              <AnimatedNumber value={activeRespondersCount} /> / {responders?.length ?? 0}
            </span>
            <span className="text-[11px] font-sans font-normal text-[#8a7f6e]">
              on scene
            </span>
          </div>
        </div>
      </div>

      {/* ─── Main Operations Body (Split View / Full Map / Console) ─── */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden relative">
        {/* ═══════════════════════════════════════════════════════════════════════
            LEFT STAGE: HIGH-PRECISION TACTICAL FLOOR PLAN
            ═══════════════════════════════════════════════════════════════════════ */}
        {(viewMode === "split" || viewMode === "map") && (
          <div
            className={`flex flex-col relative border-b lg:border-b-0 lg:border-r border-[#ded7cb] overflow-hidden bg-[#e8e4dc] ${viewMode === "map" ? "w-full flex-1" : "w-full lg:w-[54%] flex-1 min-h-[340px] lg:min-h-0"
              }`}
          >
            {/* Map Top Bar */}
            <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-2 pointer-events-auto bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-2xl border border-[#ded7cb] shadow-xs text-xs font-semibold text-[#1a1917]">
                <span className="w-2 h-2 rounded-full bg-[#16a34a] animate-pulse" />
                <span>Venue Floor Plan</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#f5f1ea] text-[#6b6456] border border-[#ded7cb]">
                  {zones?.length ?? 12} Zones · {activeIncidents.length} Incidents
                </span>
              </div>

              {/* Layer Toggles & Zoom Controls */}
              <div className="flex items-center gap-1.5 pointer-events-auto">
                <div className="hidden sm:flex items-center p-0.5 rounded-xl bg-white/95 backdrop-blur-md border border-[#ded7cb] shadow-xs text-xs">
                  {(["all", "incidents", "zones", "responders"] as MapLayerFilter[]).map((layer) => (
                    <button
                      key={layer}
                      onClick={() => setMapLayer(layer)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-mono uppercase font-semibold transition cursor-pointer ${mapLayer === layer
                        ? "bg-[#5b3ff8] text-white shadow-xs"
                        : "text-[#6b6456] hover:text-[#1a1917]"
                        }`}
                    >
                      {layer}
                    </button>
                  ))}
                </div>

                <div className="flex items-center p-0.5 rounded-xl bg-white/95 backdrop-blur-md border border-[#ded7cb] shadow-xs text-xs">
                  <button
                    onClick={() => setMapScale((s) => Math.min(3, s + 0.25))}
                    className="w-7 h-7 rounded-lg font-bold text-sm flex items-center justify-center hover:bg-[#ece7de] text-[#1a1917] transition cursor-pointer"
                    title="Zoom In"
                  >
                    +
                  </button>
                  <button
                    onClick={() => setMapScale((s) => Math.max(0.7, s - 0.25))}
                    className="w-7 h-7 rounded-lg font-bold text-sm flex items-center justify-center hover:bg-[#ece7de] text-[#1a1917] transition cursor-pointer"
                    title="Zoom Out"
                  >
                    −
                  </button>
                  <button
                    onClick={() => {
                      setMapScale(1);
                      setMapOffset({ x: 0, y: 0 });
                    }}
                    className="px-2 h-7 rounded-lg text-[10px] font-mono font-semibold flex items-center justify-center hover:bg-[#ece7de] text-[#6b6456] transition cursor-pointer"
                    title="Reset View"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>

            {/* Pannable & Zoomable Floor Plan Stage */}
            <div
              className="relative w-full h-full overflow-hidden cursor-grab active:cursor-grabbing bg-[#e8e4dc]"
              onMouseDown={handleMapMouseDown}
              onMouseMove={handleMapMouseMove}
              onMouseUp={handleMapMouseUp}
              onMouseLeave={handleMapMouseUp}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  transform: `translate(${mapOffset.x}px, ${mapOffset.y}px) scale(${mapScale})`,
                  transformOrigin: "center center",
                  transition: mapDragRef.current ? "none" : "transform 0.2s ease-out",
                }}
              >
                {/* Architectural Floor Plan Canvas */}
                <img
                  src={mapUrl ?? campusMap}
                  alt="Floor Plan"
                  className="w-full h-full object-contain select-none pointer-events-none"
                  draggable={false}
                />

                {/* SVG Vector Overlays: Corridors & Responder Vector Lines */}
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none z-10"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  {/* Dynamic Detour Paths (Routing Agent) */}
                  {(mapLayer === "all" || mapLayer === "routes") &&
                    routes &&
                    routes.map((rt) => {
                      let points = "";
                      try {
                        const ids: unknown = JSON.parse(rt.routePath);
                        if (Array.isArray(ids) && ids.every(id => typeof id === "string")) {
                          const coordinates = ids.map(id => {
                            const zone = zones?.find(z => z._id === id);
                            return zone ? `${zone.pinX},${zone.pinY}` : "";
                          });
                          if (coordinates.every(Boolean)) points = coordinates.join(" ");
                        }
                      } catch { /* Invalid historical paths are not drawn. */ }
                      return points ? <polyline key={rt._id} points={points} fill="none" stroke={rt.requiresApproval ? "#a16207" : "#16a34a"} strokeWidth="1.6" strokeDasharray={rt.requiresApproval ? "2,2" : undefined} /> : null;
                    })}

                  {/* Responder Trajectory Vectors */}
                  {(mapLayer === "all" || mapLayer === "responders") &&
                    dispatchTasks &&
                    dispatchTasks
                      .filter((t) => t.status === "en_route" || t.status === "accepted" || t.status === "pending")
                      .map((task) => {
                        const responder = responders?.find((r) => r._id === task.responderId);
                        const incident = incidents?.find((i) => i._id === task.incidentId);
                        if (!responder || !incident || responder.posX === undefined || responder.posY === undefined)
                          return null;
                        return (
                          <g key={`task-vec-${task._id}`}>
                            <line
                              x1={responder.posX}
                              y1={responder.posY}
                              x2={incident.pinX}
                              y2={incident.pinY}
                              stroke="#d97706"
                              strokeWidth="1.6"
                              strokeDasharray="2, 2"
                              className="animate-route-flow"
                            />
                            <circle cx={incident.pinX} cy={incident.pinY} r="1.8" fill="#d97706" />
                          </g>
                        );
                      })}
                </svg>

                {/* Heatmap Zone Badges */}
                {(mapLayer === "all" || mapLayer === "zones") &&
                  zones &&
                  zones.map((z) => {
                    const isHighRisk = z.riskScore > 60;
                    const isMediumRisk = z.riskScore > 30 && z.riskScore <= 60;
                    const badgeBg = isHighRisk ? "#dc2626" : isMediumRisk ? "#d97706" : "#16a34a";

                    return (
                      <div
                        key={z._id}
                        className="absolute pointer-events-auto cursor-pointer transition-transform hover:scale-105 z-15"
                        style={{
                          left: `${z.pinX}%`,
                          top: `${z.pinY}%`,
                          transform: `translate(-50%, -50%) scale(${1 / mapScale})`,
                        }}
                        onClick={() => setSection("zones")}
                      >
                        <div
                          className="flex flex-col items-center px-2 py-0.5 rounded-full shadow-md text-white font-mono text-[9px] font-bold border-2 border-white backdrop-blur-md"
                          style={{ backgroundColor: badgeBg }}
                        >
                          <span className="whitespace-nowrap">{z.name}</span>
                          <div className="flex items-center gap-1 text-[8px] opacity-95">
                            <span>{z.riskScore}% Risk</span>
                            <span>·</span>
                            <span>
                              {z.currentOccupancy}/{z.capacity}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                {/* Active Incident Beacons */}
                {(mapLayer === "all" || mapLayer === "incidents") &&
                  activeIncidents.map((inc) => {
                    const isVerified = inc.verificationStatus === "VERIFIED";
                    const isCritical = inc.severity === "critical";

                    return (
                      <div
                        key={inc._id}
                        className="absolute pointer-events-auto cursor-pointer transition-transform hover:scale-115 z-25"
                        style={{
                          left: `${inc.pinX}%`,
                          top: `${inc.pinY}%`,
                          transform: `translate(-50%, -100%) scale(${1 / mapScale})`,
                        }}
                        onClick={() => setEvidenceModal(inc)}
                      >
                        <div className="flex flex-col items-center">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs shadow-lg border-2 border-white text-white ${isCritical ? "bg-[#dc2626]" : "bg-[#ea580c]"
                              }`}
                          >
                            {inc.incidentType === "medical"
                              ? "✚"
                              : inc.incidentType === "fire"
                                ? "🔥"
                                : inc.incidentType === "stampede"
                                  ? "⚠️"
                                  : "🚨"}
                          </div>
                          <div className="mt-0.5 px-1.5 py-0.2 rounded-full bg-[#1a1917] text-white text-[9px] font-mono font-bold shadow-xs">
                            {inc.incidentCode}
                            {isVerified ? " ✓" : " ?"}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                {/* Emergency Responders */}
                {(mapLayer === "all" || mapLayer === "responders") &&
                  responders &&
                  responders.map((resp) => {
                    if (resp.posX === undefined || resp.posY === undefined) return null;
                    const respColor =
                      resp.responderType === "medical"
                        ? "#dc2626"
                        : resp.responderType === "fire"
                          ? "#ea580c"
                          : resp.responderType === "security"
                            ? "#2563eb"
                            : "#16a34a";

                    return (
                      <div
                        key={resp._id}
                        className="absolute pointer-events-auto cursor-pointer z-20 transition-transform hover:scale-115"
                        style={{
                          left: `${resp.posX}%`,
                          top: `${resp.posY}%`,
                          transform: `translate(-50%, -50%) scale(${1 / mapScale})`,
                        }}
                        title={`${resp.name ?? resp.responderType}: ${resp.isAvailable ? "Available" : "Dispatched"}`}
                        onClick={() => setSection("dispatch")}
                      >
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-white font-bold shadow-md border-2 border-white"
                          style={{ backgroundColor: respColor }}
                        >
                          {resp.responderType === "medical" ? "✚" : resp.responderType === "fire" ? "🔥" : "🛡"}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Bottom Map Legend Bar */}
            <div className="flex-none px-4 py-2 pb-16 lg:pb-2 bg-white/95 backdrop-blur-md border-t border-[#ded7cb] text-[10px] flex items-center justify-between flex-wrap gap-2 z-10 text-[#6b6456]">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#dc2626]" /> &gt;60% Critical
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#d97706]" /> 30-60% Moderate
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#16a34a]" /> Safe Zone
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-[#16a34a]" /> Dynamic Detour
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-[#d97706]" /> Assigned Vector
                </span>
              </div>
              <span className="font-mono text-[#8a7f6e] hidden sm:inline">
                Pan & Zoom enabled · Click markers to inspect
              </span>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            RIGHT STAGE: AGENT OPERATIONS CONSOLE
            ═══════════════════════════════════════════════════════════════════════ */}
        {(viewMode === "split" || viewMode === "console") && (
          <div
            className={`flex flex-col overflow-hidden bg-[#f5f1ea] ${viewMode === "console" ? "w-full flex-1" : "w-full lg:w-[46%] flex-1"
              }`}
          >
            {/* Console Navigation Tabs */}
            <div className="flex-none px-4 pt-2.5 sm:px-5 flex items-center gap-1 overflow-x-auto border-b border-[#ded7cb] pb-2 bg-[#ece7de]">
              {[
                { id: "overview", label: "Activity Log", count: filteredLogs.length },
                { id: "incidents", label: "Incidents", count: activeIncidents.length },
                { id: "zones", label: "Crowd Risk", count: zones?.length },
                { id: "routes", label: "Evacuation Corridors", count: routes?.length },
                { id: "dispatch", label: "Responders", count: dispatchTasks?.length },
                { id: "analytics", label: "Audit & Telemetry", count: undefined },
                { id: "ai", label: "AI & Venue Knowledge", count: undefined },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSection(tab.id as CommandSection)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 cursor-pointer ${section === tab.id
                    ? "bg-[#5b3ff8] text-white shadow-xs"
                    : "bg-white/80 text-[#6b6456] hover:bg-white hover:text-[#1a1917] border border-[#ded7cb]"
                    }`}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${section === tab.id
                        ? "bg-white/20 text-white font-bold"
                        : "bg-[#ece7de] text-[#7c7263]"
                        }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Console Content Panes */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 pb-24 lg:pb-4 space-y-3 custom-scrollbar">
              {section === "ai" && <AIWorkspace key={eventId} eventId={eventId} organizer={role === "organizer"} />}
              {/* TAB 1: REAL-TIME AGENT AUDIT LOG */}
              {section === "overview" && (
                <div className="space-y-2.5">
                  {/* Log Filters Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-2xl bg-white border border-[#ded7cb] shadow-2xs text-xs">
                    <div className="flex items-center gap-1 overflow-x-auto">
                      <span className="text-[10px] font-mono uppercase font-bold text-[#8a7f6e] mr-1">
                        Filter:
                      </span>
                      {["all", "intake", "verification", "crowd_intel", "routing", "dispatch"].map((agent) => (
                        <button
                          key={agent}
                          onClick={() => setAgentFilter(agent)}
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-mono uppercase transition cursor-pointer ${agentFilter === agent
                            ? "bg-[#5b3ff8] text-white font-semibold"
                            : "bg-[#f5f1ea] text-[#6b6456] hover:text-[#1a1917] border border-[#ded7cb]"
                            }`}
                        >
                          {agent === "crowd_intel" ? "Crowd" : agent}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Search logs..."
                        value={logSearch}
                        onChange={(e) => setLogSearch(e.target.value)}
                        className="px-2.5 py-1 rounded-xl text-xs bg-[#faf8f5] border border-[#ded7cb] text-[#1a1917] placeholder-[#a09585] focus:outline-none focus:border-[#5b3ff8] w-28 sm:w-36 font-sans"
                      />
                      <label className="flex items-center gap-1 text-[11px] text-[#6b6456] cursor-pointer font-sans">
                        <input
                          type="checkbox"
                          checked={autoScroll}
                          onChange={(e) => setAutoScroll(e.target.checked)}
                          className="rounded text-[#5b3ff8]"
                        />
                        <span>Auto-scroll</span>
                      </label>
                    </div>
                  </div>

                  {/* Clean Activity Feed Container */}
                  <div
                    ref={logsContainerRef}
                    className="rounded-2xl bg-white border border-[#ded7cb] overflow-y-auto max-h-[580px] divide-y divide-[#ece7de] shadow-2xs"
                  >
                    {filteredLogs.length === 0 ? (
                      <div className="p-8 text-center text-[#8a7f6e]">
                        <p className="text-sm font-medium">No activity recorded for this filter.</p>
                        <p className="text-xs mt-1 text-[#a09585]">
                          Run a simulation to generate live agent interactions.
                        </p>
                      </div>
                    ) : (
                      filteredLogs.map((log, idx) => {
                        const badge = getAgentBadge(log.agentName);
                        const levelCls = getLevelBadge(log.level);
                        const timeStr = new Date(log.createdAt).toLocaleTimeString();
                        const isLatest = idx === 0;

                        return (
                          <div
                            key={log._id}
                            className={`p-3 transition-colors flex flex-col gap-1.5 ${isLatest ? "bg-[#faf8f5] border-l-3 border-[#5b3ff8]" : "hover:bg-[#faf8f5]/60"
                              }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-[#8a7f6e]">{timeStr}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${badge.bg}`}>
                                  {badge.label}
                                </span>
                                <span className="font-mono text-xs font-semibold text-[#1a1917]">
                                  {log.toolName}
                                </span>
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono uppercase font-bold border ${levelCls}`}>
                                {log.level}
                              </span>
                            </div>

                            <div className="pl-3 border-l-2 border-[#e8e4dc] ml-1 text-xs space-y-0.5 font-sans">
                              <div className="text-[#8a7f6e] truncate">
                                <span className="font-mono text-[10px] text-[#a09585] uppercase">Input: </span>
                                {log.inputSummary}
                              </div>
                              <div className="text-[#1a1917] font-medium leading-relaxed">
                                <span className="font-mono text-[10px] text-[#5b3ff8] uppercase">Output: </span>
                                {log.outputSummary}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: INCIDENTS & EVIDENCE */}
              {section === "incidents" && (
                <div className="space-y-3 font-sans">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[#6b6456]">
                      Active Master Incidents ({activeIncidents.length})
                    </h2>
                    <span className="text-xs text-[#8a7f6e]">
                      Autonomous Triage & Verification
                    </span>
                  </div>

                  <div className="space-y-3">
                    {activeIncidents.length === 0 ? (
                      <div className="p-8 text-center rounded-2xl bg-white border border-[#ded7cb] text-[#8a7f6e]">
                        No active incidents in this view. Check telemetry and staff reports for current conditions.
                      </div>
                    ) : (
                      activeIncidents.map((inc) => {
                        const isVerified = inc.verificationStatus === "VERIFIED";
                        const isCorroborated = inc.verificationStatus === "CORROBORATED";
                        const avgTrust = inc.averageTrustScore ?? 60;
                        const hasLinkedTask = dispatchTasks?.some((t) =>
                          t.incidentId === inc._id && (t.purpose ?? "response") === "response"
                        ) ?? false;

                        return (
                          <div
                            key={inc._id}
                            className={`p-4 rounded-2xl bg-white border transition flex flex-col gap-3 shadow-2xs ${isVerified
                              ? "border-emerald-300 ring-1 ring-emerald-400/20"
                              : isCorroborated
                                ? "border-amber-300"
                                : "border-[#ded7cb]"
                              }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold font-mono text-[#1a1917]">
                                    {inc.incidentCode}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase font-bold border ${inc.severity === "critical"
                                      ? "bg-rose-50 text-rose-700 border-rose-200"
                                      : inc.severity === "high"
                                        ? "bg-orange-50 text-orange-700 border-orange-200"
                                        : "bg-amber-50 text-amber-700 border-amber-200"
                                      }`}
                                  >
                                    {inc.severity}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase font-semibold bg-[#edeae4] text-[#5c5446] border border-[#ded7cb]">
                                    {inc.incidentType}
                                  </span>
                                </div>
                                <div className="text-xs mt-1 text-[#6b6456] flex items-center gap-2">
                                  <span>📍 {inc.location}</span>
                                  <span>·</span>
                                  <span>{inc.independentSourceCount} independent source(s)</span>
                                </div>
                              </div>

                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase font-bold border ${isVerified
                                  ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                                  : isCorroborated
                                    ? "bg-amber-50 text-amber-800 border-amber-300"
                                    : "bg-slate-50 text-slate-700 border-slate-200"
                                  }`}
                              >
                                {inc.verificationStatus}
                              </span>
                            </div>

                            {/* Lifecycle Progress Bar */}
                            <IncidentLifecycleTimeline incident={inc} hasTasks={hasLinkedTask} />

                            {/* Photo Evidence Card */}
                            {inc.hasImageEvidence && inc.imageUrl && (
                              <div
                                className="flex items-center gap-3 p-2.5 rounded-2xl bg-[#faf8f5] border border-blue-200 hover:border-blue-400 transition cursor-pointer"
                                onClick={() => setEvidenceModal(inc)}
                              >
                                <img
                                  src={inc.imageUrl}
                                  alt="Incident Evidence"
                                  className="w-16 h-12 object-cover rounded-xl border border-[#ded7cb]"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                                      {inc.aiAnalysisId ? "AI observations available · staff verification applies" : "Photo attached · unverified evidence"}
                                    </span>
                                  </div>
                                  <p className="text-xs truncate mt-1 text-[#4a4235]">
                                    {inc.imageAnalysis ?? "Image not analyzed; staff review required."}
                                  </p>
                                </div>
                                <span className="text-xs text-[#5b3ff8] font-bold font-mono">
                                  Inspect →
                                </span>
                              </div>
                            )}

                            {/* Reporter Trust Gauge */}
                            <div className="p-2.5 rounded-xl bg-[#faf8f5] border border-[#ded7cb] flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <span className="text-sm">🛡️</span>
                                <div>
                                  <span className="text-[10px] font-mono uppercase font-semibold text-[#8a7f6e]">
                                    Reporter Trust Score:
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-[#1a1917]">
                                      {avgTrust}/100
                                    </span>
                                    <span className="text-[11px] text-[#8a7f6e]">
                                      ({avgTrust >= 80 ? "High Credibility" : "Community Verified"})
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="w-24 rounded-full h-1.5 bg-[#e8e4dc] overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${avgTrust >= 80 ? "bg-[#16a34a]" : avgTrust >= 50 ? "bg-[#d97706]" : "bg-[#dc2626]"
                                    }`}
                                  style={{ width: `${avgTrust}%` }}
                                />
                              </div>
                            </div>

                            <p className="text-xs leading-relaxed p-3 rounded-xl bg-[#faf8f5] border border-[#ded7cb] text-[#2e2a24]">
                              {inc.description}
                            </p>

                            {/* Operator Actions: Verification Gate & Resolve */}
                            {!inc.isResolved && isVerified && hasLinkedTask && (
                              <p className="text-xs leading-relaxed p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900">
                                When staff marks the response task completed, this verified incident is automatically resolved after all response tasks are finished. Verification visits do not close incidents.
                              </p>
                            )}
                            <div className="flex items-center justify-between pt-1 border-t border-[#ded7cb]">
                              <span className="text-[10px] font-mono text-[#8a7f6e]">
                                Reason: {inc.verificationReason ?? "Evaluating..."}
                              </span>

                              <div className="flex items-center gap-2">
                                {!isVerified && (
                                  <button
                                    onClick={() => handleVerify(inc._id)}
                                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-[#16a34a] hover:bg-[#15803d] transition cursor-pointer shadow-xs"
                                  >
                                    ✓ Verify as Staff
                                  </button>
                                )}
                                <button
                                  onClick={() => handleResolve(inc._id)}
                                  className="px-3 py-1.5 rounded-xl text-xs font-medium bg-[#ece7de] text-[#4a4235] hover:bg-[#ded7cb] border border-[#ded7cb] transition cursor-pointer"
                                >
                                  Resolve
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: CROWD RISK & ZONE TELEMETRY */}
              {section === "zones" && (
                <div className="space-y-3 font-sans">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[#6b6456]">
                      Crowd Density & Zone Risk ({zones?.length ?? 0})
                    </h2>
                    <span className="text-xs text-[#8a7f6e]">
                      Crowd Intelligence Agent
                    </span>
                  </div>

                  {zones && zones.length > 0 && (
                    <div className={`rounded-2xl border p-3 ${recommendedVolunteers > 0 && risingZones.length > 0 ? "border-amber-200 bg-amber-50" : "border-[#ded7cb] bg-white"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-[#8a7f6e]">Automatic mobilization</div>
                          <div className="mt-1 text-sm font-bold text-[#1a1917]">
                            {recommendedVolunteers > 0 ? `Assigning ${recommendedVolunteers} more volunteers / marshals` : "All required volunteer posts are covered"}
                          </div>
                          <p className="mt-1 text-[11px] text-[#6b6456]">
                            {risingZones.length > 0
                              ? `Increasing crowd pressure: ${risingZones.map((zone) => `${zone.name} (+${zone.netFlow}/min)`).join(", ")}`
                              : "No zone has an increasing flow trend right now."}
                          </p>
                        </div>
                        <div className="text-right text-[10px] text-[#6b6456]">
                          <span className="block uppercase tracking-wide text-[#8a7f6e]">Responder coverage</span>
                          <span className="font-mono font-semibold text-[#1a1917]">{availableResponders} available</span>
                          <span className="block">Assignments update automatically as risk and availability change</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {zones?.map((zone) => {
                      const isHigh = zone.riskScore >= 60;
                      const isMed = zone.riskScore > 30 && zone.riskScore <= 60;

                      return (
                        <div
                          key={zone._id}
                          className="p-3.5 rounded-2xl bg-white border border-[#ded7cb] space-y-2 shadow-2xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[#1a1917]">
                              {zone.name}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${isHigh
                                ? "bg-rose-50 text-rose-700 border-rose-200"
                                : isMed
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                }`}
                            >
                              {zone.riskScore}% Risk
                            </span>
                          </div>

                          <div className="space-y-1">
                            <div className="flex justify-between text-[11px] text-[#6b6456]">
                              <span>Occupancy:</span>
                              <span className="font-mono font-semibold text-[#1a1917]">
                                {zone.currentOccupancy} / {zone.capacity}
                              </span>
                            </div>
                            <div className="w-full rounded-full h-1.5 bg-[#e8e4dc] overflow-hidden">
                              <div
                                className={`h-full rounded-full ${isHigh ? "bg-[#dc2626]" : isMed ? "bg-[#d97706]" : "bg-[#16a34a]"
                                  }`}
                                style={{
                                  width: `${Math.min(100, Math.round((zone.currentOccupancy / (zone.capacity || 1)) * 100))}%`,
                                }}
                              />
                            </div>
                          </div>

                          <div className="text-[10px] font-mono text-[#8a7f6e] flex items-center justify-between pt-1">
                            <span>Flow: +{zone.inflowRate} / -{zone.outflowRate} per min</span>
                            <span className="font-bold">
                              {zone.telemetryStale || !zone.telemetryAt ? "DATA STALE" : isHigh ? "HIGH RISK" : isMed ? "MODERATE" : "LOWER RISK"}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 border-t border-[#eee9e1] pt-2 text-[10px]">
                            <div className="text-[#6b6456]">
                              <span className="block uppercase tracking-wide text-[#8a7f6e]">5-min forecast</span>
                              <span className="font-mono font-semibold text-[#1a1917]">
                                {zone.projectedOccupancy} people ({zone.projectedDensity}% capacity)
                              </span>
                            </div>
                            <div className="text-right text-[#6b6456]">
                              <span className="block uppercase tracking-wide text-[#8a7f6e]">Flow trend</span>
                              <span className="font-semibold text-[#1a1917]">
                                {zone.flowTrend} ({zone.netFlow > 0 ? "+" : ""}{zone.netFlow}/min)
                              </span>
                            </div>
                          </div>
                          <div className="border-t border-[#eee9e1] pt-2 text-[10px] text-[#6b6456]">
                            <span className="uppercase tracking-wide text-[#8a7f6e]">Volunteer posts</span>
                            <span className="ml-2 font-mono font-semibold text-[#1a1917]">{zone.assignedVolunteerCount} / {zone.additionalVolunteersNeeded} assigned</span>
                          </div>
                          {zone.riskFactors && (
                            <p className="text-[10px] leading-relaxed text-[#6b6456]">{zone.riskFactors}</p>
                          )}
                          {zone.volunteerShortfall > 0 && (
                            <div className="text-[10px] font-semibold text-rose-700">
                              Auto-assigning +{zone.volunteerShortfall} volunteers / marshals
                            </div>
                          )}
                          <ZoneTelemetryEditor zone={zone} organizer={role === "organizer"} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 4: EVACUATION ROUTES & DIJKSTRA CORRIDORS */}
              {section === "routes" && (
                <div className="space-y-3 font-sans">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[#6b6456]">
                      Dijkstra Evacuation Corridors ({routes?.length ?? 0})
                    </h2>
                    <span className="text-xs text-[#8a7f6e]">Routing Agent</span>
                  </div>

                  {routes && routes.length === 0 ? (
                    <div className="p-8 text-center rounded-2xl bg-white border border-[#ded7cb] text-[#8a7f6e]">
                      {zones?.some(zone => zone.telemetryStale || !zone.telemetryAt)
                        ? `${zones.filter(zone => zone.telemetryStale || !zone.telemetryAt).length} zones have stale telemetry. Confirm corridor and exit observations before routing.`
                        : "No active route is feasible or awaiting approval. Check the routing decisions in Activity Log."}
                    </div>
                  ) : (
                    routes?.map((rt) => (
                      <div
                        key={rt._id}
                        className="p-4 rounded-2xl bg-white border border-[#ded7cb] space-y-2.5 shadow-2xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#1a1917] flex items-center gap-1.5">
                            <span>🗺️</span>
                            <span>{rt.affectedZoneName}</span>
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                            {rt.isEvacuation ? "Emergency Evacuation" : "Dynamic Detour"}
                          </span>
                        </div>

                        <p className="text-xs p-3 rounded-xl bg-[#faf8f5] border border-[#ded7cb] text-[#2e2a24] leading-relaxed">
                          {rt.instruction}
                        </p>
                        <span className="text-[11px] font-semibold text-[#6b6456]">Wave capacity: {rt.plannedPeople ?? 1} people</span>

                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[11px] text-[#8a7f6e]">
                            {rt.requiresApproval
                              ? rt.approvalReady ? "Control-room approval required" : `${rt.incidentCode}: ${rt.incidentVerificationStatus} · verification required`
                              : "Active broadcast"}
                          </span>
                          {rt.requiresApproval && (
                            <div className="flex items-center gap-2">
                              {!rt.approvalReady && <button onClick={() => setSection("incidents")} className="text-xs font-semibold text-[#5b3ff8] underline">Review incident</button>}
                              <button
                                onClick={() => handleApproveRoute(rt._id)}
                                disabled={!rt.approvalReady}
                                title={!rt.approvalReady ? "Incident must be verified before public guidance" : "Approve this route for public guidance"}
                                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-[#5b3ff8] hover:bg-[#4d32e6] transition cursor-pointer shadow-xs disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Approve & Broadcast
                              </button>
                            </div>
                          )}
                        </div>
                        {routeError?.id === rt._id && <p role="alert" className="text-xs text-red-700">{routeError.message}</p>}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 5: RESPONDERS & DISPATCH */}
              {section === "dispatch" && (
                <div className="space-y-3 font-sans">
                  <ResponderRoster key={eventId} eventId={eventId} organizer={role === "organizer"} />
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[#6b6456]">
                      Responder Dispatch & Tasks ({dispatchTasks?.length ?? 0})
                    </h2>
                    <span className="text-xs text-[#8a7f6e]">Smart Dispatch Agent</span>
                  </div>

                  {dispatchTasks && dispatchTasks.length === 0 ? (
                    <div className="p-8 text-center rounded-2xl bg-white border border-[#ded7cb] text-[#8a7f6e]">
                      No dispatch tasks yet. Check the responder roster and Activity Log for availability and assignment outcomes.
                    </div>
                  ) : (
                    dispatchTasks?.map((task) => (
                      <div
                        key={task._id}
                        className="p-4 rounded-2xl bg-white border border-[#ded7cb] space-y-2.5 shadow-2xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold font-mono text-[#1a1917]">
                              Task #{task._id.slice(-4)}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${task.status === "completed"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : task.status === "en_route"
                                  ? "bg-blue-50 text-blue-700 border-blue-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                                }`}
                            >
                              {task.status}
                            </span>
                          </div>
                          <span className="text-xs font-mono text-[#8a7f6e]">
                            Estimated ETA: {task.estimatedEta !== undefined ? `${task.estimatedEta}s` : "unknown"} · {task.distanceMeters !== undefined ? `${task.distanceMeters}m` : "distance unknown"}
                          </span>
                        </div>

                        <p className="text-xs p-3 rounded-xl bg-[#faf8f5] border border-[#ded7cb] text-[#2e2a24]">
                          {task.instruction}
                        </p>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          {task.status === "pending" && (
                            <button
                              onClick={() => handleUpdateTask(task._id, "accepted")}
                              className="px-3 py-1 rounded-xl text-xs font-semibold text-white bg-[#2563eb] hover:bg-blue-600 cursor-pointer shadow-xs"
                            >
                              Accept Task
                            </button>
                          )}
                          {task.status === "accepted" && (
                            <button onClick={() => handleUpdateTask(task._id, "en_route")} className="px-3 py-1 rounded-xl text-xs font-semibold text-white bg-blue-600 cursor-pointer">Set En Route</button>
                          )}
                          {task.status === "en_route" && (
                            <button onClick={() => handleUpdateTask(task._id, "on_scene")} className="px-3 py-1 rounded-xl text-xs font-semibold text-white bg-blue-600 cursor-pointer">Mark On Scene</button>
                          )}
                          {task.status === "on_scene" && (
                            <button
                              onClick={() => handleUpdateTask(task._id, "completed")}
                              className="px-3 py-1 rounded-xl text-xs font-semibold text-white bg-[#16a34a] hover:bg-[#15803d] cursor-pointer shadow-xs"
                            >
                              Mark Completed
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 6: AUDIT TRAIL & TELEMETRY EXPORT */}
              {section === "analytics" && (
                <div className="space-y-4 font-sans">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[#6b6456]">
                        Audit Trail & Operational Metrics
                      </h2>
                      <p className="text-xs text-[#8a7f6e]">
                        Machine explainability, decision distribution, and post-event export.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleExportCSV}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-[#5b3ff8] hover:bg-[#4d32e6] transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>Export CSV</span>
                      </button>
                      <button
                        onClick={handleExportJSON}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold text-[#4a4235] bg-white hover:bg-[#ece7de] border border-[#ded7cb] transition cursor-pointer shadow-2xs"
                      >
                        <span>Export JSON</span>
                      </button>
                    </div>
                  </div>

                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3.5 rounded-2xl bg-white border border-[#ded7cb] shadow-2xs">
                      <div className="text-[10px] font-mono uppercase text-[#8a7f6e] font-semibold">Total Incidents</div>
                      <div className="text-lg font-bold font-mono mt-1 text-[#1a1917]">
                        <AnimatedNumber value={analyticsData?.totalIncidents ?? activeIncidents.length} />
                      </div>
                      <div className="text-[11px] text-[#16a34a] mt-0.5">
                        {analyticsData?.verifiedIncidents ?? verifiedCount} verified
                      </div>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-white border border-[#ded7cb] shadow-2xs">
                      <div className="text-[10px] font-mono uppercase text-[#8a7f6e] font-semibold">Avg Trust Score</div>
                      <div className="text-lg font-bold text-[#16a34a] font-mono mt-1">
                        <AnimatedNumber value={analyticsData?.avgTrustScore ?? 75} />/100
                      </div>
                      <div className="text-[11px] text-[#8a7f6e] mt-0.5">Community Weighting</div>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-white border border-[#ded7cb] shadow-2xs">
                      <div className="text-[10px] font-mono uppercase text-[#8a7f6e] font-semibold">Logged Decisions</div>
                      <div className="text-lg font-bold text-[#5b3ff8] font-mono mt-1">
                        <AnimatedNumber value={analyticsData?.totalAgentActions ?? (agentLogs?.length ?? 0)} />
                      </div>
                      <div className="text-[11px] text-[#8a7f6e] mt-0.5">Audit actions</div>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-white border border-[#ded7cb] shadow-2xs">
                      <div className="text-[10px] font-mono uppercase text-[#8a7f6e] font-semibold">Active Units</div>
                      <div className="text-lg font-bold text-[#d97706] font-mono mt-1">
                        <AnimatedNumber value={activeRespondersCount} /> / {responders?.length ?? 0}
                      </div>
                      <div className="text-[11px] text-[#8a7f6e] mt-0.5">Deployed responders</div>
                    </div>
                  </div>

                  {/* Incident Category Distribution */}
                  <div className="p-4 rounded-2xl bg-white border border-[#ded7cb] space-y-3 shadow-2xs">
                    <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#6b6456]">
                      Incident Breakdown by Category
                    </h3>
                    <div className="space-y-2.5">
                      {[
                        { key: "medical", label: "Medical Emergency", color: "bg-blue-500", count: analyticsData?.byType?.medical ?? 0 },
                        { key: "fire", label: "Fire / Smoke Hazard", color: "bg-red-500", count: analyticsData?.byType?.fire ?? 0 },
                        { key: "stampede", label: "Stampede & Crowd Surge", color: "bg-amber-500", count: analyticsData?.byType?.stampede ?? 0 },
                        { key: "security", label: "Security & Threat", color: "bg-purple-500", count: analyticsData?.byType?.security ?? 0 },
                        { key: "infrastructure", label: "Infrastructure / Barrier", color: "bg-cyan-500", count: analyticsData?.byType?.infrastructure ?? 0 },
                      ].map((cat) => {
                        const total = analyticsData?.totalIncidents || 1;
                        const pct = Math.round((cat.count / total) * 100);
                        return (
                          <div key={cat.key} className="space-y-1">
                            <div className="flex justify-between text-xs">
                              <span className="text-[#2e2a24] font-medium">{cat.label}</span>
                              <span className="font-mono text-[#8a7f6e]">
                                {cat.count} ({pct}%)
                              </span>
                            </div>
                            <div className="w-full rounded-full h-1.5 bg-[#e8e4dc] overflow-hidden">
                              <div
                                className={`h-full rounded-full ${cat.color}`}
                                style={{ width: `${Math.max(4, pct)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Agent Decision Frequency */}
                  <div className="p-4 rounded-2xl bg-white border border-[#ded7cb] space-y-3 shadow-2xs">
                    <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#6b6456]">
                      Agent Decision Volume
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                      {[
                        { name: "Intake", count: analyticsData?.agentActivity?.intake ?? 0, bg: "bg-blue-50 border-blue-200 text-blue-900" },
                        { name: "Verification", count: analyticsData?.agentActivity?.verification ?? 0, bg: "bg-emerald-50 border-emerald-200 text-emerald-900" },
                        { name: "Crowd Intel", count: analyticsData?.agentActivity?.crowd_intel ?? 0, bg: "bg-amber-50 border-amber-200 text-amber-900" },
                        { name: "Routing", count: analyticsData?.agentActivity?.routing ?? 0, bg: "bg-purple-50 border-purple-200 text-purple-900" },
                        { name: "Dispatch", count: analyticsData?.agentActivity?.dispatch ?? 0, bg: "bg-rose-50 border-rose-200 text-rose-900" },
                      ].map((item) => (
                        <div key={item.name} className={`p-3 rounded-xl border ${item.bg}`}>
                          <div className="text-base font-bold font-mono">{item.count}</div>
                          <div className="text-[10px] font-mono uppercase font-semibold mt-0.5">{item.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL: ARCHITECTURE & OPERATIONAL GUIDE
          ═══════════════════════════════════════════════════════════════════════ */}
      {isGuideOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs"
          onClick={() => setIsGuideOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-[28px] p-6 shadow-2xl space-y-5 bg-[#faf8f5] border border-[rgba(0,0,0,0.08)] text-[#1a1917] max-h-[88vh] overflow-y-auto custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#ded7cb] pb-4">
              <div>
                <h3 className="text-base font-bold text-[#1a1917]">
                  EventPulse Multi-Agent Safety Architecture
                </h3>
                <p className="text-xs text-[#8a7f6e] mt-0.5">
                  End-to-End Autonomous Incident Lifecycle with Human Safety Gates
                </p>
              </div>
              <button
                onClick={() => setIsGuideOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm bg-[#edeae4] text-[#6b6456] hover:bg-[#ded7cb] transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs leading-relaxed text-[#2e2a24]">
              <div className="p-3.5 rounded-2xl bg-white border border-[#ded7cb]">
                <h4 className="font-bold text-[#1a1917] text-sm mb-1">1. Intake & Multi-Modal Perception</h4>
                <p>
                  Attendee reports are ingested through deterministic text triage and image uploads. When an organizer enables AI enrichment and vision for the event, Agent 1 can send an eligible, registered photo with the report text to the configured vision model. Simulated showcase reports skip provider analysis; their example image URLs are display-only.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white border border-[#ded7cb]">
                <h4 className="font-bold text-[#1a1917] text-sm mb-1">2. Verification & Reporter Credibility</h4>
                <p>
                  The Verification Agent corroborates incoming reports across independent sources, cross-references historical reporter trust scores (+/- 0.2 weighting), and prevents spam or spoofed incident declarations.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white border border-[#ded7cb]">
                <h4 className="font-bold text-[#1a1917] text-sm mb-1">3. Dynamic Dijkstra Rerouting</h4>
                <p>
                  When a zone approaches critical risk or an active hazard is confirmed, the graph edge weight surges by +10. The Routing Agent recalculates optimal attendee detours away from congested or hazardous zones.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white border border-[#ded7cb]">
                <h4 className="font-bold text-[#1a1917] text-sm mb-1">4. Proximity Dispatch & Human Safety Gate</h4>
                <p>
                  Responders are dispatched based on proximity and role specialty (Medical, Fire, Security). Critical escalations require staff confirmation, ensuring deterministic human control over sensitive responses.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setIsGuideOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#1a1917] hover:bg-black transition cursor-pointer"
              >
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL: COMPUTER VISION EVIDENCE INSPECTOR
          ═══════════════════════════════════════════════════════════════════════ */}
      {evidenceModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs"
          onClick={() => setEvidenceModal(null)}
        >
          <div
            className="w-full max-w-xl rounded-[28px] p-6 shadow-2xl space-y-4 bg-[#faf8f5] border border-[rgba(0,0,0,0.08)] text-[#1a1917] max-h-[88vh] overflow-y-auto custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#ded7cb] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-base">📷</span>
                <h3 className="text-sm font-bold text-[#1a1917]">
                  Computer Vision & Evidence Inspector
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#5b3ff8]/10 text-[#5b3ff8] border border-[#5b3ff8]/20">
                  {evidenceModal.incidentCode}
                </span>
              </div>
              <button
                onClick={() => setEvidenceModal(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm bg-[#edeae4] text-[#6b6456] hover:bg-[#ded7cb] transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Photo Preview */}
            <div className="relative rounded-2xl overflow-hidden border border-[#ded7cb] max-h-72 bg-[#1a1917]">
              {evidenceModal.imageUrl ? (
                <img
                  src={evidenceModal.imageUrl}
                  alt="Incident Visual Evidence"
                  className="w-full h-full object-cover max-h-72"
                />
              ) : (
                <div className="p-12 text-center text-[#8a7f6e]">No photo attached to this report.</div>
              )}
              <div className="absolute top-3 left-3 bg-white/95 backdrop-blur-md px-2.5 py-1 rounded-xl text-xs font-mono font-semibold text-[#1a1917] border border-[#ded7cb]">
                Location: {evidenceModal.location}
              </div>
            </div>

            {/* AI Vision Analysis Details */}
            <div className="p-3.5 rounded-2xl bg-white border border-blue-200 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-blue-900">
                  Computer Vision Semantic Analysis:
                </span>
                <span className="font-mono text-emerald-700 font-bold">
                  Qualitative observations
                </span>
              </div>
              <p className="text-blue-950 leading-relaxed">
                {evidenceModal.imageAnalysis ??
                  "This image has not been analyzed, or its analysis was inconclusive. Attachment presence does not verify an incident."}
              </p>
            </div>

            {/* Reporter Credibility */}
            <div className="p-3.5 rounded-2xl bg-white border border-[#ded7cb] space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#1a1917]">
                  Reporter Credibility Rating:
                </span>
                <span className="font-mono font-bold text-emerald-700">
                  {evidenceModal.averageTrustScore ?? 0}/100
                </span>
              </div>
              <div className="w-full rounded-full h-1.5 bg-[#e8e4dc] overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${evidenceModal.averageTrustScore ?? 0}%` }}
                />
              </div>
              <p className="text-[11px] text-[#8a7f6e]">
                Reports from high-trust members with corroborating visual evidence receive automated priority triage.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setEvidenceModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#1a1917] text-white hover:bg-black transition cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
