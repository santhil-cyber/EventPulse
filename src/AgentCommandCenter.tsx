import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import campusMap from "@/imports/iitd-campus-map.jpg.jpeg";
import { AgentPipelineVisualizer } from "./AgentPipelineVisualizer";

interface AgentCommandCenterProps {
  eventId: Id<"events">;
  role: "organizer" | "staff" | "attendee";
  mapUrl?: string | null;
  onSwitchToMap?: () => void;
}

type CommandSection = "overview" | "incidents" | "zones" | "routes" | "dispatch" | "analytics";
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
 * Minimalist incident / responder glyphs. Replaces emoji markers with crisp
 * line icons that inherit currentColor, so they read on light and dark and in
 * white-on-accent map beacons alike.
 */
function TypeIcon({ type, size = 15 }: { type: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "medical":
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "fire":
      return <svg {...common}><path d="M12 2c1 3 4 4.5 4 8a4 4 0 0 1-8 0c0-1.3.5-2.3 1.2-3C9 9 10.5 7 12 2z" /></svg>;
    case "stampede":
      return <svg {...common}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>;
    case "security":
      return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
    default: // generic alert / siren
      return <svg {...common}><path d="M7 18v-6a5 5 0 1 1 10 0v6" /><path d="M5 21h14" /></svg>;
  }
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
    <div className="p-3 rounded-2xl bg-[var(--surface)] border border-[rgba(0,0,0,0.07)]">
      <div className="text-[11px] font-mono uppercase tracking-wider mb-2.5 flex items-center justify-between text-[color:var(--muted)]">
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
        <div className="absolute top-2.5 left-4 right-4 h-[2px] bg-[var(--bg)] z-0" />
        {steps.map((st, idx) => (
          <div key={st.label} className="relative z-10 flex flex-col items-center">
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold transition-all ${st.done
                ? "bg-[#16a34a] text-white shadow-xs"
                : "bg-[var(--surface-3)] text-[color:var(--muted)] border border-[color:var(--border)]"
                }`}
            >
              {st.done ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              ) : idx + 1}
            </div>
            <span
              className={`text-[10px] mt-1 font-medium ${st.done ? "text-[#16a34a] font-semibold" : "text-[color:var(--muted)]"
                }`}
            >
              {st.label}
            </span>
            <span className="text-[9px] font-mono text-[color:var(--muted-4)] hidden sm:block">
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
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [logSearch, setLogSearch] = useState<string>("");
  const [isSimulating, setIsSimulating] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [evidenceModal, setEvidenceModal] = useState<SelectedEvidence | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [mapLayer, setMapLayer] = useState<MapLayerFilter>("all");

  // Map pan and zoom state
  const [mapScale, setMapScale] = useState(1);
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });
  const mapDragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Mobile-first accordion panels (UI-only). Independent open/close; SIMULATE
  // is open by default so the pipeline is visible, and auto-opens on any run.
  const [openLogs, setOpenLogs] = useState(false);
  const [openSim, setOpenSim] = useState(true);
  const [openMap, setOpenMap] = useState(false);

  // Queries
  const agentLogs = useQuery(api.agents.queries.listAgentLogs, { eventId, limit: 150 });
  const incidents = useQuery(api.agents.queries.listIncidents, { eventId });
  const zones = useQuery(api.agents.queries.listZonesWithRisk, { eventId });
  const routes = useQuery(api.agents.queries.listActiveRoutes, { eventId });
  const responders = useQuery(api.agents.queries.listResponders, { eventId });
  const dispatchTasks = useQuery(api.agents.queries.listDispatchTasks, { eventId });
  const analyticsData = useQuery(api.agents.queries.getIncidentAnalytics, { eventId });
  const auditExportData = useQuery(api.agents.queries.exportAuditTrail, { eventId });

  // Mutations
  const triggerSimulation = useMutation(api.simulation.triggerGate3Simulation);
  const verifyIncident = useMutation(api.simulation.verifyIncidentByStaff);
  const resolveIncident = useMutation(api.agents.queries.resolveIncident);
  const approveRoute = useMutation(api.agents.queries.approveRoute);
  const updateTaskStatus = useMutation(api.agents.queries.updateTaskStatus);

  // Auto-scroll log terminal
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = 0;
    }
  }, [agentLogs, autoScroll]);

  // Simulation runner
  const handleSimulate = async () => {
    try {
      setOpenSim(true); // keep the thinking pipeline visible while it runs
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
      setActionSuccess("Incident verified by staff. Safety gate released.");
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
    try {
      await approveRoute({ recommendationId: recId });
      setActionSuccess("Evacuation detour route approved for attendee navigation.");
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      alert("Failed to approve route: " + err.message);
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
      "Timestamp", "ISO_Time", "Agent", "Tool", "Level", "IncidentCode",
      "IncidentType", "Severity", "VerificationStatus", "InputSummary", "OutputSummary",
    ];

    const rows = auditExportData.map((row) => [
      row.timestamp, row.timeISO, row.agent, row.tool, row.level, row.incidentCode,
      row.incidentType, row.severity, row.verificationStatus, `"${row.input}"`, `"${row.output}"`,
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
      case "intake": return { label: "1. Intake", bg: "bg-blue-50 text-blue-700 border-blue-200" };
      case "verification": return { label: "2. Verification", bg: "bg-emerald-50 text-emerald-700 border-emerald-200" };
      case "crowd_intel": return { label: "3. Crowd Intel", bg: "bg-amber-50 text-amber-700 border-amber-200" };
      case "routing": return { label: "4. Routing", bg: "bg-purple-50 text-purple-700 border-purple-200" };
      case "dispatch": return { label: "5. Dispatch", bg: "bg-rose-50 text-rose-700 border-rose-200" };
      case "safety": return { label: "Safety Rules", bg: "bg-orange-50 text-orange-700 border-orange-200" };
      default: return { label: "Orchestrator", bg: "bg-[#5b3ff8]/10 text-[#5b3ff8] border-[#5b3ff8]/25" };
    }
  };

  const getLevelBadge = (level: string) => {
    switch (level) {
      case "action": return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "warn": return "bg-amber-50 text-amber-700 border-amber-200";
      case "error": return "bg-rose-50 text-rose-700 border-rose-200";
      default: return "bg-blue-50 text-blue-700 border-blue-200";
    }
  };

  // Reusable accordion trigger — collapsed ~56px, animated chevron.
  const AccordionButton = ({ open, onClick, icon, label, badge, badgeTone = "muted" }: {
    open: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: React.ReactNode; badgeTone?: "muted" | "accent" | "green";
  }) => (
    <button
      onClick={onClick}
      aria-expanded={open}
      className="w-full rounded-2xl border border-[color:var(--border)] bg-[var(--surface)] px-5 py-4 flex items-center justify-between gap-3 cursor-pointer transition-colors duration-200 hover:border-[rgba(91,63,248,0.3)]"
    >
      <span className="flex items-center gap-2.5 min-w-0">
        <span className="shrink-0" style={{ color: "var(--muted)" }}>{icon}</span>
        <span className="text-sm font-bold truncate" style={{ color: "var(--ink)" }}>{label}</span>
        {badge !== undefined && (
          <span
            className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full shrink-0"
            style={
              badgeTone === "accent" ? { background: "rgba(91,63,248,0.12)", color: "var(--accent)" }
              : badgeTone === "green" ? { background: "rgba(22,163,74,0.14)", color: "#16a34a" }
              : { background: "var(--surface-2)", color: "var(--muted-2)" }
            }
          >
            {badge}
          </span>
        )}
      </span>
      <svg
        width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        className={`shrink-0 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        style={{ color: "var(--muted)" }}
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--cream)] text-[color:var(--ink)] font-sans custom-scrollbar">
      <div className="max-w-2xl mx-auto px-4 pt-4 pb-28 space-y-4">

        {/* ─── 1. Compact header ─── */}
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: "linear-gradient(145deg, #6b50fa 0%, #5b3ff8 55%, #4a2ee0 100%)", boxShadow: "0 4px 12px -4px rgba(91,63,248,0.55)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
            </div>
            <h1 className="text-base font-bold tracking-[-0.02em] truncate" style={{ color: "var(--ink)" }}>Operations Command</h1>
            <span className="cc-badge-live inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#5b3ff8]/8 text-[#5b3ff8] border border-[#5b3ff8]/15 shrink-0">
              <span className="cc-dot w-1.5 h-1.5 bg-[#5b3ff8]" style={{ ["--cc-ring" as any]: "rgba(91,63,248,0.4)" }} />
              Live
            </span>
            <span className="hidden sm:inline-block text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--ink)]/4 text-[color:var(--muted-2)] border border-[color:var(--border)] shrink-0">
              {role}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setIsGuideOpen(true)} className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-[color:var(--border)] bg-[var(--surface)] text-[color:var(--muted-3)] hover:text-[color:var(--ink)] transition cursor-pointer">
              Guide
            </button>
            {onSwitchToMap && (
              <button onClick={onSwitchToMap} className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-[color:var(--border)] bg-[var(--surface)] text-[color:var(--muted-3)] hover:text-[color:var(--ink)] transition cursor-pointer whitespace-nowrap">
                Attendee Map
              </button>
            )}
          </div>
        </header>

        {/* ─── Action & Notification Toast ─── */}
        {actionSuccess && (
          <div className="rounded-2xl px-4 py-2.5 text-xs flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 text-emerald-900">
            <div className="flex items-center gap-2 min-w-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 shrink-0"><path d="M20 6L9 17l-5-5" /></svg>
              <span className="font-medium">{actionSuccess}</span>
            </div>
            <button onClick={() => setActionSuccess(null)} className="text-emerald-700 hover:text-emerald-900 shrink-0 inline-flex items-center cursor-pointer" aria-label="Dismiss">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* ─── 1b. Top-priority RESULTS card (always visible) ─── */}
        <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--surface)] p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.12em] font-semibold mb-3" style={{ color: "var(--muted)" }}>
            Live Results &amp; Metrics
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[color:var(--border)] bg-[var(--cream)] p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--muted)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5b3ff8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
                Active Incidents
              </div>
              <div className="cc-tnum text-2xl font-bold mt-1 leading-none" style={{ color: "var(--ink)" }}><AnimatedNumber value={activeIncidents.length} /></div>
              <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>{verifiedCount} verified · {corroboratedCount} corroborated</div>
            </div>
            <div className="rounded-xl border border-[color:var(--border)] bg-[var(--cream)] p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--muted)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={(peakRiskZone?.riskScore ?? 0) > 60 ? "#dc2626" : "#d97706"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M3 17l6-6 4 4 7-7" /><path d="M17 7h4v4" /></svg>
                Peak Venue Risk
              </div>
              <div className={`cc-tnum text-2xl font-bold mt-1 leading-none ${(peakRiskZone?.riskScore ?? 0) > 60 ? "text-[#dc2626]" : "text-[#d97706]"}`}><AnimatedNumber value={peakRiskZone?.riskScore ?? 0} />%</div>
              <div className="text-[11px] mt-1 truncate" style={{ color: "var(--muted)" }}>{peakRiskZone?.name ?? "Gate 3"} ({peakRiskZone?.currentOccupancy ?? 0}/{peakRiskZone?.capacity ?? 0})</div>
            </div>
            <div className="rounded-xl border border-[color:var(--border)] bg-[var(--cream)] p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--muted)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                Vision Verified
              </div>
              <div className="cc-tnum text-2xl font-bold mt-1 leading-none text-[#16a34a]"><AnimatedNumber value={activeIncidents.filter((i) => i.hasImageEvidence).length} /><span style={{ color: "var(--muted)" }}> / {activeIncidents.length}</span></div>
              <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>CV matches</div>
            </div>
            <div className="rounded-xl border border-[color:var(--border)] bg-[var(--cream)] p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--muted)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5b3ff8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M9 18l6-6-6-6" /><path d="M3 12h12" /></svg>
                Evacuation Corridors
              </div>
              <div className="cc-tnum text-2xl font-bold mt-1 leading-none text-[#5b3ff8]"><AnimatedNumber value={routes?.length ?? 0} /></div>
              <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>dynamic paths</div>
            </div>
            <div className="col-span-2 rounded-xl border border-[color:var(--border)] bg-[var(--cream)] p-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--muted)" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>
                  Deployed Units
                </div>
                <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>on scene</div>
              </div>
              <div className="cc-tnum text-2xl font-bold leading-none text-[#2563eb]"><AnimatedNumber value={activeRespondersCount} /><span style={{ color: "var(--muted)" }}> / {responders?.length ?? 0}</span></div>
            </div>
          </div>
        </div>

        {/* ─── 2. VIEW LOGS accordion ─── */}
        <div>
          <AccordionButton
            open={openLogs}
            onClick={() => setOpenLogs((v) => !v)}
            label="View Logs"
            badgeTone="accent"
            badge={filteredLogs.length}
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>}
          />
          <div className="cc-acc" data-open={openLogs}>
            <div className="cc-acc-inner">
              <div className="mt-2 rounded-2xl border border-[color:var(--border)] bg-[var(--surface)] flex flex-col max-h-[550px]">
                {/* Console Navigation Tabs — Linear-style underline bar */}
                <div className="flex-none px-4 flex items-center gap-4 overflow-x-auto border-b border-[color:var(--border)] custom-scrollbar">
                  {[
                    { id: "overview", label: "Activity Log", count: filteredLogs.length },
                    { id: "incidents", label: "Incidents", count: activeIncidents.length },
                    { id: "zones", label: "Crowd Risk", count: zones?.length },
                    { id: "routes", label: "Evacuation Corridors", count: routes?.length },
                    { id: "dispatch", label: "Responders", count: dispatchTasks?.length },
                    { id: "analytics", label: "Audit & Telemetry", count: undefined },
                  ].map((tab) => {
                    const active = section === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setSection(tab.id as CommandSection)}
                        className="relative py-3 text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 cursor-pointer transition-colors duration-200 border-b-2"
                        style={{ color: active ? "var(--accent)" : "var(--muted-2)", borderColor: active ? "var(--accent)" : "transparent" }}
                      >
                        <span>{tab.label}</span>
                        {tab.count !== undefined && (
                          <span className="cc-tnum text-[10px] px-1.5 py-0.5 rounded-full font-mono leading-none font-bold" style={active ? { background: "rgba(91,63,248,0.12)", color: "var(--accent)" } : { background: "var(--surface-2)", color: "var(--muted-2)" }}>
                            {tab.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Console Content Panes */}
                <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 flex flex-col gap-3 custom-scrollbar">
                  {/* TAB 1: REAL-TIME AGENT AUDIT LOG */}
                  {section === "overview" && (
                    <div className="flex flex-col gap-2.5 h-full min-h-0">
                      {/* Log Filters Toolbar — single clean row */}
                      <div className="flex-none flex flex-wrap items-center justify-between gap-2 p-2 cc-card rounded-2xl text-xs">
                        <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar">
                          <span className="text-[10px] font-mono uppercase font-bold text-[color:var(--muted)] mr-1">Filter:</span>
                          {["all", "intake", "verification", "crowd_intel", "routing", "dispatch"].map((agent) => (
                            <button
                              key={agent}
                              onClick={() => setAgentFilter(agent)}
                              className={`px-2 py-0.5 rounded-lg text-[10px] font-mono uppercase transition cursor-pointer ${agentFilter === agent ? "bg-[#5b3ff8] text-white font-semibold" : "bg-[var(--cream)] text-[color:var(--muted-2)] hover:text-[color:var(--ink)] border border-[color:var(--border)]"}`}
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
                            className="px-2.5 py-1 rounded-xl text-xs bg-[var(--surface)] border border-[color:var(--border)] text-[color:var(--ink)] placeholder-[color:var(--muted-4)] focus:outline-none focus:border-[#5b3ff8] w-28 sm:w-36 font-sans"
                          />
                          <label className="flex items-center gap-1 text-[11px] text-[color:var(--muted-2)] cursor-pointer font-sans">
                            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="rounded text-[#5b3ff8]" />
                            <span>Auto-scroll</span>
                          </label>
                        </div>
                      </div>
                      {/* Clean Activity Feed Container */}
                      <div ref={logsContainerRef} className="cc-surface rounded-2xl flex-1 min-h-0 max-h-[360px] overflow-y-auto divide-y divide-[color:var(--border)] custom-scrollbar">
                        {filteredLogs.length === 0 ? (
                          <div className="p-8 text-center text-[color:var(--muted)]">
                            <p className="text-sm font-medium">No activity recorded for this filter.</p>
                            <p className="text-xs mt-1 text-[color:var(--muted-4)]">Run a simulation to generate live agent interactions.</p>
                          </div>
                        ) : (
                          filteredLogs.map((log, idx) => {
                            const badge = getAgentBadge(log.agentName);
                            const levelCls = getLevelBadge(log.level);
                            const timeStr = new Date(log.createdAt).toLocaleTimeString();
                            const isLatest = idx === 0;
                            return (
                              <div key={log._id} className={`p-3 transition-colors flex flex-col gap-1.5 ${isLatest ? "bg-[var(--surface)] border-l-3 border-[#5b3ff8]" : "hover:bg-[var(--surface)]/60"}`}>
                                <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-mono text-[color:var(--muted)]">{timeStr}</span>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${badge.bg}`}>{badge.label}</span>
                                    <span className="font-mono text-xs font-semibold text-[color:var(--ink)]">{log.toolName}</span>
                                  </div>
                                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono uppercase font-bold border ${levelCls}`}>{log.level}</span>
                                </div>
                                <div className="pl-3 border-l-2 border-[color:var(--border)] ml-1 text-xs space-y-0.5 font-sans">
                                  <div className="text-[color:var(--muted)] truncate"><span className="font-mono text-[10px] text-[color:var(--muted-4)] uppercase">Input: </span>{log.inputSummary}</div>
                                  <div className="text-[color:var(--ink)] font-medium leading-relaxed"><span className="font-mono text-[10px] text-[#5b3ff8] uppercase">Output: </span>{log.outputSummary}</div>
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
                        <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[color:var(--muted-2)]">Active Master Incidents ({activeIncidents.length})</h2>
                        <span className="text-xs text-[color:var(--muted)]">Autonomous Triage &amp; Verification</span>
                      </div>
                      <div className="space-y-3">
                        {activeIncidents.length === 0 ? (
                          <div className="cc-surface rounded-2xl p-8 text-center text-[color:var(--muted)]">No active safety incidents. All sectors clear.</div>
                        ) : (
                          activeIncidents.map((inc) => {
                            const isVerified = inc.verificationStatus === "VERIFIED";
                            const isCorroborated = inc.verificationStatus === "CORROBORATED";
                            const avgTrust = inc.averageTrustScore ?? 60;
                            const hasLinkedTask = dispatchTasks?.some((t) => t.incidentId === inc._id) ?? false;
                            return (
                              <div key={inc._id} className={`cc-card cc-rail cc-rise p-4 pl-[18px] flex flex-col gap-3 ${isVerified ? "ring-1 ring-emerald-400/20" : ""}`} style={{ ["--cc-rail" as any]: isVerified ? "#16a34a" : isCorroborated ? "#d97706" : inc.severity === "critical" ? "#dc2626" : "var(--muted)" }}>
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm font-bold font-mono text-[color:var(--ink)]">{inc.incidentCode}</span>
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase font-bold border ${inc.severity === "critical" ? "bg-rose-50 text-rose-700 border-rose-200" : inc.severity === "high" ? "bg-orange-50 text-orange-700 border-orange-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>{inc.severity}</span>
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase font-semibold bg-[var(--surface-3)] text-[color:var(--muted-3)] border border-[color:var(--border)]">{inc.incidentType}</span>
                                    </div>
                                    <div className="text-xs mt-1 flex items-center gap-2 flex-wrap" style={{ color: "var(--muted-2)" }}>
                                      <span className="inline-flex items-center gap-1">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>
                                        {inc.location}
                                      </span>
                                      <span>·</span>
                                      <span>{inc.independentSourceCount} independent source(s)</span>
                                    </div>
                                  </div>
                                  <span className={`cc-badge-live inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase font-bold border shrink-0 ${isVerified ? "bg-emerald-50 text-emerald-800 border-emerald-300" : isCorroborated ? "bg-amber-50 text-amber-800 border-amber-300" : "bg-slate-50 text-slate-700 border-slate-200"}`}>
                                    <span className="cc-dot w-1.5 h-1.5" style={{ background: isVerified ? "#16a34a" : isCorroborated ? "#d97706" : "#64748b", ["--cc-ring" as any]: isVerified ? "rgba(22,163,74,0.45)" : isCorroborated ? "rgba(217,119,6,0.45)" : "rgba(100,116,139,0.4)" }} />
                                    {inc.verificationStatus}
                                  </span>
                                </div>
                                <IncidentLifecycleTimeline incident={inc} hasTasks={hasLinkedTask} />
                                {inc.hasImageEvidence && inc.imageUrl && (
                                  <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-[var(--surface)] border border-blue-200 hover:border-blue-400 transition cursor-pointer" onClick={() => setEvidenceModal(inc)}>
                                    <img src={inc.imageUrl} alt="Incident Evidence" className="w-16 h-12 object-cover rounded-xl border border-[color:var(--border)]" />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">Computer Vision Verified ({inc.imageConfidence ?? 94}%)</span>
                                      </div>
                                      <p className="text-xs truncate mt-1 text-[color:var(--ink-softer)]">{inc.imageAnalysis ?? "Visual evidence matches semantic report criteria."}</p>
                                    </div>
                                    <span className="text-xs text-[#5b3ff8] font-bold font-mono inline-flex items-center gap-1">Inspect<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
                                  </div>
                                )}
                                <div className="p-2.5 rounded-xl border flex items-center justify-between text-xs" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                                  <div className="flex items-center gap-2">
                                    <span className="shrink-0" style={{ color: "var(--muted)" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg></span>
                                    <div>
                                      <span className="text-[10px] font-mono uppercase font-semibold" style={{ color: "var(--muted)" }}>Reporter Trust Score:</span>
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono font-bold text-[color:var(--ink)]">{avgTrust}/100</span>
                                        <span className="text-[11px] text-[color:var(--muted)]">({avgTrust >= 80 ? "High Credibility" : "Community Verified"})</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="w-24 rounded-full h-1.5 bg-[var(--bg)] overflow-hidden">
                                    <div className={`h-full rounded-full ${avgTrust >= 80 ? "bg-[#16a34a]" : avgTrust >= 50 ? "bg-[#d97706]" : "bg-[#dc2626]"}`} style={{ width: `${avgTrust}%` }} />
                                  </div>
                                </div>
                                <p className="text-xs leading-relaxed p-3 rounded-xl bg-[var(--surface)] border border-[color:var(--border)] text-[color:var(--ink-soft)]">{inc.description}</p>
                                <div className="flex items-center justify-between pt-1 border-t border-[color:var(--border)] gap-2 flex-wrap">
                                  <span className="text-[10px] font-mono text-[color:var(--muted)]">Reason: {inc.verificationReason ?? "Evaluating..."}</span>
                                  <div className="flex items-center gap-2">
                                    {!isVerified && (
                                      <button onClick={() => handleVerify(inc._id)} className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-[#16a34a] hover:bg-[#15803d] transition cursor-pointer shadow-xs">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="inline-block mr-1 -mt-0.5"><path d="M20 6 9 17l-5-5" /></svg>
                                        Verify as Staff
                                      </button>
                                    )}
                                    <button onClick={() => handleResolve(inc._id)} className="px-3 py-1.5 rounded-xl text-xs font-medium bg-[var(--surface-2)] text-[color:var(--ink-softer)] hover:bg-[var(--surface-3)] border border-[color:var(--border)] transition cursor-pointer">Resolve</button>
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
                        <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[color:var(--muted-2)]">Crowd Density &amp; Zone Risk ({zones?.length ?? 0})</h2>
                        <span className="text-xs text-[color:var(--muted)]">Crowd Intelligence Agent</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {zones?.map((zone) => {
                          const isHigh = zone.riskScore > 60;
                          const isMed = zone.riskScore > 30 && zone.riskScore <= 60;
                          return (
                            <div key={zone._id} className="cc-card p-3.5 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-[color:var(--ink)]">{zone.name}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${isHigh ? "bg-rose-50 text-rose-700 border-rose-200" : isMed ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>{zone.riskScore}% Risk</span>
                              </div>
                              <div className="space-y-1">
                                <div className="flex justify-between text-[11px] text-[color:var(--muted-2)]">
                                  <span>Occupancy:</span>
                                  <span className="font-mono font-semibold text-[color:var(--ink)]">{zone.currentOccupancy} / {zone.capacity}</span>
                                </div>
                                <div className="w-full rounded-full h-1.5 bg-[var(--bg)] overflow-hidden">
                                  <div className={`h-full rounded-full ${isHigh ? "bg-[#dc2626]" : isMed ? "bg-[#d97706]" : "bg-[#16a34a]"}`} style={{ width: `${Math.min(100, Math.round((zone.currentOccupancy / (zone.capacity || 1)) * 100))}%` }} />
                                </div>
                              </div>
                              <div className="text-[10px] font-mono text-[color:var(--muted)] flex items-center justify-between pt-1">
                                <span>Inflow: {zone.inflowRate}/min</span>
                                <span className="font-bold">{isHigh ? "SURGE CHOKEPOINT" : isMed ? "MODERATE" : "SAFE"}</span>
                              </div>
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
                        <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[color:var(--muted-2)]">Dijkstra Evacuation Corridors ({routes?.length ?? 0})</h2>
                        <span className="text-xs text-[color:var(--muted)]">Routing Agent</span>
                      </div>
                      {routes && routes.length === 0 ? (
                        <div className="cc-surface rounded-2xl p-8 text-center text-[color:var(--muted)]">No active evacuation reroutes. Standard corridors are unobstructed.</div>
                      ) : (
                        routes?.map((rt) => (
                          <div key={rt._id} className="cc-card p-4 space-y-2.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: "var(--ink)" }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--muted)" }}><circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" /></svg>
                                <span>{rt.affectedZoneName}</span>
                              </span>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-purple-50 text-purple-700 border border-purple-200">{rt.isEvacuation ? "Emergency Evacuation" : "Dynamic Detour"}</span>
                            </div>
                            <p className="text-xs p-3 rounded-xl border leading-relaxed" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--ink-soft)" }}>{rt.instruction}</p>
                            <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                              <span className="text-[11px] inline-flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                                {rt.requiresApproval ? (
                                  <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>Control Room Approval Required</>
                                ) : (
                                  <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>Active Broadcast</>
                                )}
                              </span>
                              {rt.requiresApproval && (
                                <button onClick={() => handleApproveRoute(rt._id)} className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-[#5b3ff8] hover:bg-[#4d32e6] transition cursor-pointer shadow-xs">Approve &amp; Broadcast</button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* TAB 5: RESPONDERS & DISPATCH */}
                  {section === "dispatch" && (
                    <div className="space-y-3 font-sans">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[color:var(--muted-2)]">Responder Dispatch &amp; Tasks ({dispatchTasks?.length ?? 0})</h2>
                        <span className="text-xs text-[color:var(--muted)]">Smart Dispatch Agent</span>
                      </div>
                      {dispatchTasks && dispatchTasks.length === 0 ? (
                        <div className="cc-surface rounded-2xl p-8 text-center text-[color:var(--muted)]">No active tasks. All responders on standby.</div>
                      ) : (
                        dispatchTasks?.map((task) => (
                          <div key={task._id} className="cc-card p-4 space-y-2.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold font-mono text-[color:var(--ink)]">Task #{task._id.slice(-4)}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${task.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : task.status === "en_route" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>{task.status}</span>
                              </div>
                              <span className="text-xs font-mono text-[color:var(--muted)]">ETA: {task.estimatedEta ?? 120}s · {task.distanceMeters ?? 45}m</span>
                            </div>
                            <p className="text-xs p-3 rounded-xl bg-[var(--surface)] border border-[color:var(--border)] text-[color:var(--ink-soft)]">{task.instruction}</p>
                            <div className="flex items-center justify-end gap-2 pt-1">
                              {task.status === "pending" && (
                                <button onClick={() => handleUpdateTask(task._id, "en_route")} className="px-3 py-1 rounded-xl text-xs font-semibold text-white bg-[#2563eb] hover:bg-blue-600 cursor-pointer shadow-xs">Set En Route</button>
                              )}
                              {task.status === "en_route" && (
                                <button onClick={() => handleUpdateTask(task._id, "completed")} className="px-3 py-1 rounded-xl text-xs font-semibold text-white bg-[#16a34a] hover:bg-[#15803d] cursor-pointer shadow-xs">Mark Completed</button>
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
                          <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[color:var(--muted-2)]">Audit Trail &amp; Operational Metrics</h2>
                          <p className="text-xs text-[color:var(--muted)]">Machine explainability, decision distribution, and post-event export.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={handleExportCSV} className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-[#5b3ff8] hover:bg-[#4d32e6] transition shadow-xs flex items-center gap-1.5 cursor-pointer"><span>Export CSV</span></button>
                          <button onClick={handleExportJSON} className="px-3 py-1.5 rounded-xl text-xs font-semibold text-[color:var(--ink-softer)] bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[color:var(--border)] transition cursor-pointer shadow-2xs"><span>Export JSON</span></button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div className="p-3.5 cc-card rounded-2xl">
                          <div className="text-[10px] font-mono uppercase text-[color:var(--muted)] font-semibold">Total Incidents</div>
                          <div className="text-lg font-bold font-mono mt-1 text-[color:var(--ink)]"><AnimatedNumber value={analyticsData?.totalIncidents ?? activeIncidents.length} /></div>
                          <div className="text-[11px] text-[#16a34a] mt-0.5">{analyticsData?.verifiedIncidents ?? verifiedCount} verified</div>
                        </div>
                        <div className="p-3.5 cc-card rounded-2xl">
                          <div className="text-[10px] font-mono uppercase text-[color:var(--muted)] font-semibold">Avg Trust Score</div>
                          <div className="text-lg font-bold text-[#16a34a] font-mono mt-1"><AnimatedNumber value={analyticsData?.avgTrustScore ?? 75} />/100</div>
                          <div className="text-[11px] text-[color:var(--muted)] mt-0.5">Community Weighting</div>
                        </div>
                        <div className="p-3.5 cc-card rounded-2xl">
                          <div className="text-[10px] font-mono uppercase text-[color:var(--muted)] font-semibold">Logged Decisions</div>
                          <div className="text-lg font-bold text-[#5b3ff8] font-mono mt-1"><AnimatedNumber value={analyticsData?.totalAgentActions ?? (agentLogs?.length ?? 0)} /></div>
                          <div className="text-[11px] text-[color:var(--muted)] mt-0.5">Audit actions</div>
                        </div>
                        <div className="p-3.5 cc-card rounded-2xl">
                          <div className="text-[10px] font-mono uppercase text-[color:var(--muted)] font-semibold">Active Units</div>
                          <div className="text-lg font-bold text-[#d97706] font-mono mt-1"><AnimatedNumber value={activeRespondersCount} /> / {responders?.length ?? 0}</div>
                          <div className="text-[11px] text-[color:var(--muted)] mt-0.5">Deployed responders</div>
                        </div>
                      </div>
                      <div className="cc-card p-4 space-y-3">
                        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[color:var(--muted-2)]">Incident Breakdown by Category</h3>
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
                                  <span className="text-[color:var(--ink-soft)] font-medium">{cat.label}</span>
                                  <span className="font-mono text-[color:var(--muted)]">{cat.count} ({pct}%)</span>
                                </div>
                                <div className="w-full rounded-full h-1.5 bg-[var(--bg)] overflow-hidden">
                                  <div className={`h-full rounded-full ${cat.color}`} style={{ width: `${Math.max(4, pct)}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="cc-card p-4 space-y-3">
                        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[color:var(--muted-2)]">Agent Decision Volume</h3>
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
            </div>
          </div>
        </div>

        {/* ─── 3. SIMULATE accordion (thinking pipeline) ─── */}
        <div>
          <AccordionButton
            open={openSim}
            onClick={() => setOpenSim((v) => !v)}
            label="Simulate"
            badgeTone={isSimulating ? "accent" : "muted"}
            badge={isSimulating ? "Running…" : "Standby"}
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>}
          />
          <div className="cc-acc" data-open={openSim}>
            <div className="cc-acc-inner">
              <div className="mt-2 rounded-2xl border border-[color:var(--border)] bg-[var(--surface)] p-3 space-y-3">
                {/* Primary CTA */}
                <button
                  onClick={handleSimulate}
                  disabled={isSimulating}
                  className="group w-full px-4 py-3 rounded-xl text-sm font-semibold text-white active:scale-[0.98] transition-all duration-200 disabled:opacity-60 disabled:active:scale-100 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-wait"
                  style={{ background: "linear-gradient(145deg, #6b50fa 0%, #5b3ff8 60%, #4a2ee0 100%)", boxShadow: "0 6px 18px -8px rgba(91,63,248,0.6), inset 0 1px 0 rgba(255,255,255,0.2)" }}
                >
                  {isSimulating ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Simulating Surge Stream…</span>
                    </>
                  ) : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200 group-hover:scale-110"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                      <span>Simulate Surge Scenario</span>
                    </>
                  )}
                </button>
                {/* 5-Agent thinking pipeline + 4 showcase preset pills live inside the visualizer */}
                <AgentPipelineVisualizer eventId={eventId} onSimulateFull={handleSimulate} isSimulating={isSimulating} />
              </div>
            </div>
          </div>
        </div>

        {/* ─── 4. VIEW MAP accordion ─── */}
        <div>
          <AccordionButton
            open={openMap}
            onClick={() => setOpenMap((v) => !v)}
            label="View Map"
            badge={`${zones?.length ?? 0} Zones · ${activeIncidents.length} Incidents`}
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3z" /><path d="M9 3v15M15 6v15" /></svg>}
          />
          <div className="cc-acc" data-open={openMap}>
            <div className="cc-acc-inner">
              <div className="mt-2 rounded-2xl border border-[color:var(--border)] bg-[var(--surface)] p-3 space-y-2">
                {/* Layer toggle pills — clean row */}
                <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
                  {(["all", "incidents", "zones", "responders"] as MapLayerFilter[]).map((layer) => (
                    <button
                      key={layer}
                      onClick={() => setMapLayer(layer)}
                      className={`px-3 py-1 rounded-full text-[10px] font-mono uppercase font-semibold transition cursor-pointer border ${mapLayer === layer ? "bg-[#5b3ff8] text-white border-transparent" : "bg-[var(--cream)] text-[color:var(--muted-2)] hover:text-[color:var(--ink)] border-[color:var(--border)]"}`}
                    >
                      {layer}
                    </button>
                  ))}
                </div>

                {/* Map canvas */}
                <div className="h-[380px] sm:h-[460px] w-full rounded-xl overflow-hidden relative bg-[var(--bg)]">
                  {/* Floating zoom controls — bottom-right */}
                  <div className="absolute bottom-3 right-3 z-20 flex items-center p-0.5 rounded-full cc-glass backdrop-blur-md border border-[color:var(--border)] shadow-xs text-xs">
                    <button onClick={() => setMapScale((s) => Math.min(3, s + 0.25))} className="w-7 h-7 rounded-full font-bold text-sm flex items-center justify-center hover:bg-[var(--surface-2)] text-[color:var(--ink)] transition cursor-pointer" title="Zoom In">+</button>
                    <button onClick={() => setMapScale((s) => Math.max(0.7, s - 0.25))} className="w-7 h-7 rounded-full font-bold text-sm flex items-center justify-center hover:bg-[var(--surface-2)] text-[color:var(--ink)] transition cursor-pointer" title="Zoom Out">−</button>
                    <button onClick={() => { setMapScale(1); setMapOffset({ x: 0, y: 0 }); }} className="px-2 h-7 rounded-full text-[10px] font-mono font-semibold flex items-center justify-center hover:bg-[var(--surface-2)] text-[color:var(--muted-2)] transition cursor-pointer" title="Reset View">Reset</button>
                  </div>

                  {/* Pannable & Zoomable Floor Plan Stage */}
                  <div className="relative w-full h-full overflow-hidden cursor-grab active:cursor-grabbing bg-[var(--bg)]" onMouseDown={handleMapMouseDown} onMouseMove={handleMapMouseMove} onMouseUp={handleMapMouseUp} onMouseLeave={handleMapMouseUp}>
                    <div style={{ position: "absolute", inset: 0, transform: `translate(${mapOffset.x}px, ${mapOffset.y}px) scale(${mapScale})`, transformOrigin: "center center", transition: mapDragRef.current ? "none" : "transform 0.2s ease-out" }}>
                      <img src={mapUrl ?? campusMap} alt="Floor Plan" className="w-full h-full object-contain select-none pointer-events-none" draggable={false} />
                      <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 100 100" preserveAspectRatio="none">
                        {(mapLayer === "all" || mapLayer === "routes") && routes && routes.map((rt) => (
                          <g key={rt._id}>
                            <path d="M 65 45 Q 60 55 50 90" fill="none" stroke="#16a34a" strokeWidth="1.6" strokeDasharray="3, 2" className="animate-route-flow" />
                            <path d="M 65 45 Q 75 42 85 40" fill="none" stroke="#5b3ff8" strokeWidth="1.6" strokeDasharray="3, 2" className="animate-route-flow" />
                          </g>
                        ))}
                        {(mapLayer === "all" || mapLayer === "responders") && dispatchTasks && dispatchTasks.filter((t) => t.status === "en_route" || t.status === "accepted" || t.status === "pending").map((task) => {
                          const responder = responders?.find((r) => r._id === task.responderId);
                          const incident = incidents?.find((i) => i._id === task.incidentId);
                          if (!responder || !incident || responder.posX === undefined || responder.posY === undefined) return null;
                          return (
                            <g key={`task-vec-${task._id}`}>
                              <line x1={responder.posX} y1={responder.posY} x2={incident.pinX} y2={incident.pinY} stroke="#d97706" strokeWidth="1.6" strokeDasharray="2, 2" className="animate-route-flow" />
                              <circle cx={incident.pinX} cy={incident.pinY} r="1.8" fill="#d97706" />
                            </g>
                          );
                        })}
                      </svg>
                      {(mapLayer === "all" || mapLayer === "zones") && zones && zones.map((z) => {
                        const isHighRisk = z.riskScore > 60;
                        const isMediumRisk = z.riskScore > 30 && z.riskScore <= 60;
                        const badgeBg = isHighRisk ? "#dc2626" : isMediumRisk ? "#d97706" : "#16a34a";
                        return (
                          <div key={z._id} className="absolute pointer-events-auto cursor-pointer transition-transform hover:scale-105 z-15" style={{ left: `${z.pinX}%`, top: `${z.pinY}%`, transform: `translate(-50%, -50%) scale(${1 / mapScale})` }} onClick={() => { setSection("zones"); setOpenLogs(true); }}>
                            <div className="flex flex-col items-center px-2 py-0.5 rounded-full shadow-md text-white font-mono text-[9px] font-bold border-2 border-white backdrop-blur-md" style={{ backgroundColor: badgeBg }}>
                              <span className="whitespace-nowrap">{z.name}</span>
                              <div className="flex items-center gap-1 text-[8px] opacity-95"><span>{z.riskScore}% Risk</span><span>·</span><span>{z.currentOccupancy}/{z.capacity}</span></div>
                            </div>
                          </div>
                        );
                      })}
                      {(mapLayer === "all" || mapLayer === "incidents") && activeIncidents.map((inc) => {
                        const isVerified = inc.verificationStatus === "VERIFIED";
                        const isCritical = inc.severity === "critical";
                        return (
                          <div key={inc._id} className="absolute pointer-events-auto cursor-pointer transition-transform hover:scale-115 z-25" style={{ left: `${inc.pinX}%`, top: `${inc.pinY}%`, transform: `translate(-50%, -100%) scale(${1 / mapScale})` }} onClick={() => setEvidenceModal(inc)}>
                            <div className="flex flex-col items-center">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs shadow-lg border-2 border-white text-white ${isCritical ? "bg-[#dc2626]" : "bg-[#ea580c]"}`}><TypeIcon type={inc.incidentType} size={15} /></div>
                              <div className="mt-0.5 px-1.5 py-0.5 rounded-full bg-[#1a1917] text-white text-[9px] font-mono font-bold shadow-xs flex items-center gap-1">
                                {inc.incidentCode}
                                {isVerified ? (<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>) : (<span className="opacity-70">?</span>)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {(mapLayer === "all" || mapLayer === "responders") && responders && responders.map((resp) => {
                        if (resp.posX === undefined || resp.posY === undefined) return null;
                        const respColor = resp.responderType === "medical" ? "#dc2626" : resp.responderType === "fire" ? "#ea580c" : resp.responderType === "security" ? "#2563eb" : "#16a34a";
                        return (
                          <div key={resp._id} className="absolute pointer-events-auto cursor-pointer z-20 transition-transform hover:scale-115" style={{ left: `${resp.posX}%`, top: `${resp.posY}%`, transform: `translate(-50%, -50%) scale(${1 / mapScale})` }} title={`${resp.name ?? resp.responderType}: ${resp.isAvailable ? "Available" : "Dispatched"}`} onClick={() => { setSection("dispatch"); setOpenLogs(true); }}>
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-white font-bold shadow-md border-2 border-white" style={{ backgroundColor: respColor }}><TypeIcon type={resp.responderType === "fire" ? "fire" : resp.responderType === "medical" ? "medical" : "security"} size={13} /></div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Single-line legend footer */}
                <div className="rounded-xl border border-[color:var(--border)] bg-[var(--cream)] px-3 py-2 text-[10px] flex items-center justify-between gap-2 overflow-x-auto custom-scrollbar text-[color:var(--muted-2)]">
                  <div className="flex items-center gap-3 whitespace-nowrap">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#dc2626]" /> &gt;60% Critical</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#d97706]" /> 30-60% Moderate</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#16a34a]" /> Safe Zone</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#16a34a]" /> Dynamic Detour</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#d97706]" /> Assigned Vector</span>
                  </div>
                  <span className="font-mono whitespace-nowrap hidden sm:inline" style={{ color: "var(--muted)" }}>Pan &amp; Zoom · Click markers to inspect</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* MODAL: ARCHITECTURE & OPERATIONAL GUIDE */}
      {isGuideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs" onClick={() => setIsGuideOpen(false)}>
          <div className="w-full max-w-2xl rounded-[28px] p-6 shadow-2xl space-y-5 bg-[var(--surface)] border border-[rgba(0,0,0,0.08)] text-[color:var(--ink)] max-h-[88vh] overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[color:var(--border)] pb-4">
              <div>
                <h3 className="text-base font-bold text-[color:var(--ink)]">EventPulse Multi-Agent Safety Architecture</h3>
                <p className="text-xs text-[color:var(--muted)] mt-0.5">End-to-End Autonomous Incident Lifecycle with Human Safety Gates</p>
              </div>
              <button onClick={() => setIsGuideOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer hover:brightness-95" style={{ background: "var(--surface-3)", color: "var(--muted-2)" }} aria-label="Close">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-4 text-xs leading-relaxed text-[color:var(--ink-soft)]">
              <div className="cc-surface rounded-2xl p-3.5">
                <h4 className="font-bold text-[color:var(--ink)] text-sm mb-1">1. Intake &amp; Multi-Modal Perception</h4>
                <p>Attendee reports are ingested via natural language and image uploads. The Intake Agent extracts location, severity, and category, and automatically initiates computer vision analysis on attached photos.</p>
              </div>
              <div className="cc-surface rounded-2xl p-3.5">
                <h4 className="font-bold text-[color:var(--ink)] text-sm mb-1">2. Verification &amp; Reporter Credibility</h4>
                <p>The Verification Agent corroborates incoming reports across independent sources, cross-references historical reporter trust scores (+/- 0.2 weighting), and prevents spam or spoofed incident declarations.</p>
              </div>
              <div className="cc-surface rounded-2xl p-3.5">
                <h4 className="font-bold text-[color:var(--ink)] text-sm mb-1">3. Dynamic Dijkstra Rerouting</h4>
                <p>When a zone approaches critical risk or an active hazard is confirmed, the graph edge weight surges by +10. The Routing Agent recalculates optimal attendee detours away from congested or hazardous zones.</p>
              </div>
              <div className="cc-surface rounded-2xl p-3.5">
                <h4 className="font-bold text-[color:var(--ink)] text-sm mb-1">4. Proximity Dispatch &amp; Human Safety Gate</h4>
                <p>Responders are dispatched based on proximity and role specialty (Medical, Fire, Security). Critical escalations require staff confirmation, ensuring deterministic human control over sensitive responses.</p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={() => setIsGuideOpen(false)} className="px-4 py-2 rounded-xl text-xs font-semibold bg-[var(--ink)] text-[var(--bg)] hover:opacity-85 transition cursor-pointer">Close Guide</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: COMPUTER VISION EVIDENCE INSPECTOR */}
      {evidenceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs" onClick={() => setEvidenceModal(null)}>
          <div className="w-full max-w-xl rounded-[28px] p-6 shadow-2xl space-y-4 border max-h-[88vh] overflow-y-auto custom-scrollbar" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--ink)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                <span style={{ color: "var(--muted)" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg></span>
                <h3 className="text-sm font-bold" style={{ color: "var(--ink)" }}>Computer Vision &amp; Evidence Inspector</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#5b3ff8]/10 text-[#5b3ff8] border border-[#5b3ff8]/20">{evidenceModal.incidentCode}</span>
              </div>
              <button onClick={() => setEvidenceModal(null)} className="w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer hover:brightness-95" style={{ background: "var(--surface-3)", color: "var(--muted-2)" }} aria-label="Close">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="relative rounded-2xl overflow-hidden border border-[color:var(--border)] max-h-72 bg-[#1a1917]">
              {evidenceModal.imageUrl ? (
                <img src={evidenceModal.imageUrl} alt="Incident Visual Evidence" className="w-full h-full object-cover max-h-72" />
              ) : (
                <div className="p-12 text-center text-[color:var(--muted)]">No photo attached to this report.</div>
              )}
              <div className="absolute top-3 left-3 cc-glass backdrop-blur-md px-2.5 py-1 rounded-xl text-xs font-mono font-semibold text-[color:var(--ink)] border border-[color:var(--border)]">Location: {evidenceModal.location}</div>
            </div>
            <div className="p-3.5 rounded-2xl bg-[var(--surface)] border border-blue-200 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-blue-900">Computer Vision Semantic Analysis:</span>
                <span className="font-mono text-emerald-700 font-bold">Confidence: {evidenceModal.imageConfidence ?? 94}%</span>
              </div>
              <p className="text-blue-950 leading-relaxed">{evidenceModal.imageAnalysis ?? "Optical analysis verified: High density crowd cluster matching description semantics."}</p>
            </div>
            <div className="cc-surface rounded-2xl p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[color:var(--ink)]">Reporter Credibility Rating:</span>
                <span className="font-mono font-bold text-emerald-700">{evidenceModal.averageTrustScore ?? 85}/100</span>
              </div>
              <div className="w-full rounded-full h-1.5 bg-[var(--bg)] overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${evidenceModal.averageTrustScore ?? 85}%` }} />
              </div>
              <p className="text-[11px] text-[color:var(--muted)]">Reports from high-trust members with corroborating visual evidence receive automated priority triage.</p>
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={() => setEvidenceModal(null)} className="px-4 py-2 rounded-xl text-xs font-semibold bg-[var(--ink)] text-[var(--bg)] hover:opacity-85 transition cursor-pointer">Close Inspector</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
