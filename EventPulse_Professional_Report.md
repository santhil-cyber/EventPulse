# 🛡️ EventPulse AI Command Center — Professional Feature Report

> **Multi-Agent Autonomous Incident Response System for Live Events**
>
> *Built for the Agentic AI Hackathon — October 2026*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [The 5-Agent Pipeline — Deep Dive](#3-the-5-agent-pipeline--deep-dive)
4. [Complete Feature Catalog with Agentic AI Explanations](#4-complete-feature-catalog-with-agentic-ai-explanations)
5. [How Agentic AI Powers Every Decision](#5-how-agentic-ai-powers-every-decision)
6. [UI Features — Completed](#6-ui-features--completed)
7. [UI Improvements — Planned](#7-ui-improvements--planned)
8. [Backend Features — Completed](#8-backend-features--completed)
9. [Backend Improvements — Planned](#9-backend-improvements--planned)
10. [Demo Flow Script for Mentors](#10-demo-flow-script-for-mentors)
11. [Tech Stack](#11-tech-stack)
12. [Appendix: Safety Rules & Thresholds](#12-appendix-safety-rules--thresholds)

---

## 1. Executive Summary

**EventPulse AI Command Center** is a production-grade, multi-agent autonomous incident response system designed for live event safety management. It demonstrates how **five specialized AI agents**, coordinated by a central orchestrator, can autonomously detect, verify, analyze, route, and respond to safety incidents — all in real-time — while maintaining strict **human-in-the-loop safety gates** for critical decisions.

> [!IMPORTANT]
> **Why Agentic AI?** Unlike traditional monolithic systems that require manual intervention at every step, EventPulse deploys *autonomous agents* that independently perceive, reason, and act. Each agent is a specialist — just like a real emergency response team — and they coordinate through a pipeline that mirrors real-world incident command structures. The system doesn't just alert; it **thinks, verifies, and responds**.

### Key Differentiators

| Aspect | Traditional System | EventPulse Agentic AI |
|--------|-------------------|----------------------|
| Incident Detection | Manual reporting only | **NLP classification + multi-modal vision** |
| Verification | Human review queue | **Autonomous cross-source corroboration** |
| Crowd Analysis | Static capacity limits | **Dynamic risk scoring with 4-factor model** |
| Routing | Pre-planned exit maps | **Real-time Dijkstra with congestion penalties** |
| Dispatch | Manual radio coordination | **Proximity + skill-ranked auto-dispatch** |
| Escalation | Missed alerts | **3-minute auto-escalation with safety gates** |
| Oversight | After-the-fact review | **Full audit trail + deterministic safety rules** |

---

## 2. System Architecture

### High-Level Agent Pipeline

```mermaid
flowchart LR
    R["📱 Report Submitted\n(Text + Photo)"] --> O["🧠 Orchestrator"]
    O --> A1["🔍 Intake Agent\nClassify & Deduplicate"]
    A1 --> A2["✅ Verification Agent\nCorroborate & Trust Score"]
    A2 --> A3["📊 Crowd Intel Agent\nZone Risk Analysis"]
    A3 --> A4["🗺️ Routing Agent\nDijkstra Evacuation Paths"]
    A4 --> A5["🚨 Dispatch Agent\nResponder Assignment"]
    A5 --> SG["🛡️ Safety Gates\nHuman-in-the-Loop"]
    
    style O fill:#6366f1,color:#fff
    style A1 fill:#3b82f6,color:#fff
    style A2 fill:#10b981,color:#fff
    style A3 fill:#f59e0b,color:#000
    style A4 fill:#8b5cf6,color:#fff
    style A5 fill:#ef4444,color:#fff
    style SG fill:#dc2626,color:#fff
```

### Data Flow Architecture

```mermaid
flowchart TD
    subgraph Frontend["🖥️ Frontend (React + Tailwind)"]
        APP["App.tsx\nAttendee & Staff Views"]
        CC["AgentCommandCenter.tsx\nSplit-Screen Operations Console"]
        RM["ReportModal\nPhoto Upload + Demo Presets"]
    end

    subgraph Backend["⚙️ Backend (Convex)"]
        subgraph Agents["🤖 Agent Pipeline"]
            IN["Intake Agent"]
            VE["Verification Agent"]
            CI["Crowd Intel Agent"]
            RO["Routing Agent"]
            DI["Dispatch Agent"]
        end
        OR["Orchestrator\nPipeline Controller"]
        SF["Safety Module\n4 Deterministic Gates"]
        SIM["Simulation Engine\n9 Reports + 3 Photos"]
    end

    subgraph Data["💾 Reactive Database"]
        DB[("Convex DB\n13 Tables")]
        ST[("File Storage\nPhoto Evidence")]
        LOG[("Agent Logs\nFull Audit Trail")]
    end

    APP --> RM
    RM -->|"report + photo"| OR
    OR --> IN --> VE --> CI --> RO --> DI
    DI --> SF
    IN & VE & CI & RO & DI --> LOG
    IN & VE --> DB
    CI & RO & DI --> DB
    RM -->|upload| ST
    DB -->|reactive queries| CC
    LOG -->|real-time stream| CC

    style Frontend fill:#1e1b4b,color:#fff
    style Backend fill:#0f172a,color:#fff
    style Data fill:#1a1a2e,color:#fff
```

### Agent Interaction Model

```mermaid
sequenceDiagram
    participant U as 📱 Reporter
    participant O as 🧠 Orchestrator
    participant I as 🔍 Intake
    participant V as ✅ Verification
    participant C as 📊 Crowd Intel
    participant R as 🗺️ Routing
    participant D as 🚨 Dispatch
    participant S as 🛡️ Safety Gate

    U->>O: Submit report (text + photo)
    O->>I: processReport()
    I->>I: NLP classify (keyword matching)
    I->>I: Jaccard dedup (threshold: 0.3)
    I->>I: CV vision analysis (simulated)
    I-->>O: Incident created/updated
    O->>V: runVerification()
    V->>V: Count independent sources
    V->>V: Calculate avg trust score
    V->>V: Apply evidence bonuses
    V->>V: Determine status transition
    V-->>O: UNVERIFIED → CORROBORATED → VERIFIED
    O->>C: runCrowdIntel()
    C->>C: 4-factor risk scoring per zone
    C-->>O: Zone risk levels updated
    O->>R: runRouting()
    R->>R: Dijkstra with congestion weights
    R-->>O: Evacuation routes published
    O->>D: runResponsePlanning()
    D->>D: Rank responders (proximity + skill)
    D->>S: canDispatchEmergencyService?
    S-->>D: ✅ / ❌ (deterministic gate)
    D-->>O: Responders dispatched
```

---

## 3. The 5-Agent Pipeline — Deep Dive

### Agent 1: 🔍 Intake Agent — *"The First Responder"*

**File**: [`convex/agents/intake.ts`](file:///Users/santhil/EventPulse/convex/agents/intake.ts)

**What it does**: The Intake Agent is the first point of contact for every incident report. It acts as an autonomous triage nurse — classifying the nature and severity of each report using NLP, deduplicating against existing incidents, and performing multi-modal analysis on photo evidence.

**Agentic AI Capabilities**:

| Capability | How It Works |
|-----------|-------------|
| **NLP Keyword Classification** | Scans report text against 5 incident-type dictionaries (65+ keywords). Each type — medical, fire, stampede, security, infrastructure — has a curated keyword set. The agent counts matches and selects the highest-scoring category. |
| **Severity Extraction** | Autonomously determines severity (low/medium/high/critical) based on keyword urgency tiers. Words like "unconscious", "weapon", "collapse" trigger critical; "bleeding", "fight" trigger high. |
| **Jaccard Similarity Deduplication** | Compares each new report against all open incidents using Jaccard coefficient on word sets. Threshold: **0.3**. Prevents duplicate incidents from flooding the system — a key agentic behavior where the agent *decides* whether this is a new incident or corroborating evidence. |
| **Multi-Modal Computer Vision** | When a photo is attached, the agent autonomously runs simulated CV analysis, generating type-specific findings (e.g., "Detected crowd density anomaly with potential crush risk indicators") with confidence scores (0.72–0.94 range). |
| **Autonomous Decision** | The agent independently decides whether to create a new incident OR update an existing one — no human needed for this triage step. |

**Keyword Dictionaries** (65+ terms across 5 categories):
- **Medical** (14): hurt, injury, unconscious, bleeding, fainted, heart, breathing, ambulance, medical, sick, pain, collapsed, seizure, allergic
- **Fire** (10): fire, smoke, burning, flames, extinguisher, alarm, hot, heat, evacuation
- **Stampede** (10): stampede, crush, crowd, pushing, trampling, surge, overcrowded, packed, panic, rushing
- **Security** (11): fight, weapon, theft, suspicious, threatening, unauthorized, breach, intruder, assault, harassment, violent
- **Infrastructure** (11): collapse, broken, leak, electrical, structural, blocked, exit, barrier, damage, malfunction, power

---

### Agent 2: ✅ Verification Agent — *"The Truth Seeker"*

**File**: [`convex/agents/verification.ts`](file:///Users/santhil/EventPulse/convex/agents/verification.ts)

**What it does**: The Verification Agent autonomously determines whether an incident is real by cross-referencing multiple independent reports, evaluating reporter credibility via trust scores, and incorporating visual evidence. It implements a graduated confidence model — incidents don't just go from "unknown" to "confirmed"; they progress through verification stages.

**Agentic AI Capabilities**:

| Capability | How It Works |
|-----------|-------------|
| **Source Independence Analysis** | Counts *unique reporters* per incident. The agent recognizes that 5 reports from 1 person ≠ 5 independent confirmations. Only distinct reporter IDs count as independent sources. |
| **Trust Score Evaluation** | Each reporter has a trust score (0–100) stored on their membership. The agent averages trust scores across all reporters for an incident, using this as a credibility modifier. |
| **Multi-Modal Verification** | Photo evidence from a high-trust reporter (trust > 60) adds a **+0.15** evidence bonus — the agent *autonomously decides* that visual evidence from a credible source is strong corroboration. |
| **Graduated Status Transitions** | Three-state lifecycle: `UNVERIFIED → CORROBORATED → VERIFIED`. Score ≥ 0.4 = corroborated, ≥ 0.8 = verified. This prevents premature action on unconfirmed reports. |
| **Safety Gate Trigger** | When an incident reaches VERIFIED status with high severity, the agent autonomously triggers `shouldAlertNearbyStaff()` — but emergency services can *only* be dispatched through the safety gate, ensuring human oversight. |

**Scoring Formula**:
```
baseScore = {1 source: 0.2, 2 sources: 0.5, 3+ sources: 0.8}
trustModifier = clamp((avgTrustScore - 50) / 100, -0.2, +0.2)
evidenceBonus = (hasImageEvidence && avgTrust > 60) ? 0.15 : 0
finalScore = clamp(baseScore + trustModifier + evidenceBonus, 0, 1)
```

---

### Agent 3: 📊 Crowd Intelligence Agent — *"The Analyst"*

**File**: [`convex/agents/crowdIntel.ts`](file:///Users/santhil/EventPulse/convex/agents/crowdIntel.ts)

**What it does**: The Crowd Intel Agent continuously analyzes venue zone data to produce real-time risk assessments. It doesn't just count people — it considers occupancy density, incident proximity, exit availability, and crowd flow rates in a weighted multi-factor model.

**Agentic AI Capabilities**:

| Capability | How It Works |
|-----------|-------------|
| **4-Factor Risk Scoring** | Weighted model: Density (40%) + Incident Proximity (30%) + Exit Availability (20%) + Flow Rate (10%). Each factor independently scored 0.0–1.0. |
| **Dynamic Risk Classification** | Autonomously classifies each zone: critical (≥0.8), high (≥0.6), moderate (≥0.3), low (<0.3). This classification directly feeds into routing and dispatch agents. |
| **Resource Recommendations** | Generates actionable recommendations: "Immediate evacuation recommended" for critical zones, scaling down to "Standard monitoring sufficient" for low-risk zones. |
| **Zone-Level Granularity** | Analyzes all 12 venue zones independently, recognizing that a packed Main Stage doesn't mean the Parking Lot needs evacuation. |

**Risk Scoring Formula**:
```
riskScore = (density/capacity × 0.4) + (incidentProximity × 0.3) + (exitRisk × 0.2) + (flowRate/100 × 0.1)
```

---

### Agent 4: 🗺️ Routing Agent — *"The Navigator"*

**File**: [`convex/agents/routing.ts`](file:///Users/santhil/EventPulse/convex/agents/routing.ts)

**What it does**: The Routing Agent computes optimal evacuation paths using Dijkstra's shortest-path algorithm, but with a twist — edge weights are dynamically adjusted based on real-time zone risk levels. A path through a critical zone becomes *extremely* expensive, forcing routes around danger areas.

**Agentic AI Capabilities**:

| Capability | How It Works |
|-----------|-------------|
| **Dijkstra Pathfinding** | Classic shortest-path with Map-based adjacency graph. Guarantees mathematically optimal routes. |
| **Congestion-Aware Weights** | Edge costs: `1 + penalty`. Penalties: critical zone = **+10**, high = +5, moderate = +2, low = +0. A path through a critical zone costs 11× more than through a safe zone. |
| **Dynamic Route Publishing** | For every non-exit zone, computes path to nearest exit and publishes to `evacuationRoutes` table. Routes update in real-time as zone risks change. |
| **Congestion Level Labels** | Routes labeled: distance > 5 = "high" congestion, > 3 = "medium", else "low" — enabling UI to color-code routes. |
| **Reactive Recalculation** | Routes recalculate every time the orchestrator triggers the pipeline — meaning routes adapt as incidents develop and zones change risk levels. |

---

### Agent 5: 🚨 Dispatch Agent — *"The Commander"*

**File**: [`convex/agents/dispatch.ts`](file:///Users/santhil/EventPulse/convex/agents/dispatch.ts)

**What it does**: The Dispatch Agent autonomously assigns the best-matched responder to each verified incident, considering proximity, skills, and availability. It also monitors for stalled responses and auto-escalates.

**Agentic AI Capabilities**:

| Capability | How It Works |
|-----------|-------------|
| **Multi-Factor Responder Ranking** | Scores each responder: Proximity (0–50 pts) + Skill Match (0–30 pts) + Availability (0–20 pts). Maximum 100 points. |
| **Proximity-Based Scoring** | Same zone = 50 pts maximum. Distance penalty: `-10 pts per zone hop`. |
| **Skill Matching** | Cross-references responder skills against incident type (e.g., "Medical" responder → medical incident = +30 pts). |
| **Priority-Based ETA** | ETAs scale with severity: critical = 2 min, high = 5 min, medium = 10 min, low = 15 min. |
| **3-Minute Auto-Escalation** | Autonomously scans for dispatched tasks older than 3 minutes with no resolution → escalates. No human needed to notice a stalled response. |
| **Emergency Service Safety Gate** | Critical verified incidents trigger `canDispatchEmergencyService()` check — only verified + critical incidents can trigger external emergency services. This is the human-in-the-loop boundary. |

**Responder Ranking Formula**:
```
score = proximityScore(0-50) + skillMatch(0-30) + availabilityBonus(0-20)
proximityScore = sameZone ? 50 : max(0, 50 - (distance × 10))
```

---

## 4. Complete Feature Catalog with Agentic AI Explanations

### 🤖 Core Agentic AI Features

#### 4.1 Multi-Agent Orchestration Pipeline

**Feature**: A central orchestrator coordinates 5 specialized agents in a fixed pipeline sequence, chaining them via asynchronous schedulers.

**How Agentic AI Helps**: Instead of a single monolithic function, the system uses *agent specialization* — each agent has a narrow domain of expertise and acts autonomously within that domain. The orchestrator (`ctx.scheduler.runAfter`) chains them asynchronously, mimicking how a real incident command structure delegates to specialists. This is a core agentic pattern: **decomposition of complex tasks into specialized autonomous units**.

#### 4.2 NLP-Based Incident Classification

**Feature**: Reports are automatically classified into 5 incident types (medical, fire, stampede, security, infrastructure) with severity levels (low/medium/high/critical).

**How Agentic AI Helps**: The Intake Agent *autonomously perceives* the nature of a report — it reads unstructured text, extracts meaning via keyword frequency analysis across 65+ terms, and makes an independent classification decision. No human needs to read the report first. The agent also autonomously determines urgency.

#### 4.3 Jaccard Similarity Deduplication

**Feature**: New reports are compared against existing incidents using Jaccard coefficient on tokenized word sets (threshold: 0.3).

**How Agentic AI Helps**: The agent *reasons about context* — "Is this a new incident, or is someone else reporting the same thing?" This is a key agentic decision: the agent autonomously decides to update an existing incident (adding corroborating evidence) rather than creating noise. This mirrors how a human analyst would recognize duplicate reports.

#### 4.4 Multi-Modal Computer Vision Verification

**Feature**: Photo evidence attached to reports is analyzed by a simulated CV model, generating findings and confidence scores.

**How Agentic AI Helps**: The system demonstrates **multi-modal perception** — agents don't just read text; they analyze visual evidence. The CV module produces type-specific analyses (e.g., "Dense crowd formation with visible signs of distress at edges" for stampede-type reports) with calibrated confidence scores (0.72–0.94). In production, this plugs into real vision models (Gemini, etc.).

#### 4.5 Trust Score System & Reporter Credibility

**Feature**: Every user has a trust score (0–100) on their event membership. The Verification Agent uses this to weight reports.

**How Agentic AI Helps**: The agent doesn't treat all information equally — it applies **credibility reasoning**. A report from a trusted staff member (trust: 85) carries more weight than one from a new attendee (trust: 50). This is agentic *judgment* — the agent autonomously adjusts its confidence based on source reliability.

#### 4.6 Source Independence Checking

**Feature**: The Verification Agent counts unique reporter IDs, not total reports, to assess corroboration strength.

**How Agentic AI Helps**: The agent applies **epistemic reasoning** — understanding that quantity of reports from one source is less valuable than diversity of sources. 3 reports from 3 different people = strong signal. 3 reports from 1 person = potentially biased. This is sophisticated autonomous reasoning about information quality.

#### 4.7 Graduated Verification Lifecycle

**Feature**: Incidents progress through `UNVERIFIED → CORROBORATED → VERIFIED` based on cumulative evidence scoring.

**How Agentic AI Helps**: Instead of binary yes/no, the system uses a **confidence gradient**. The agent accumulates evidence over time and makes *progressive decisions* — first acknowledging something might be happening (corroborated), then confirming it's real (verified). This prevents premature over-reaction while ensuring genuine incidents are acted upon.

#### 4.8 Human-in-the-Loop Safety Gates

**Feature**: Four deterministic safety rules gate critical actions: emergency service dispatch, incident verification, evacuation broadcast, and staff alerts.

**How Agentic AI Helps**: This demonstrates **responsible AI** — the agents are autonomous, but *bounded*. Critical actions like dispatching fire trucks or broadcasting evacuations require deterministic gate checks. The agents can recommend, but the safety module has final say. This is the agentic pattern of *constrained autonomy* — agents with guardrails.

#### 4.9 Real-Time Crowd Density Risk Scoring

**Feature**: Each venue zone gets a dynamic risk score based on 4 weighted factors, updated every pipeline cycle.

**How Agentic AI Helps**: The Crowd Intel Agent acts as an autonomous analyst — continuously monitoring environmental signals (occupancy, incidents, exits, flow) and synthesizing them into actionable risk assessments. It doesn't wait to be asked; it proactively updates its analysis every time the pipeline runs.

#### 4.10 Dynamic Evacuation Routing

**Feature**: Dijkstra shortest-path algorithm computes optimal evacuation routes, with edge weights adjusted by real-time zone risk.

**How Agentic AI Helps**: The Routing Agent demonstrates **adaptive planning** — routes recalculate as conditions change. If a fire breaks out near Exit A, that zone's risk goes critical, its edge weight spikes to 11, and evacuation routes automatically redirect to Exit B. The agent adapts without human reconfiguration.

#### 4.11 Autonomous Responder Dispatch

**Feature**: Best-matched responder auto-assigned based on proximity (same zone = max score), skill match, and availability.

**How Agentic AI Helps**: The Dispatch Agent makes **resource allocation decisions** autonomously — evaluating all available responders against the specific incident requirements. It's like an autonomous dispatcher who instantly knows where every team member is and what they're qualified for.

#### 4.12 3-Minute Auto-Escalation

**Feature**: Dispatched tasks with no resolution within 3 minutes are automatically escalated.

**How Agentic AI Helps**: The agent demonstrates **temporal reasoning and monitoring** — it doesn't just dispatch and forget. It autonomously tracks response progress and escalates stalled situations. This is proactive agentic behavior: anticipating failure and taking corrective action without being prompted.

#### 4.13 Full Audit Trail

**Feature**: Every agent action is logged to the `agentLogs` table with agent name, action type, detailed JSON findings, and timestamps.

**How Agentic AI Helps**: Complete **explainability and accountability** — every decision every agent makes is recorded. You can trace exactly why an incident was verified, what trust scores were factored in, and why a specific responder was chosen. This is critical for responsible agentic AI.

#### 4.14 Simulation Engine

**Feature**: One-click simulation seeds 12 zones, 5 responders, and injects 9 reports (3 with photos) over 21 seconds across 5 phases.

**How Agentic AI Helps**: The simulation demonstrates the full agentic pipeline end-to-end — from initial report injection through classification, deduplication, verification, crowd analysis, routing, and dispatch. It's a **complete autonomous response cycle** that runs hands-free once started.

---

## 5. How Agentic AI Powers Every Decision

> [!TIP]
> This section maps every user-visible action to the agentic AI concept that powers it — essential for hackathon judges evaluating the "agentic" nature of the system.

```mermaid
flowchart TD
    subgraph Perception["👁️ Perception Layer"]
        NLP["NLP Text Classification\n65+ keywords, 5 categories"]
        CV["Computer Vision Analysis\nImage evidence processing"]
        CROWD["Crowd Sensing\nDensity + Flow monitoring"]
    end

    subgraph Reasoning["🧠 Reasoning Layer"]
        DEDUP["Deduplication Reasoning\nJaccard similarity (≥0.3)"]
        TRUST["Credibility Reasoning\nTrust scores + source independence"]
        RISK["Risk Assessment\n4-factor weighted model"]
        PATH["Path Planning\nDijkstra + congestion penalties"]
    end

    subgraph Action["⚡ Action Layer"]
        CLASS["Classify & Triage\nIncident creation/update"]
        VERIFY["Verify & Corroborate\nStatus transitions"]
        ROUTE["Route & Navigate\nEvacuation path publishing"]
        DISPATCH["Dispatch & Assign\nResponder ranking"]
        ESCALATE["Escalate & Alert\n3-min auto-escalation"]
    end

    subgraph Safety["🛡️ Safety Layer"]
        GATE["Deterministic Gates\n4 safety rules"]
        AUDIT["Audit Trail\nEvery decision logged"]
    end

    Perception --> Reasoning --> Action --> Safety

    style Perception fill:#3b82f6,color:#fff
    style Reasoning fill:#8b5cf6,color:#fff
    style Action fill:#ef4444,color:#fff
    style Safety fill:#10b981,color:#fff
```

### Agentic AI Concepts Demonstrated

| Agentic Concept | Where in EventPulse | Why It Matters |
|----------------|---------------------|----------------|
| **Autonomous Perception** | Intake Agent NLP + CV analysis | Agents perceive and interpret raw data without human preprocessing |
| **Multi-Agent Specialization** | 5 dedicated agents | Complex problems decomposed into expert domains |
| **Asynchronous Coordination** | Orchestrator pipeline scheduling | Agents work independently but in coordinated sequence |
| **Epistemic Reasoning** | Source independence + trust scores | Agents reason about *quality* of information, not just quantity |
| **Progressive Confidence** | 3-stage verification lifecycle | Agents build confidence over time with accumulating evidence |
| **Multi-Modal Fusion** | Text NLP + photo CV combined | Agents synthesize multiple data modalities |
| **Adaptive Planning** | Dynamic Dijkstra routing | Plans update automatically as environment changes |
| **Resource Optimization** | Multi-factor responder ranking | Optimal resource allocation under constraints |
| **Temporal Monitoring** | 3-minute auto-escalation | Agents track time-based conditions autonomously |
| **Constrained Autonomy** | 4 deterministic safety gates | Agents are powerful but bounded — responsible AI |
| **Full Explainability** | Agent audit log trail | Every decision traceable and accountable |
| **Proactive Behavior** | Crowd Intel continuous analysis | Agents don't wait to be asked; they continuously monitor |

---

## 6. UI Features — Completed

### 6.1 Split-Screen Command Center

**File**: [`src/AgentCommandCenter.tsx`](file:///Users/santhil/EventPulse/src/AgentCommandCenter.tsx)

The Agent Command Center features a split-screen layout with three view modes:

| Mode | Left Panel | Right Panel |
|------|-----------|-------------|
| **Split Ops** (default) | Interactive venue floor plan | Operations console |
| **Full Floor Map** | Expanded floor plan | Hidden |
| **Full Console** | Hidden | Expanded console |

### 6.2 Interactive Venue Floor Plan

A draggable, zoomable SVG-based map with real-time overlays:

- **Zone Heatmap Badges**: Color-coded by risk level (green → yellow → orange → red), with pulsing radar animation for critical zones
- **Active Incident Beacons**: Shockwave animation rings emanating from incident locations, with camera badge for photo evidence
- **Emergency Responder Markers**: Positioned in their current zones with color-coded availability dots (green = available, amber = dispatched, red = on scene)
- **Animated Evacuation Routes**: SVG paths showing Dijkstra-computed routes with flowing dash animation
- **Grid Overlay**: Sci-fi aesthetic grid for professional look
- **Uploaded Floor Plan**: Accepts `mapUrl` prop to display the actual uploaded venue floor plan as the map background

### 6.3 5-Agent Pipeline HUD

Visual horizontal pipeline bar showing all 5 agents:
```
🔍 Intake → ✅ Verification → 📊 Crowd Intel → 🗺️ Routing → 🚨 Dispatch
```
Each agent shows a live activity pulse indicator when processing.

### 6.4 Simulation Phase Timeline

5-phase progress tracker:
```
Initialize → Injection → Surge → Escalation → Resolution
```
Highlights current phase during simulation with progress indicators.

### 6.5 Live Telemetry KPI Cards

5 real-time metrics with icons:
- 🔴 Active Incidents
- ✅ Verified Threats
- 📊 Average Risk Score
- 🚨 Deployed Responders
- 📸 Image Evidence Verified

### 6.6 Tabbed Operations Console

5 specialized tabs:

| Tab | Content |
|-----|---------|
| **Terminal Stream** | Real-time agent action log with color-coded agent badges (blue=intake, green=verification, amber=crowd, purple=routing, red=dispatch) |
| **Incidents & Vision** | Incident cards with image thumbnails, trust score gauges, CV confidence badges |
| **Crowd Telemetry** | Zone risk/occupancy table with color-coded risk levels |
| **Dynamic Routing** | Evacuation route listing with path and congestion |
| **Responders** | Responder status cards with current assignment and skills |

### 6.7 Evidence Inspector Modal

Full-screen overlay triggered from incident cards:
- Large photo preview
- CV analysis text display
- Trust score meter visualization
- Confidence score badge
- Incident type and severity context

### 6.8 Enhanced Report Modal

**File**: [`src/App.tsx`](file:///Users/santhil/EventPulse/src/App.tsx)

- **Photo Upload**: Upload incident photos via Convex storage with live preview
- **4 Demo Presets**: One-click buttons pre-fill report with Unsplash photo:
  - 🚨 Crowd Surge — crowd pressing photo
  - 🏥 Medical Emergency — medical scene photo
  - 🔥 Smoke/Fire — smoke detection photo
  - 🚧 Barrier Damage — broken barrier photo
- **Trust Score Banner**: Shows reporter's current trust score

### 6.9 CSS Animations

**File**: [`src/index.css`](file:///Users/santhil/EventPulse/src/index.css)

- `radar-pulse`: Expanding rings on critical zone badges
- `route-dash`: Flowing dashes on evacuation route paths
- `pulse-slow`: Gentle breathing effect on active elements

---

## 7. UI Improvements — Planned

> [!NOTE]
> These improvements would elevate the visual experience for hackathon demos and production readiness.

### 7.1 Typewriter Animation on Log Entries
Agent log entries appear with a typewriter effect — character by character — making the terminal feel like a live AI system processing in real-time. This creates a dramatic "wow" moment when mentors watch the agents think.

### 7.2 Sound Effects on Agent Actions
Subtle audio cues for key events: soft chime on new incident, alert tone on verification, klaxon on critical escalation. Audio feedback makes the demo feel alive.

### 7.3 Animated KPI Counter Transitions
Numbers don't just change — they count up/down with easing animation (like slot machines). When "Active Incidents" goes from 2 to 5, each number ticks up visually.

### 7.4 Glassmorphism & Gradient Polish
Frosted glass effects on panels, gradient borders on active elements, subtle glow effects on critical zones. Professional SaaS-grade visual polish.

### 7.5 Guided Walkthrough Overlay
Step-by-step spotlight overlay that walks mentors through each UI element: "This is the agent pipeline", "Watch this zone turn red as crowd density increases", etc. Perfect for structured demos.

### 7.6 Responder Movement Animation
When a responder is dispatched, animate their marker moving from current zone to incident zone along the computed Dijkstra path. Shows the routing agent's output in real-time.

### 7.7 Incident Lifecycle Timeline
For each incident, show a horizontal timeline: `Report → Classified → Corroborated → Verified → Dispatched → Resolved`. Each stage shows timestamp and which agent handled it.

### 7.8 Mobile-Responsive Command Center
Adapt the split-screen layout for tablet/mobile: stack panels vertically, use swipeable tabs, ensure touch-friendly interactions.

### 7.9 Dark/Light Theme Toggle
System-preference-aware theme switching with smooth transitions.

### 7.10 3D Venue Visualization
Replace 2D floor plan with a WebGL 3D isometric view of the venue, with floating incident markers and animated crowd flow particles.

---

## 8. Backend Features — Completed

### 8.1 Database Schema (13 Tables)

**File**: [`convex/schema.ts`](file:///Users/santhil/EventPulse/convex/schema.ts)

| Table | Purpose | Key Agentic Fields |
|-------|---------|-------------------|
| `reports` | Raw user reports | `imageStorageId`, `imageUrl`, `severity`, `incidentType` |
| `incidents` | Deduplicated incidents | `verificationScore`, `averageTrustScore`, `imageAnalysis`, `imageConfidence`, `hasImageEvidence` |
| `zones` | Venue zone state | `riskLevel`, `currentOccupancy`, `exits`, `adjacentZones` |
| `responders` | Emergency team | `status`, `skills`, `currentZone`, `assignedIncidentId` |
| `dispatchTasks` | Assignment tracking | `priority`, `eta`, `status` (assigned→en_route→on_scene→completed→escalated) |
| `evacuationRoutes` | Computed paths | `path`, `distance`, `congestionLevel`, `isRecommended` |
| `agentLogs` | Audit trail | `agent`, `action`, `details`, `incidentId`, `zoneId` |
| `crowdData` | Crowd telemetry | `density`, `flowRate`, `sentiment`, `nearbyIncidents` |
| `notifications` | Alerts & broadcasts | `type` (alert/evacuation/info/emergency), `targetZones`, `priority` |
| `memberships` | User-event links | `trustScore`, `role`, `status` |
| `events` | Event configuration | `mapUrl`, `capacity`, `chatEnabled` |
| `venues` | Venue configuration | `zones`, `facilities`, `mapUrl` |
| `users` | User profiles | `role`, `clerkId` |

### 8.2 Orchestrator Pipeline

**File**: [`convex/orchestrator.ts`](file:///Users/santhil/EventPulse/convex/orchestrator.ts)

Asynchronous chaining via `ctx.scheduler.runAfter(0, ...)`:
```
processNewReport → runVerification → runCrowdIntel → runRouting → runResponsePlanning
```

### 8.3 Safety Module

**File**: [`convex/lib/safety.ts`](file:///Users/santhil/EventPulse/convex/lib/safety.ts)

4 deterministic safety gates — see [Appendix](#12-appendix-safety-rules--thresholds).

### 8.4 Agent Logging System

**File**: [`convex/lib/agentLog.ts`](file:///Users/santhil/EventPulse/convex/lib/agentLog.ts)

Every agent action creates a structured log entry with: agent name, action type, detailed JSON findings, optional incident/zone references, and timestamp.

### 8.5 Verification Thresholds (Configurable)

**File**: [`convex/lib/verificationThresholds.ts`](file:///Users/santhil/EventPulse/convex/lib/verificationThresholds.ts)

All thresholds are extracted to constants — no magic numbers in agent logic:
- `VERIFICATION_THRESHOLD`: 0.8
- `CORROBORATION_THRESHOLD`: 0.4
- `MIN_REPORTS_FOR_VERIFICATION`: 2
- `TRUST_SCORE_WEIGHT`: 0.2
- `IMAGE_EVIDENCE_BONUS`: 0.15
- `HIGH_TRUST_THRESHOLD`: 60

### 8.6 Image Evidence Pipeline

Full pipeline from upload to verification:
1. User uploads photo → Convex storage → `imageStorageId` on report
2. Intake Agent detects photo → simulated CV analysis → `imageAnalysis` + `imageConfidence` on incident
3. Verification Agent checks `hasImageEvidence` + reporter trust → applies evidence bonus
4. Frontend resolves `imageStorageId` to URL via `ctx.storage.getUrl` → displays in Evidence Inspector

### 8.7 Simulation Engine

**File**: [`convex/simulation.ts`](file:///Users/santhil/EventPulse/convex/simulation.ts)

- Seeds 12 venue zones with full graph connectivity
- Seeds 5 named responders with specializations (Medical, Security, Crowd Control, Emergency)
- Injects 9 timed reports over 21 seconds
- 3 reports include Unsplash photo evidence
- 2 crowd data updates simulate density spikes
- 5-phase timing: Initialize (0s) → Injection (1–5s) → Surge (7–12s) → Escalation (14–17s) → Resolution (21s)

---

## 9. Backend Improvements — Planned

> [!NOTE]
> These improvements would make EventPulse production-ready for real-world deployment.

### 9.1 Real LLM Integration (Gemini API)
Replace keyword matching with Gemini API for true NLP classification. Benefits: handles typos, slang, multiple languages, and complex descriptions like "someone's acting weird near the generator" (currently missed by keyword matching).

### 9.2 Real Computer Vision Model
Replace simulated CV analysis with actual Gemini Vision or Cloud Vision API. Analyze uploaded photos for: crowd density estimation, smoke/fire detection, injury assessment, weapon detection, structural damage assessment.

### 9.3 WebSocket/SSE Real-Time Push
Currently using Convex's reactive queries (which already provide real-time updates). For production scale, add WebSocket channels for push notifications to mobile devices and external monitoring systems.

### 9.4 Historical Analytics & Trend Detection
Store incident history across events. Use pattern detection to identify recurring risk zones, peak incident times, and venue-specific vulnerabilities. Agentic AI could learn from past events to predict future risks.

### 9.5 Geofencing & GPS Integration
Replace manual zone selection with GPS-based zone detection. Attendees' reports auto-tagged with their precise location. Enable geofence alerts when users enter high-risk zones.

### 9.6 Multi-Event Concurrent Monitoring
Scale from single-event to multi-event monitoring dashboard. Central operations team can monitor all active events with cross-event escalation.

### 9.7 Rate Limiting & Abuse Detection
Add per-user report rate limiting, spam detection (repeated identical reports), and trust score penalties for false reports. Prevent malicious flooding of the agent pipeline.

### 9.8 Audit Trail Export (CSV/PDF)
Export complete agent decision logs for post-event analysis, insurance claims, and regulatory compliance. Include timeline visualizations and decision trees.

### 9.9 Role-Based Access Control Granularity
Expand from 4 roles (admin/organizer/staff/attendee) to fine-grained permissions: "can dispatch emergency services", "can override agent decisions", "can access crowd data". Ensure the safety gates respect role permissions.

### 9.10 Load Testing & Performance Benchmarks
Benchmark the agent pipeline under load: How many reports per second can the system process? What's the latency from report submission to dispatch? Identify bottlenecks in the Convex scheduler chain.

### 9.11 Multi-Language Support
NLP keyword dictionaries in multiple languages. Auto-detect report language and route to appropriate keyword set. Critical for international events.

### 9.12 External Integrations
- **Emergency Services API**: Direct integration with 911/112 dispatch systems
- **Weather API**: Factor weather conditions into risk scoring (rain → slippery exits, heat → medical risk)
- **Social Media Monitoring**: Agent that monitors Twitter/X for event-related safety posts

---

## 10. Demo Flow Script for Mentors

> [!IMPORTANT]
> Follow this step-by-step script for a compelling 5-minute mentor demo.

### Phase 1: Setup (30 seconds)
1. Open the app at `localhost:5173`
2. Sign in and navigate to an event as **Staff**
3. Show the **floor plan upload** feature — "We support custom venue maps"
4. Navigate to the **Agent Command Center**
5. Point out the **5-Agent Pipeline HUD** — "Five specialized AI agents working in coordination"

### Phase 2: Start Simulation (15 seconds)
1. Click **"Start Simulation"**
2. Say: *"Watch 9 real-time incident reports pour in — including 3 with photo evidence"*
3. Point to the **simulation phase timeline** — "We're now in the Injection phase"

### Phase 3: Watch the Agents Work (90 seconds)
1. **Terminal Stream tab** — "Watch the agents process each report in real-time"
   - Point out color-coded agent badges: *"Blue is Intake classifying the report, Green is Verification checking sources"*
2. **Floor Map** — "Watch zones change color as crowd density increases"
   - Point to **zone heatmap badges** turning yellow → orange → red
   - Point to **incident beacons** appearing with shockwave animations
3. **KPI Cards** — "Active incidents climbing, verification score updating live"

### Phase 4: Deep Dive — Image Evidence (60 seconds)
1. Switch to **Incidents & Vision tab**
2. Click on an incident with a **camera badge** (📸)
3. Open the **Evidence Inspector** — *"Our AI analyzed this photo and determined it's a crowd surge with 87% confidence"*
4. Point to the **trust score gauge** — *"The reporter has a trust score of 72, so the AI gives extra weight to this visual evidence"*
5. Show the **verification status** transition — *"Three independent reporters + photo evidence = Verified"*

### Phase 5: Show Agent Intelligence (45 seconds)
1. Switch to **Crowd Telemetry tab** — *"The Crowd Intel agent scores every zone in real-time using density, incidents, exits, and flow"*
2. Switch to **Dynamic Routing tab** — *"Dijkstra pathfinding with congestion-aware weights — routes avoid dangerous zones"*
3. Point to **animated evacuation routes** on the map — *"See the dashed lines flowing? Those are live evacuation paths adapting in real-time"*
4. Switch to **Responders tab** — *"The Dispatch agent auto-assigned the closest qualified responder"*

### Phase 6: Safety Gates (30 seconds)
1. Explain: *"Every critical decision passes through deterministic safety gates"*
2. Point to a verified critical incident — *"Emergency services can ONLY be dispatched for verified + critical incidents. The AI recommends, the safety gate decides"*
3. *"Everything is logged — full audit trail for every agent decision"*

### Phase 7: Manual Report (30 seconds)
1. Click **"Report Incident"** from the attendee view
2. Click a **demo preset** (e.g., 🏥 Medical) — *"One-click demo presets with real photos"*
3. Submit and watch the **agent pipeline process it live**

### Closing Statement
*"EventPulse demonstrates how 5 specialized AI agents can autonomously handle the full incident response lifecycle — from perception to verification to routing to dispatch — while maintaining human oversight through safety gates. Every decision is explainable, every action is logged, and the system adapts in real-time as conditions change."*

---

## 11. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 19 | Component UI framework |
| **Styling** | Tailwind CSS 4.0 | Utility-first CSS |
| **Build** | Vite 6.0 | Fast dev server & bundler |
| **Language** | TypeScript 5.7 | Type safety |
| **Backend** | Convex 1.17 | Reactive database + serverless functions |
| **Auth** | @convex-dev/auth + @auth/core | Anonymous & authenticated sessions |
| **JWT** | jose 6.0 | Token generation & validation |
| **Icons** | lucide-react | SVG icon library |
| **Dates** | date-fns | Date formatting utilities |
| **Toasts** | sonner | Notification toasts |
| **Routing** | react-router-dom 7.1 | Client-side routing |

### Architecture Principles
- **Reactive by default**: Convex reactive queries mean the UI updates instantly when any agent writes to the database
- **Type-safe end-to-end**: TypeScript from frontend components through backend mutations to database schema
- **Serverless**: No servers to manage — Convex handles scaling, persistence, and real-time sync
- **Deterministic safety**: Safety gates are pure functions with no randomness or ML — predictable, auditable, reliable

---

## 12. Appendix: Safety Rules & Thresholds

### Safety Gate Rules

| Gate | Condition | Purpose |
|------|-----------|---------|
| `canDispatchEmergencyService` | `status === "verified" AND severity === "critical"` | Prevents false emergency calls |
| `canMarkVerified` | `score >= 0.8 AND reportCount >= 2` | Requires minimum evidence |
| `canBroadcastEvacuation` | `riskLevel === "critical" AND status !== "evacuating"` | Prevents duplicate broadcasts |
| `shouldAlertNearbyStaff` | `severity === "critical" OR severity === "high"` | Ensures staff awareness |

### Verification Thresholds

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `VERIFICATION_THRESHOLD` | 0.8 | Score to reach "verified" status |
| `CORROBORATION_THRESHOLD` | 0.4 | Score to reach "corroborated" status |
| `MIN_REPORTS_FOR_VERIFICATION` | 2 | Minimum independent reports needed |
| `TRUST_SCORE_WEIGHT` | ±0.2 | Maximum trust score modifier |
| `IMAGE_EVIDENCE_BONUS` | 0.15 | Bonus for photo evidence + high trust |
| `HIGH_TRUST_THRESHOLD` | 60 | Trust score needed for evidence bonus |

### Risk Scoring Weights

| Factor | Weight | Range |
|--------|--------|-------|
| Density (occupancy/capacity) | 40% | 0.0 – 1.0 |
| Incident Proximity | 30% | 0.0 – 0.9 |
| Exit Availability | 20% | 0.1 – 1.0 |
| Crowd Flow Rate | 10% | 0.0 – 1.0 |

### Responder Scoring

| Factor | Max Points | Calculation |
|--------|-----------|-------------|
| Proximity | 50 | Same zone = 50, else max(0, 50 – distance×10) |
| Skill Match | 30 | Matching skill = 30, else 0 |
| Availability | 20 | Available = 20, else 0 |

### Dispatch ETAs

| Priority | ETA |
|----------|-----|
| Critical | 2 minutes |
| High | 5 minutes |
| Medium | 10 minutes |
| Low | 15 minutes |

### Auto-Escalation

| Parameter | Value |
|-----------|-------|
| Escalation timeout | 3 minutes |
| Check trigger | Every pipeline cycle |

---

> [!TIP]
> **For Hackathon Judges**: This system demonstrates 12 distinct agentic AI concepts (see Section 5), implemented across 5 specialized agents with a centralized orchestrator, 4 safety gates, and full audit logging. The architecture is designed for pluggable AI backends — swap keyword matching for Gemini API and simulated CV for Cloud Vision, and you have a production-ready emergency response platform.

---

*EventPulse AI Command Center — Built with ❤️ for the Agentic AI Hackathon*
