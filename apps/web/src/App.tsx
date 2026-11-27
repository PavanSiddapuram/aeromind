import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BatteryWarning,
  Bot,
  CheckCircle2,
  Construction,
  Flame,
  Play,
  Radio,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  FLOOD_SCENARIO,
  VERIFIER_POLICY_VERSION,
  type DroneState,
  type EnvironmentMutationEvent,
  type MissionConstraints,
  type MissionEvent,
  type MissionPlan,
  type MissionStatus,
  type RescueTarget,
  type ResolvedRoute,
  type RouteApproval,
  type ScenarioObstacle,
  type Vector3,
  type VerificationReport,
} from "@aeromind/shared";
import DroneSimulation from "./components/DroneSimulation";
import type { AeroMindScene, RouteVisualMode } from "./scene/AeroMindScene";

type HealthResponse = {
  status: string;
  service: string;
  environment: string;
  planner?: {
    provider: string;
    model: string;
    configured: boolean;
  };
  timestamp: string;
};

type ReplanOutcome =
  | "none"
  | "unchanged_valid"
  | "local_astar"
  | "ai_replan"
  | "safe_hold";

type MissionSnapshot = {
  missionId: string;
  scenarioId: string;
  status: MissionStatus;
  instruction: string;
  constraints: MissionConstraints;
  environmentVersion: number;
  policyVersion: string;
  drone: DroneState;
  headingRad: number;
  windMetersPerSecond: number;
  obstacles: ScenarioObstacle[];
  targets: RescueTarget[];
  plan: MissionPlan | null;
  plannerModel: string | null;
  plannerLatencyMs: number | null;
  lastReplanOutcome: ReplanOutcome;
  repairAttemptsUsed: number;
  route: ResolvedRoute | null;
  verification: VerificationReport | null;
  lastRejectedVerification: VerificationReport | null;
  lastRejectedWaypoints: Vector3[] | null;
  approval: RouteApproval | null;
  events: MissionEvent[];
};

const DEFAULT_MISSION_ID = "mission-demo-001";

const MISSION_PRESETS = [
  {
    label: "East Block Priority",
    prompt:
      "Survey the eastern block first and prioritize urgent rooftop rescue targets.",
  },
  {
    label: "Full District Sweep",
    prompt:
      "Inspect all reachable rooftop beacons across East, West, and South blocks in priority order.",
  },
  {
    label: "West Clinic Rapid Check",
    prompt:
      "Perform a direct inspection of the West Medical Clinic rooftop only and return home with maximum battery margin.",
  },
] as const;

