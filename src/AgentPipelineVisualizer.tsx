import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

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
    tagline: "NLP, Vision & Dedup",
    tools: ["extract_incident_details", "find_duplicate_reports", "create_or_update_incident"],
    color: {
      bg: "bg-blue-50/70",
      border: "border-blue-200",
      text: "text-blue-700",
      ring: "ring-blue-400",
      icon: "📥",
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
      icon: "🔍",
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
      icon: "👥",
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
      icon: "🗺️",
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
      icon: "🚨",
    },
  },
];

export function AgentPipelineVisualizer({
  eventId,
  onSimulateFull,
  isSimulating = false,
}: AgentPipelineVisualizerProps) {
  const [showReasoningModal, setShowReasoningModal] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Reactive subscription to active or latest pipeline run
  const activeRun = useQuery(api.agentPipeline.getActivePipelineRun, { eventId });
  const triggerSingleReport = useMutation(api.simulation.triggerSingleShowcaseReport);
  const resetRun = useMutation(api.agentPipeline.resetActivePipelineRun);

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
    <div className="flex-none bg-[#faf8f5] border-b border-[#ded7cb] shadow-2xs">
      {/* ── Dynamic Top Progress Bar ── */}
      <div className="h-1 w-full bg-[#ece7de] relative overflow-hidden">
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

      {/* ── Top Bar: Run Metadata, Scenario Quick-Triggers ── */}
      <div className="px-4 py-2 border-b border-[#ece7de] flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-[#1a1917]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#5b3ff8] animate-pulse" />
            <span>Autonomous 5-Agent Pipeline</span>
          </div>

          {activeRun ? (
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-full bg-[#ece7de] text-[#6b6456] font-mono text-[10px]">
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
                    : "Pipeline Completed ✓"}
              </span>

              <button
                onClick={() => activeRun && resetRun({ runId: activeRun._id })}
                className="px-1.5 py-0.5 rounded-full text-[9px] font-mono text-[#8a7f6e] hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition cursor-pointer"
                title="Dismiss or reset pipeline run"
              >
                ✕
              </button>
            </div>
          ) : (
            <span className="text-[11px] text-[#8a7f6e] font-sans">
              Standby · Ready for event incident intake
            </span>
          )}
        </div>

        {/* Quick Showcase Scenarios */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-mono uppercase text-[#8a7f6e] font-bold mr-0.5 hidden sm:inline">
            Showcase:
          </span>

          <button
            onClick={() => handleQuickScenario("stampede")}
            disabled={activeRun?.status === "running"}
            className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-white hover:bg-[#ece7de] text-[#1a1917] border border-[#ded7cb] transition cursor-pointer disabled:opacity-50 shadow-2xs"
            title="Demonstrates Computer Vision + Gate 3 Surge + Dijkstra Rerouting"
          >
            📸 Vision & Surge
          </button>

          <button
            onClick={() => handleQuickScenario("hindi")}
            disabled={activeRun?.status === "running"}
            className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-white hover:bg-[#ece7de] text-[#1a1917] border border-[#ded7cb] transition cursor-pointer disabled:opacity-50 shadow-2xs"
            title="Demonstrates Multilingual NLP tokenizer on Hindi report"
          >
            🌐 Hindi Intake
          </button>

          <button
            onClick={() => handleQuickScenario("medical")}
            disabled={activeRun?.status === "running"}
            className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-white hover:bg-[#ece7de] text-[#1a1917] border border-[#ded7cb] transition cursor-pointer disabled:opacity-50 shadow-2xs"
            title="Demonstrates Medical Post incident + First-Aid dispatch"
          >
            ✚ Medical Post
          </button>

          <button
            onClick={() => handleQuickScenario("fire")}
            disabled={activeRun?.status === "running"}
            className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-white hover:bg-[#ece7de] text-[#1a1917] border border-[#ded7cb] transition cursor-pointer disabled:opacity-50 shadow-2xs"
            title="Demonstrates Fire incident + Stage Evacuation route"
          >
            🔥 Stage Fire
          </button>

          {activeRun?.agentReasoning && (
            <button
              onClick={() => setShowReasoningModal(!showReasoningModal)}
              className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold text-[#5b3ff8] bg-[#5b3ff8]/10 hover:bg-[#5b3ff8]/20 border border-[#5b3ff8]/20 transition cursor-pointer flex items-center gap-1"
            >
              <span>🧠 Reasoning</span>
              <span>{showReasoningModal ? "▲" : "▼"}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── 5 Agent Cards Horizontal Ribbon with Animated Flow & Connectors ── */}
      <div className="px-3 py-2.5 sm:px-5 sm:py-3 overflow-x-auto">
        <div className="flex items-center gap-1.5 min-w-max sm:min-w-0 sm:grid sm:grid-cols-5">
          {AGENTS.map((agent, idx) => {
            const isCurrent = activeAgentKey === agent.id && activeRun?.status === "running";
            const isCompleted = activeIndex > idx || isPipelineCompleted;
            const isPending = activeIndex < idx && !isPipelineCompleted;

            // Timer calculation
            const timing = timestamps[agent.id];
            let elapsedStr = "0.0s";
            if (timing?.startedAt) {
              const end = timing.completedAt ?? (isCurrent ? now : timing.startedAt);
              const diffSec = Math.max(0, (end - timing.startedAt) / 1000);
              elapsedStr = `${diffSec.toFixed(1)}s`;
            }

            return (
              <div
                key={agent.id}
                className={`relative p-2.5 rounded-2xl border transition-all flex flex-col justify-between ${isCurrent
                    ? "bg-white border-[#5b3ff8] shadow-md ring-2 ring-[#5b3ff8]/30 animate-agent-active"
                    : isCompleted
                      ? "bg-white border-emerald-300 shadow-2xs"
                      : "bg-[#f5f1ea]/80 border-[#ded7cb] opacity-75"
                  }`}
              >
                {/* Agent Header */}
                <div className="flex items-start justify-between gap-1.5 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base select-none">{agent.color.icon}</span>
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-bold text-[#1a1917] leading-tight font-sans">
                          {agent.name}
                        </span>
                      </div>
                      <span className="text-[10px] text-[#8a7f6e] leading-tight block">
                        {agent.tagline}
                      </span>
                    </div>
                  </div>

                  {/* Status Indicator Chip */}
                  {isCurrent ? (
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold bg-[#5b3ff8] text-white flex items-center gap-1 shadow-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                      ACTIVE
                    </span>
                  ) : isCompleted ? (
                    <span className="w-4 h-4 rounded-full bg-[#16a34a] text-white flex items-center justify-center text-[10px] font-bold shadow-xs">
                      ✓
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-[#a09585]">
                      #{agent.num}
                    </span>
                  )}
                </div>

                {/* Active Tool Badge inside card */}
                {isCurrent && activeRun?.currentTool && (
                  <div className="my-1 px-1.5 py-0.5 rounded-lg bg-[#5b3ff8]/10 text-[#5b3ff8] text-[9px] font-mono font-semibold truncate flex items-center gap-1">
                    <span>⚡</span>
                    <span className="truncate">{activeRun.currentTool}</span>
                  </div>
                )}

                {/* Sub-phase or Tool Status */}
                <div className="mt-1 pt-1.5 border-t border-[#ece7de] flex items-center justify-between text-[10px] font-mono">
                  {isCurrent ? (
                    <div className="flex items-center gap-1 text-[#5b3ff8] font-bold">
                      <span className="animate-spin text-xs">⟳</span>
                      <span className="uppercase tracking-tight text-[9px]">
                        {activeRun?.agentPhase === "thinking"
                          ? "Deliberating"
                          : activeRun?.agentPhase === "tool_call"
                            ? "Tool Execution"
                            : activeRun?.agentPhase === "output"
                              ? "Handoff..."
                              : "Initializing"}
                      </span>
                    </div>
                  ) : isCompleted ? (
                    <span className="text-emerald-700 font-medium text-[9px]">Complete</span>
                  ) : (
                    <span className="text-[#a09585] text-[9px]">Standby</span>
                  )}

                  <span className={`text-[9px] ${isCurrent ? "font-bold text-[#5b3ff8]" : "text-[#8a7f6e]"}`}>
                    {timing?.startedAt ? elapsedStr : "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Active Agent Live Deliberation Thought Bubble ── */}
      {activeRun && (
        <div className="px-4 py-2.5 sm:px-5 bg-white border-t border-[#ded7cb] flex items-start gap-3">
          <div className="w-7 h-7 rounded-xl bg-[#5b3ff8] text-white flex items-center justify-center text-xs font-mono font-bold shrink-0 mt-0.5 shadow-xs">
            {activeRun.status === "running" ? (
              <span className="animate-pulse">AI</span>
            ) : (
              <span>✓</span>
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-[#1a1917] font-mono uppercase">
                {activeRun.status === "running"
                  ? `${activeRun.activeAgent.replace("_", " ")} Agent Deliberation`
                  : "Pipeline Execution Complete"}
              </span>

              {activeRun.currentTool && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#f5f1ea] text-[#5b3ff8] border border-[#ded7cb] font-semibold flex items-center gap-1">
                  <span>🔧 Tool:</span>
                  <span>{activeRun.currentTool}</span>
                </span>
              )}

              {activeRun.agentPhase && activeRun.status === "running" && (
                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 uppercase font-bold">
                  Phase: {activeRun.agentPhase}
                </span>
              )}
            </div>

            <p className="text-xs text-[#2e2a24] font-medium leading-relaxed">
              {activeRun.currentThought}
            </p>
          </div>
        </div>
      )}

      {/* ── Machine Reasoning Inspector Panel (Collapsible for Judges) ── */}
      {showReasoningModal && reasoningObj && (
        <div className="px-4 py-3 sm:px-5 bg-[#f5f1ea] border-t border-[#ded7cb] text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-bold uppercase text-[#5b3ff8] flex items-center gap-1.5">
              <span>🧠 Agent Explainability & Ground Truth Payload</span>
            </span>
            <span className="text-[10px] font-mono text-[#8a7f6e]">
              Reactive State Machine
            </span>
          </div>

          <pre className="p-3 rounded-xl bg-white border border-[#ded7cb] font-mono text-[11px] text-[#2e2a24] overflow-x-auto max-h-40">
            {JSON.stringify(reasoningObj, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

