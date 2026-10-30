import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

// Minimalist Lucide-style line icons (no runtime dependency added). Each is a
// 24-grid stroke path rendered with currentColor so it inherits the agent's
// accent. Keyed by the `icon` string on each agent descriptor.
const ICON_PATHS: Record<string, React.ReactNode> = {
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  route: <><circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" /></>,
  siren: <><path d="M7 18v-6a5 5 0 1 1 10 0v6" /><path d="M5 21h14M12 3V2M4.2 6.2l-.7-.7M19.8 6.2l.7-.7" /></>,
};

function AgentIcon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICON_PATHS[name] ?? ICON_PATHS.search}
    </svg>
  );
}

interface AgentPipelineVisualizerProps {
  eventId: Id<"events">;
  onSimulateFull?: () => void;
  isSimulating?: boolean;
}

interface AgentDef {
  id: "intake" | "verification" | "crowd_intel" | "routing" | "dispatch";
  num: string;
  name: string;
  tagline: string;
  tools: string[];
  color: {
    bg: string;
    border: string;
    text: string;
    ring: string;
    icon: string;
  };
}

const AGENTS: AgentDef[] = [
  {
    id: "intake",
    num: "1",
    name: "Intake Agent",
    tagline: "NLP & Dedup · optional photo analysis",
    tools: ["extract_incident_details", "find_duplicate_reports", "create_or_update_incident"],
    color: {
      bg: "bg-blue-50/70",
      border: "border-blue-200",
      text: "text-blue-700",
      ring: "ring-blue-400",
      icon: "inbox",
    },
  },
  {
    id: "verification",
    num: "2",
    name: "Verification Agent",
    tagline: "Trust & Media Gate",
    tools: ["check_source_independence", "analyse_media_consistency", "evaluateIncident"],
    color: {
      bg: "bg-emerald-50/70",
      border: "border-emerald-200",
      text: "text-emerald-700",
      ring: "ring-emerald-400",
      icon: "search",
    },
  },
  {
    id: "crowd_intel",
    num: "3",
    name: "Crowd Intel Agent",
    tagline: "Risk Matrix & Flow",
    tools: ["get_zone_occupancy", "predict_zone_risk", "assessAllZones"],
    color: {
      bg: "bg-amber-50/70",
      border: "border-amber-200",
      text: "text-amber-700",
      ring: "ring-amber-400",
      icon: "users",
    },
  },
  {
    id: "routing",
    num: "4",
    name: "Routing Agent",
    tagline: "Dijkstra Detour",
    tools: ["get_venue_graph", "calculate_safe_route", "computeAlternativeRoutes"],
    color: {
      bg: "bg-purple-50/70",
      border: "border-purple-200",
      text: "text-purple-700",
      ring: "ring-purple-400",
      icon: "route",
    },
  },
  {
    id: "dispatch",
    num: "5",
    name: "Dispatch Agent",
    tagline: "Proximity & Safety",
    tools: ["find_available_responders", "calculate_responder_eta", "dispatchResponders"],
    color: {
      bg: "bg-rose-50/70",
      border: "border-rose-200",
      text: "text-rose-700",
      ring: "ring-rose-400",
      icon: "siren",
    },
  },
];