function formatReplanLabel(outcome: ReplanOutcome): string {
  switch (outcome) {
    case "local_astar":
      return "LOCAL A* REROUTE";
    case "ai_replan":
      return "AI MISSION REPLAN";
    case "unchanged_valid":
      return "ROUTE STILL VALID";
    case "safe_hold":
      return "SAFE HOLD";
    case "none":
      return "INITIAL";
  }
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    if (body.error?.message) {
      return `${body.error.code ?? "ERROR"}: ${body.error.message}`;
    }
  } catch {
    // ignore parse failure
  }
  return `HTTP ${response.status}`;
}

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [missionId] = useState(DEFAULT_MISSION_ID);
  const [instruction, setInstruction] = useState<string>(
    MISSION_PRESETS[0].prompt,
  );
  const [maxAltitudeMeters, setMaxAltitudeMeters] = useState<number>(
    FLOOD_SCENARIO.defaultConstraints.maxAltitudeMeters,
  );
  const [minLandingReservePercent, setMinLandingReservePercent] =
    useState<number>(
      FLOOD_SCENARIO.defaultConstraints.minLandingReservePercent,
    );
  const [includeSceneStill, setIncludeSceneStill] = useState<boolean>(false);
  const [inspectRejectedOverlay, setInspectRejectedOverlay] =
    useState<boolean>(false);

  const [mission, setMission] = useState<MissionSnapshot | null>(null);
  const [sseEvents, setSseEvents] = useState<MissionEvent[]>([]);
  const [sseConnected, setSseConnected] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const sceneInstanceRef = useRef<AeroMindScene | null>(null);

  const handleSceneReady = useCallback((scene: AeroMindScene | null) => {
    sceneInstanceRef.current = scene;
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health");
      if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
      const data = (await response.json()) as HealthResponse;
      setHealth(data);
      setHealthError(null);
    } catch (error) {
      setHealthError(
        error instanceof Error ? error.message : "API unavailable",
      );
    }
  }, []);

  const fetchSnapshot = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/mission/${encodeURIComponent(id)}`);
      if (response.status === 404) return;
      if (!response.ok) return;
      const snapshot = (await response.json()) as MissionSnapshot;
      setMission(snapshot);
    } catch {
      // Ignore transient poll errors; SSE/manual refresh will recover.
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    void fetchSnapshot(missionId);
  }, [fetchSnapshot, missionId, refreshHealth]);

  // Connect live SSE stream for monotonic event trace + automatic state sync.
  useEffect(() => {
    const source = new EventSource(
      `/api/mission/${encodeURIComponent(missionId)}/events`,
    );

    source.onopen = () => {
      setSseConnected(true);
      void fetchSnapshot(missionId);
    };

    source.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as MissionEvent;
        setSseEvents((prev) => {
          if (prev.some((e) => e.eventId === parsed.eventId)) return prev;
          const merged = [...prev, parsed].sort(
            (a, b) => a.sequence - b.sequence,
          );
          return merged.slice(-120);
        });
        void fetchSnapshot(missionId);
      } catch {
        // Ignore malformed event frame
      }
    };

    source.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      source.close();
      setSseConnected(false);
    };
  }, [fetchSnapshot, missionId]);

  // Smooth telemetry polling while simulation is actively flying on the server.
  useEffect(() => {
    if (mission?.status !== "executing") return;
    const interval = window.setInterval(() => {
      void fetchSnapshot(missionId);
    }, 180);
    return () => window.clearInterval(interval);
  }, [fetchSnapshot, mission?.status, missionId]);

  const currentEnvVersion = mission?.environmentVersion ?? 1;
  const activeEvents = useMemo(
    () => (sseEvents.length > 0 ? sseEvents : (mission?.events ?? [])),
    [mission?.events, sseEvents],
  );

  const captureOptionalStill = (): string | undefined => {
    if (!includeSceneStill || !sceneInstanceRef.current) return undefined;
    try {
      return sceneInstanceRef.current.captureStillDataUrl();
    } catch {
      return undefined;
    }
  };

  const handlePlanMission = async () => {
    setBusyAction("plan");
    setActionError(null);
    setInspectRejectedOverlay(false);

    try {
      const sceneImageDataUrl = captureOptionalStill();
      const response = await fetch("/api/mission/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          missionId,
          scenarioId: FLOOD_SCENARIO.id,
          instruction,
          constraints: {
            maxAltitudeMeters,
            minLandingReservePercent,
          },
          expectedEnvironmentVersion: currentEnvVersion,
          ...(sceneImageDataUrl ? { sceneImageDataUrl } : {}),
        }),
      });

      if (!response.ok) {
        const errText = await readApiError(response);
        await fetchSnapshot(missionId);
        throw new Error(errText);
      }

      const data = (await response.json()) as { mission: MissionSnapshot };
      setMission(data.mission);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Mission planning failed",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleReverify = async () => {
    if (!mission?.route) return;
    setBusyAction("verify");
    setActionError(null);

    try {
      const response = await fetch("/api/mission/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          missionId,
          routeId: mission.route.routeId,
          expectedEnvironmentVersion: mission.environmentVersion,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      await fetchSnapshot(missionId);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Verification request failed",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleExecute = async () => {
    if (!mission?.route || !mission.approval) return;
    setBusyAction("execute");
    setActionError(null);
    setInspectRejectedOverlay(false);

    try {
      const response = await fetch("/api/mission/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          missionId,
          routeId: mission.route.routeId,
          approvalId: mission.approval.approvalId,
          expectedEnvironmentVersion: mission.environmentVersion,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const data = (await response.json()) as { mission: MissionSnapshot };
      setMission(data.mission);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Execution authorization failed",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleInjectEvent = async (
    label: string,
    event: EnvironmentMutationEvent,
  ) => {
    if (!mission) {
      setActionError(
        "Start or initialize a mission first so environment mutations bind to an active mission version.",
      );
      return;
    }

    setBusyAction(label);
    setActionError(null);

    try {
      const sceneImageDataUrl = captureOptionalStill();
      const response = await fetch("/api/mission/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          missionId,
          expectedEnvironmentVersion: mission.environmentVersion,
          event,
          ...(sceneImageDataUrl ? { sceneImageDataUrl } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const data = (await response.json()) as { mission: MissionSnapshot };
      setMission(data.mission);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Environment event failed",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleReset = async () => {
    setBusyAction("reset");
    setActionError(null);
    setInspectRejectedOverlay(false);

    try {
      const response = await fetch(
        `/api/mission/${encodeURIComponent(missionId)}/reset`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const fresh = (await response.json()) as MissionSnapshot;
      setMission(fresh);
      setSseEvents([]);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Reset failed",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const canExecute =
    mission !== null &&
    mission.status === "ready" &&
    mission.approval !== null &&
    !mission.approval.revokedAt &&
    !mission.approval.consumedAt &&
    mission.approval.environmentVersion === mission.environmentVersion;

  const showingRejectedRoute =
    inspectRejectedOverlay &&
    mission?.lastRejectedWaypoints !== null &&
    mission?.lastRejectedWaypoints !== undefined;

  const sceneWaypoints = showingRejectedRoute
    ? (mission?.lastRejectedWaypoints ?? undefined)
    : (mission?.route?.waypoints ?? undefined);

  const sceneReturnWaypoints = showingRejectedRoute
    ? undefined
    : (mission?.route?.returnWaypoints ?? undefined);

  const sceneRouteMode: RouteVisualMode = showingRejectedRoute
    ? "rejected"
    : mission?.status === "executing"
      ? "executing"
      : mission?.verification?.approved
        ? "approved"
        : mission?.verification && !mission.verification.approved
          ? "rejected"
          : "preview";

  const activeViolations = showingRejectedRoute
    ? (mission?.lastRejectedVerification?.violations ?? [])
    : (mission?.verification && !mission.verification.approved
        ? mission.verification.violations
        : (mission?.lastRejectedVerification?.violations ?? []));

  const activeVerification = mission?.verification ?? null;

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="AeroMind home">
          <span className="brand-mark">
            <Activity size={19} />
          </span>
          <span>AEROMIND</span>
          <span className="version">MISSION CONSOLE</span>
        </a>
        <div className="topbar-right">
          <span
            className={`status-dot ${health?.planner?.configured ? "" : "warn"}`}
          />
          {health
            ? `API ONLINE · ${health.planner?.configured ? "PLANNER READY" : "PLANNER UNCONFIGURED"}`
            : healthError
              ? "API OFFLINE"
              : "CONNECTING…"}
          <span className="sse-badge">
            <Radio size={12} /> {sseConnected ? "SSE LIVE" : "SSE SYNC"}
          </span>
        </div>
      </header>

      <section className="hero compact-hero">
        <div className="eyebrow">
          <span /> NEURO-SYMBOLIC DISASTER RESPONSE
        </div>
        <h1>
          AI proposes. <em>Geometry verifies.</em>
        </h1>
        <p className="hero-copy">
          Operators express rescue priorities in natural language. The neural
          planner selects structured target objectives by ID only; deterministic
          code resolves 3D A* corridors, verifies obstacle, geofence, altitude,
          and return-reserve bounds, and gates simulated flight on version-bound
          approvals.
        </p>
        <div className="principle">
          <ShieldCheck size={18} />
          No simulated movement without an unrevoked approval bound to the active
          environment version ({VERIFIER_POLICY_VERSION}).
        </div>
      </section>

      {health && !health.planner?.configured && (
        <div className="banner-warning" role="status">
          <AlertTriangle size={18} />
          <div>
            <strong>Planner credentials are not configured on the server yet.</strong>{" "}
            Configure the server environment key and restart the API to enable live
            mission planning. Without credentials, planning fails closed into{" "}
            <code>safe_hold</code>.
          </div>
        </div>
      )}

      {actionError && (
        <div className="banner-error" role="alert">
          <ShieldAlert size={18} />
          <div>{actionError}</div>
        </div>
      )}

      <div className="workspace-grid">
        <div className="workspace-main">
          <DroneSimulation
            missionStatus={mission?.status ?? "idle"}
            environmentVersion={currentEnvVersion}
            drone={mission?.drone}
            headingRad={mission?.headingRad}
            obstacles={mission?.obstacles}
            targets={mission?.targets}
            waypoints={sceneWaypoints}
            returnWaypoints={sceneReturnWaypoints}
            routeMode={sceneRouteMode}
            violations={activeViolations}
            onSceneReady={handleSceneReady}
          />

          {mission?.lastRejectedVerification && (
            <div className="overlay-toggle-bar">
              <span>
                <ShieldAlert size={14} /> Prior route rejected on ENV v
                {mission.lastRejectedVerification.environmentVersion} (
                {mission.lastRejectedVerification.violations
                  .map((v) => v.code)
                  .join(", ")}
                ) · Recovery:{" "}
                <strong>{formatReplanLabel(mission.lastReplanOutcome)}</strong>
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => setInspectRejectedOverlay((v) => !v)}
              >
                {inspectRejectedOverlay
                  ? "Show Verified Reroute"
                  : "Inspect Rejected Path"}
              </button>
            </div>
          )}

          {/* Chaos & Dynamic Environment Controls */}
          <section className="panel chaos-panel" aria-label="Chaos injection controls">
            <div className="panel-header-row">
              <div>
                <div className="panel-kicker">DYNAMIC ENVIRONMENT & FAULT INJECTION</div>
                <h2>Chaos & Replanning Triggers</h2>
              </div>
              <span className="env-pill">ENV v{currentEnvVersion}</span>
            </div>
            <p className="panel-subcopy">
              Injecting any material change atomically pauses active execution,
              increments <code>environmentVersion</code>, revokes prior approvals,
              and triggers deterministic local A* rerouting before bounded mission
              replanning (max 2 attempts).
            </p>
            <div className="chaos-buttons">
              <button
                type="button"
                className="btn btn-chaos"
                disabled={busyAction !== null || !mission}
                onClick={() =>
                  void handleInjectEvent("crane", {
                    type: "obstacle.spawned",
                    obstacleId: "crane-01",
                  })
                }
              >
                <Construction size={15} />
                Spawn South Crane (Local A* Reroute)
              </button>

              <button
                type="button"
                className="btn btn-chaos"
                disabled={busyAction !== null || !mission}
                onClick={() =>
                  void handleInjectEvent("debris", {
                    type: "obstacle.spawned",
                    obstacleId: "debris-north-01",
                  })
                }
              >
                <Flame size={15} />
                Block ROOF-03 Debris (Mission Replan)
              </button>

              <button
                type="button"
                className="btn btn-chaos"
                disabled={busyAction !== null || !mission}
                onClick={() =>
                  void handleInjectEvent("battery-sag", {
                    type: "battery.changed",
                    batteryPercent: 52,
                    reason: "Simulated cell sag to 52%",
                  })
                }
              >
                <BatteryWarning size={15} />
                Battery Sag → 52% (Shed Targets)
              </button>

              <button
                type="button"
                className="btn btn-chaos danger"
                disabled={busyAction !== null || !mission}
                onClick={() =>
                  void handleInjectEvent("battery-crit", {
                    type: "battery.changed",
                    batteryPercent: 22,
                    reason: "Critical reserve breach → 22%",
                  })
                }
              >
                <AlertTriangle size={15} />
                Critical Battery → 22% (Safe Hold)
              </button>

              <button
                type="button"
                className="btn btn-chaos accent"
                disabled={busyAction !== null || !mission}
                onClick={() =>
                  void handleInjectEvent("target-flare", {
                    type: "target.discovered",
                    targetId: "ROOF-05",
                  })
                }
              >
                <Sparkles size={15} />
                Discover Urgent Flare (ROOF-05)
              </button>
            </div>
          </section>
        </div>

        {/* Right Column: Mission Command & Verification Gate */}
        <aside className="workspace-side">
          <section className="panel command-panel">
            <div className="panel-header-row">
              <div>
                <div className="panel-kicker">01 / OPERATOR COMMAND</div>
                <h2>Mission Control</h2>
              </div>
              <span className={`status-chip status-${mission?.status ?? "idle"}`}>
                {(mission?.status ?? "idle").toUpperCase()}
              </span>
            </div>

            <div className="preset-chips">
              {MISSION_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="chip-btn"
                  onClick={() => setInstruction(preset.prompt)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <label className="field-label" htmlFor="mission-instruction">
              Natural-language rescue objective
            </label>
            <textarea
              id="mission-instruction"
              className="mission-textarea"
              rows={3}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />

            <div className="constraints-row">
              <div>
                <label className="field-label" htmlFor="max-altitude">
                  Max Altitude (m)
                </label>
                <input
                  id="max-altitude"
                  type="number"
                  min={15}
                  max={80}
                  className="number-input"
                  value={maxAltitudeMeters}
                  onChange={(e) =>
                    setMaxAltitudeMeters(Number(e.target.value) || 40)
                  }
                />
              </div>
              <div>
                <label className="field-label" htmlFor="min-reserve">
                  Min Reserve (%)
                </label>
                <input
                  id="min-reserve"
                  type="number"
                  min={10}
                  max={60}
                  className="number-input"
                  value={minLandingReservePercent}
                  onChange={(e) =>
                    setMinLandingReservePercent(Number(e.target.value) || 20)
                  }
                />
              </div>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={includeSceneStill}
                onChange={(e) => setIncludeSceneStill(e.target.checked)}
              />
              <span>Attach 3D scene still image to planner request (multimodal)</span>
            </label>

            <div className="action-buttons">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busyAction !== null || instruction.trim().length < 3}
                onClick={() => void handlePlanMission()}
              >
                <Bot size={16} />
                {busyAction === "plan"
                  ? "Planning & Verifying…"
                  : "Plan & Verify Mission"}
              </button>

              <button
                type="button"
                className="btn btn-execute"
                disabled={busyAction !== null || !canExecute}
                onClick={() => void handleExecute()}
              >
                <Play size={16} />
                {busyAction === "execute"
                  ? "Authorizing…"
                  : canExecute
                    ? "Authorize & Execute Approved Route"
                    : "Execution Locked (Needs Current Approval)"}
              </button>

              <div className="secondary-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busyAction !== null || !mission?.route}
                  onClick={() => void handleReverify()}
                >
                  Re-Verify Route
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busyAction !== null}
                  onClick={() => void handleReset()}
                >
                  <RotateCcw size={14} /> Reset Demo
                </button>
              </div>
            </div>
          </section>

          {/* Deterministic Verifier & Approval Record */}
          <section className="panel verifier-panel">
            <div className="panel-header-row">
              <div>
                <div className="panel-kicker">02 / DETERMINISTIC FEASIBILITY FACTS</div>
                <h2>Verifier & Approval Gate</h2>
              </div>
              {activeVerification && (
                <span
                  className={`tag ${activeVerification.approved ? "ready" : "rejected"}`}
                >
                  {activeVerification.approved
                    ? "Passed simulation checks"
                    : "Rejected"}
                </span>
              )}
            </div>

            {activeVerification ? (
              <div className="kv-stack">
                <div className="kv-grid">
                  <div>
                    <span>Mission Energy</span>
                    <strong>
                      {activeVerification.estimatedMissionEnergyPercent.toFixed(1)}%
                    </strong>
                  </div>
                  <div>
                    <span>Return (RTH)</span>
                    <strong>
                      {activeVerification.estimatedReturnEnergyPercent.toFixed(1)}%
                    </strong>
                  </div>
                  <div>
                    <span>Projected Reserve</span>
                    <strong
                      className={
                        activeVerification.energy.feasible ? "ok-text" : "err-text"
                      }
                    >
                      {activeVerification.projectedLandingReservePercent.toFixed(1)}%
                      {" / "}
                      {activeVerification.energy.requiredReservePercent}% min
                    </strong>
                  </div>
                  <div>
                    <span>Approval Token</span>
                    <strong>
                      {mission?.approval && !mission.approval.revokedAt
                        ? `${mission.approval.approvalId} (v${mission.approval.environmentVersion})`
                        : "NONE / REVOKED"}
                    </strong>
                  </div>
                </div>

                {activeViolations.length > 0 && (
                  <div className="violation-list">
                    <div className="violation-title">Recorded Violations</div>
                    {activeViolations.map((v, idx) => (
                      <div key={`${v.code}-${idx}`} className="violation-item">
                        <code>{v.code}</code>
                        <span>{v.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="empty-copy">
                No route verified yet. Submit a mission plan to run segment/AABB,
                geofence, altitude, and RTH reserve checks.
              </p>
            )}

            <div className="coeff-footnote">
              Configured energy model (uncalibrated synthetic %):{" "}
              {FLOOD_SCENARIO.energyConfig.travelPercentPerMeter}%/m travel ·{" "}
              {FLOOD_SCENARIO.energyConfig.climbPercentPerMeter}%/m climb ·{" "}
              {(FLOOD_SCENARIO.energyConfig.windFactorPerMeterPerSecond * 100).toFixed(0)}
              %/(m/s) wind · {FLOOD_SCENARIO.energyConfig.inspectionOperationPercent}
              %/target dwell.
            </div>
          </section>
        </aside>
      </div>

      {/* Bottom Inspection Row: Planner Proposal + Targets + SSE Event Timeline */}
      <section className="inspection-grid" aria-label="Plan and event telemetry">
        <article className="panel">
          <div className="panel-kicker">03 / PROBABILISTIC PLANNER PROPOSAL</div>
          <h2>Planner Decision Summary</h2>
          {mission?.plan ? (
            <div className="plan-details">
              <p className="decision-quote">{mission.plan.decisionSummary}</p>
              <div className="meta-badges">
                {mission.plannerLatencyMs !== null && (
                  <span className="mini-pill">
                    Planner latency: {mission.plannerLatencyMs} ms
                  </span>
                )}
                <span className="mini-pill">
                  Pattern: {mission.plan.searchPattern}
                </span>
                <span className="mini-pill">
                  Plan status: {mission.plan.missionStatus}
                </span>
              </div>
              <div className="id-sequence">
                <strong>Target order:</strong>{" "}
                {mission.plan.targetOrder.length > 0
                  ? mission.plan.targetOrder.join(" → ")
                  : "None"}
              </div>
              {mission.plan.abortedObjectives.length > 0 && (
                <div className="id-sequence warn-text">
                  <strong>Aborted objectives:</strong>{" "}
                  {mission.plan.abortedObjectives.join(", ")}
                </div>
              )}
              {mission.route && (
                <div className="id-sequence muted-text">
                  <strong>Resolved A* graph path ({mission.route.distanceMeters.toFixed(0)}m + {mission.route.returnDistanceMeters.toFixed(0)}m RTH):</strong>{" "}
                  {mission.route.nodeIds.join(" → ")}
                </div>
              )}
            </div>
          ) : (
            <p className="empty-copy">
              Awaiting first mission request. The planner receives only canonical
              target and graph-node IDs, never raw world coordinates.
            </p>
          )}

          <div className="targets-mini-list">
            {(mission?.targets ?? FLOOD_SCENARIO.targets).map((target) => (
              <div key={target.id} className="target-row">
                <div>
                  <strong>{target.id}</strong> · {target.label} ({target.sector}, P
                  {target.priority})
                </div>
                <span className={`target-badge target-${target.status}`}>
                  {target.status === "visited" && <CheckCircle2 size={12} />}
                  {target.status}
                </span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header-row">
            <div>
              <div className="panel-kicker">04 / AUTHORITATIVE AUDIT TRACE</div>
              <h2>Live SSE Event Timeline</h2>
            </div>
            <span className="mini-pill">{activeEvents.length} events</span>
          </div>

          {activeEvents.length > 0 ? (
            <ol className="timeline-list">
              {[...activeEvents].reverse().map((evt) => (
                <li key={evt.eventId} className="timeline-item">
                  <div className="timeline-top">
                    <span className="seq-tag">#{evt.sequence}</span>
                    <code className="evt-type">{evt.type}</code>
                    <span className="evt-ver">ENV v{evt.environmentVersion}</span>
                    <span className="evt-time">
                      {new Date(evt.occurredAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="timeline-payload">
                    {JSON.stringify(evt.payload)}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-copy">
              Monotonic mission events stream here over Server-Sent Events (
              <code>/api/mission/{missionId}/events</code>).
            </p>
          )}
        </article>
      </section>

      <footer>
        <span>AEROMIND / AUTONOMOUS MISSION VALIDATION CONSOLE</span>
        <span>POLICY {VERIFIER_POLICY_VERSION.toUpperCase()}</span>
      </footer>
      <p className="disclaimer">
        Simulation-only research prototype. Configured spatial and battery models
        are synthetic engineering controls, not certified aircraft flight-control
        software.
      </p>
    </main>
  );
}