export function AgentPipelineVisualizer({
  eventId,
}: AgentPipelineVisualizerProps) {
  const [showReasoningModal, setShowReasoningModal] = useState(false);
  const [now, setNow] = useState(Date.now());
  // UI-only: which step's detail strip is open (hover or click). Does not touch
  // pipeline/run state — purely controls the expandable detail drawer below the
  // compact stepper bar.
  const [hoveredAgent, setHoveredAgent] = useState<AgentDef["id"] | null>(null);
  const [pinnedAgent, setPinnedAgent] = useState<AgentDef["id"] | null>(null);

  // Reactive subscription to active or latest pipeline run
  const activeRun = useQuery(api.agentPipeline.getActivePipelineRun, { eventId });
  const triggerSingleReport = useMutation(api.simulation.triggerSingleShowcaseReport);
  const resetRun = useMutation(api.agentPipeline.resetActivePipelineRun);
  const retryRun = useMutation(api.agentPipeline.retryOperationalRun);

  // Update ticker for active elapsed timers
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const agentOrder: Array<AgentDef["id"]> = ["intake", "verification", "crowd_intel", "routing", "dispatch"];

  // Determine active index
  const activeAgentKey = activeRun?.activeAgent;
  const isPipelineCompleted = activeRun?.status === "completed" || activeAgentKey === "completed";
  const activeIndex = activeAgentKey && activeAgentKey !== "completed"
    ? agentOrder.indexOf(activeAgentKey as any)
    : isPipelineCompleted
      ? 5
      : -1;

  // Parse timestamps
  const timestamps: Record<string, { startedAt?: number; completedAt?: number }> = React.useMemo(() => {
    try {
      return JSON.parse(activeRun?.agentTimestamps || "{}");
    } catch {
      return {};
    }
  }, [activeRun?.agentTimestamps]);

  // Parse reasoning payload
  const reasoningObj = React.useMemo(() => {
    try {
      return activeRun?.agentReasoning ? JSON.parse(activeRun.agentReasoning) : null;
    } catch {
      return null;
    }
  }, [activeRun?.agentReasoning]);

  // Calculate overall pipeline progress percentage
  const progressPercent = React.useMemo(() => {
    if (!activeRun) return 0;
    if (activeRun.status === "completed" || activeAgentKey === "completed") return 100;
    if (activeRun.status === "failed") return 100;
    switch (activeAgentKey) {
      case "intake":
        return activeRun.agentPhase === "starting" ? 8 : activeRun.agentPhase === "thinking" ? 14 : 20;
      case "verification":
        return activeRun.agentPhase === "starting" ? 28 : activeRun.agentPhase === "thinking" ? 34 : 40;
      case "crowd_intel":
        return activeRun.agentPhase === "starting" ? 48 : activeRun.agentPhase === "thinking" ? 54 : 60;
      case "routing":
        return activeRun.agentPhase === "starting" ? 68 : activeRun.agentPhase === "thinking" ? 74 : 80;
      case "dispatch":
        return activeRun.agentPhase === "starting" ? 88 : activeRun.agentPhase === "thinking" ? 94 : 98;
      default:
        return 0;
    }
  }, [activeRun, activeAgentKey]);

  const handleQuickScenario = async (type: "stampede" | "medical" | "fire" | "hindi") => {
    try {
      await triggerSingleReport({ eventId, scenarioType: type });
    } catch (err: any) {
      alert("Error triggering scenario: " + err.message);
    }
  };

  return (
    <div className="flex-none border-b" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      {/* ── Dynamic Top Progress Bar ── */}
      <div className="h-1 w-full relative overflow-hidden" style={{ background: "var(--surface-2)" }}>
        <div
          className={`h-full transition-all duration-500 ease-out ${activeRun?.status === "failed"
              ? "bg-rose-500"
              : activeRun?.status === "completed" || activeAgentKey === "completed"
                ? "bg-emerald-500"
                : "bg-gradient-to-r from-blue-500 via-amber-500 via-purple-500 to-rose-500"
            }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* ── Compact sub-header strip: title + run meta (left), showcase pills (right) ── */}
      <div className="px-4 py-1.5 border-b flex items-center justify-between flex-wrap gap-x-3 gap-y-1.5 text-xs min-h-9" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold cc-badge-live" style={{ color: "var(--ink)" }}>
            <span className="cc-dot w-2 h-2" style={{ background: "var(--accent)", ["--cc-ring" as any]: "rgba(91,63,248,0.45)" }} />
            <span>{activeRun?.isDemo ? "Demo · paced pipeline" : "Live incident workflow"}</span>
          </div>

          {activeRun ? (
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-full font-mono text-[10px]" style={{ background: "var(--surface-2)", color: "var(--muted-2)" }}>
                {activeRun.runCode}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold uppercase ${activeRun.status === "running"
                    ? "bg-amber-100 text-amber-800 border border-amber-300 animate-pulse"
                    : activeRun.status === "failed"
                      ? "bg-rose-100 text-rose-800 border border-rose-300"
                      : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  }`}
              >
                {activeRun.status === "running"
                  ? `Executing: ${activeRun.activeAgent}`
                  : activeRun.status === "failed"
                    ? "Pipeline Error"
                    : "Pipeline Completed"}
              </span>

              {activeRun.status === "failed" && !activeRun.isDemo && <button className="underline text-xs" onClick={() => void retryRun({ runId: activeRun._id }).catch(e => alert(e.message))}>Retry workflow</button>}
              <button
                onClick={() => activeRun && resetRun({ runId: activeRun._id })}
                className="w-5 h-5 rounded-full flex items-center justify-center text-[color:var(--muted)] hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition cursor-pointer"
                title="Dismiss or reset pipeline run"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ) : (
            <span className="text-[11px] font-sans" style={{ color: "var(--muted)" }}>
              Standby · Ready for event incident intake
            </span>
          )}
        </div>

        {/* Quick Showcase Scenarios */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-mono uppercase font-bold mr-0.5 hidden sm:inline" style={{ color: "var(--muted)" }}>
            Showcase:
          </span>

          {([
            ["stampede", "Surge Demo", "Demonstrates the scripted Gate 3 surge and Dijkstra rerouting; simulated photos are not sent to vision AI"],
            ["hindi", "Hindi Intake", "Demonstrates Multilingual NLP tokenizer on Hindi report"],
            ["medical", "Medical Post", "Demonstrates Medical Post incident + First-Aid dispatch"],
            ["fire", "Stage Fire", "Demonstrates Fire incident + Stage Evacuation route"],
          ] as ["stampede" | "hindi" | "medical" | "fire", string, string][]).map(([type, label, tip]) => (
            <button
              key={type}
              onClick={() => handleQuickScenario(type)}
              disabled={activeRun?.status === "running"}
              className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold border transition-colors duration-200 cursor-pointer disabled:opacity-50 hover:bg-white/5"
              style={{ background: "var(--surface-2)", color: "var(--muted-2)", borderColor: "var(--border)" }}
              title={tip}
            >
              {label}
            </button>
          ))}

          {activeRun?.agentReasoning && (
            <button
              onClick={() => setShowReasoningModal(!showReasoningModal)}
              className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold text-[#5b3ff8] bg-[#5b3ff8]/10 hover:bg-[#5b3ff8]/20 border border-[#5b3ff8]/20 transition cursor-pointer flex items-center gap-1.5"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5a3 3 0 1 0-5.997.142 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Zm0 0a3 3 0 1 0 5.997.142 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /></svg>
              <span>Reasoning</span>
              <span>{showReasoningModal ? "▲" : "▼"}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Vertical Step-by-Step Spotlight Timeline (Claude/Gemini "thinking") ── */}
      <div className="px-3 py-3 sm:px-5 space-y-2">
        {AGENTS.map((agent, idx) => {
          const isCurrent = activeAgentKey === agent.id && activeRun?.status === "running";
          const isCompleted = activeIndex > idx || isPipelineCompleted;
          const isPinned = pinnedAgent === agent.id;
          // Expanded when actively running, or when the user hovers/clicks it.
          const isExpanded = isCurrent || isPinned || hoveredAgent === agent.id;
          const isLast = idx === AGENTS.length - 1;

          const timing = timestamps[agent.id];
          let elapsedStr = "—";
          if (timing?.startedAt) {
            const end = timing.completedAt ?? (isCurrent ? now : timing.startedAt);
            elapsedStr = `${Math.max(0, (end - timing.startedAt) / 1000).toFixed(1)}s`;
          }
          const phaseLabel = isCurrent
            ? (activeRun?.agentPhase === "thinking" ? "Deliberating"
              : activeRun?.agentPhase === "tool_call" ? "Tool execution"
              : activeRun?.agentPhase === "output" ? "Handoff" : "Initializing")
            : isCompleted ? "Complete" : "Standby";
          const statusCls = isCurrent
            ? "bg-[#5b3ff8]/10 text-[#5b3ff8]"
            : isCompleted
              ? "bg-emerald-500/15 text-emerald-600"
              : "text-[color:var(--muted-4)]";

          return (
            <div key={agent.id} className="relative flex gap-3">
              {/* Rail + node */}
              <div className="flex flex-col items-center shrink-0">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 ${isCurrent ? "animate-agent-active" : ""}`}
                  style={{
                    background: isCurrent ? "rgba(91,63,248,0.12)" : isCompleted ? "rgba(22,163,74,0.15)" : "color-mix(in srgb, var(--muted) 12%, transparent)",
                    color: isCurrent ? "var(--accent)" : isCompleted ? "#16a34a" : "var(--muted)",
                    border: isCurrent ? "1.5px solid rgba(91,63,248,0.5)" : "1.5px solid transparent",
                  }}
                >
                  {isCurrent ? (
                    <span className="w-3.5 h-3.5 border-2 border-[#5b3ff8]/30 border-t-[#5b3ff8] rounded-full animate-spin" />
                  ) : isCompleted ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  ) : (
                    <span className="text-[11px] font-mono font-bold">{agent.num}</span>
                  )}
                </div>
                {!isLast && <div className="w-0.5 flex-1 min-h-[14px] my-1 rounded-full" style={{ background: isCompleted ? "rgba(22,163,74,0.35)" : "var(--border)" }} />}
              </div>

              {/* Step card */}
              <button
                onClick={() => setPinnedAgent((p) => (p === agent.id ? null : agent.id))}
                onMouseEnter={() => setHoveredAgent(agent.id)}
                onMouseLeave={() => setHoveredAgent(null)}
                aria-expanded={isExpanded}
                className={`flex-1 min-w-0 text-left rounded-xl border px-3.5 py-2.5 mb-1 transition-all duration-200 cursor-pointer ${isCurrent ? "border-indigo-500/50 bg-indigo-500/10" : "hover:bg-white/5"}`}
                style={isCurrent ? undefined : { background: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0" style={{ color: isCurrent ? "var(--accent)" : isCompleted ? "#16a34a" : "var(--muted)" }}>
                    <AgentIcon name={agent.color.icon} size={15} />
                  </span>
                  <span className="text-xs font-bold truncate" style={{ color: "var(--ink)" }}>{agent.num}. {agent.name}</span>
                  <span className={`ml-auto shrink-0 text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded-full tracking-tight ${statusCls}`}>
                    {isCurrent ? "Active" : isCompleted ? "Done" : "Standby"}
                  </span>
                </div>

                {/* Expanded detail: subtitle, phase, reasoning, tools */}
                {isExpanded && (
                  <div className="cc-rise mt-2 pt-2 border-t space-y-1.5" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <span style={{ color: "var(--muted)" }}>{agent.tagline}</span>
                      <span className="font-mono uppercase font-semibold" style={{ color: isCurrent ? "var(--accent)" : isCompleted ? "#16a34a" : "var(--muted-4)" }}>· {phaseLabel}</span>
                      <span className="font-mono" style={{ color: "var(--muted)" }}>· {elapsedStr}</span>
                    </div>
                    {isCurrent && activeRun?.currentThought && (
                      <p className="text-[11px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>{activeRun.currentThought}</p>
                    )}
                    {isCurrent && activeRun?.currentTool && (
                      <span className="inline-flex text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full items-center gap-1.5" style={{ background: "rgba(91,63,248,0.1)", color: "var(--accent)" }}>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>
                        {activeRun.currentTool}
                      </span>
                    )}
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[9px] font-mono uppercase mr-0.5" style={{ color: "var(--muted-4)" }}>Tools:</span>
                      {agent.tools.map((t) => (
                        <span key={t} className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--muted-2)" }}>{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Active Agent Live Deliberation Thought Bubble ── */}
      {activeRun && (
        <div className="px-4 py-3 sm:px-5 border-t flex items-start gap-3" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="w-7 h-7 rounded-xl text-white flex items-center justify-center shrink-0 mt-0.5" style={{ background: "var(--accent)", boxShadow: "0 4px 10px -4px rgba(91,63,248,0.6)" }}>
            {activeRun.status === "running" ? (
              <span className="text-[10px] font-mono font-bold animate-pulse">AI</span>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold font-mono uppercase" style={{ color: "var(--ink)" }}>
                {activeRun.status === "running"
                  ? `${activeRun.activeAgent.replace("_", " ")} Agent Deliberation`
                  : "Pipeline Execution Complete"}
              </span>

              {activeRun.currentTool && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full text-[#5b3ff8] border font-semibold flex items-center gap-1.5" style={{ background: "var(--cream)", borderColor: "var(--border)" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6.4 6.4a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l6.4-6.4a4 4 0 0 0 5.6-5.6l-2.3 2.3-2-2 2.3-2.3z" /></svg>
                  <span>{activeRun.currentTool}</span>
                </span>
              )}

              {activeRun.agentPhase && activeRun.status === "running" && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 uppercase font-bold">
                  Phase: {activeRun.agentPhase}
                </span>
              )}
            </div>

            <p className="text-xs font-medium leading-relaxed" style={{ color: "var(--ink-soft)" }}>
              {activeRun.currentThought}
            </p>
          </div>
        </div>
      )}

      {/* ── Machine Reasoning Inspector Panel (Collapsible for Judges) ── */}
      {showReasoningModal && reasoningObj && (
        <div className="px-4 py-3 sm:px-5 border-t text-xs space-y-2" style={{ background: "var(--cream)", borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-bold uppercase text-[#5b3ff8] flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5a3 3 0 1 0-5.997.142 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Zm0 0a3 3 0 1 0 5.997.142 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /></svg>
              <span>Agent Explainability &amp; Ground Truth Payload</span>
            </span>
            <span className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>
              Reactive State Machine
            </span>
          </div>

          <pre className="custom-scrollbar p-3 rounded-xl border font-mono text-[11px] overflow-x-auto max-h-40" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--ink-soft)" }}>
            {JSON.stringify(reasoningObj, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

