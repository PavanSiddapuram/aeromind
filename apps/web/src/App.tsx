import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import {
  FLOOD_SCENARIO,
  type EnvironmentMutationEvent,
  type MissionEvent,
} from "@aeromind/shared";
import DroneSimulation from "./components/DroneSimulation";
import MissionCommandPanel, {
  type MissionPreset,
} from "./components/MissionCommandPanel";
import MissionHeader from "./components/MissionHeader";
import MissionIntelligenceSection from "./components/MissionIntelligenceSection";
import type { AeroMindScene, RouteVisualMode } from "./scene/AeroMindScene";
import {
  formatReplanOutcome,
  type HealthResponse,
  type MissionSnapshot,
} from "./types";

const MISSION_STORAGE_KEY = "aeromind.missionId";

function getOrCreateTabMissionId(): string {
  try {
    const existing = window.sessionStorage.getItem(MISSION_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{4,64}$/.test(existing)) {
      return existing;
    }
    const suffix =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    const generated = `mission-${suffix}`;
    window.sessionStorage.setItem(MISSION_STORAGE_KEY, generated);
    return generated;
  } catch {
    return "mission-demo-001";
  }
}

const MISSION_PRESETS: readonly MissionPreset[] = [
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
    label: "West Clinic Check",
    prompt:
      "Perform a direct inspection of the West Medical Clinic rooftop only and return home with maximum battery margin.",
  },
];

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    if (body.error?.message) {
      return `${body.error.code ?? "ERROR"}: ${body.error.message}`;
    }
  } catch {
    // ignore non-JSON body
  }
  return `HTTP ${response.status}`;
}

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [missionId] = useState<string>(() => getOrCreateTabMissionId());
  const [instruction, setInstruction] = useState<string>(
    MISSION_PRESETS[0]!.prompt,
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
      // Transient fetch errors recover via SSE or subsequent poll.
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    void fetchSnapshot(missionId);
  }, [fetchSnapshot, missionId, refreshHealth]);

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
          return merged.slice(-150);
        });
        void fetchSnapshot(missionId);
      } catch {
        // Ignore malformed SSE payload
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
        error instanceof Error
          ? error.message
          : "Execution authorization failed",
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
        "Plan a mission first so environment mutations bind to an active mission session.",
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
        error instanceof Error ? error.message : "Environment mutation failed",
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
      setActionError(error instanceof Error ? error.message : "Reset failed");
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
    : mission?.verification && !mission.verification.approved
      ? mission.verification.violations
      : (mission?.lastRejectedVerification?.violations ?? []);

  return (
    <div className="app-layout">
      <MissionHeader
        scenarioId={FLOOD_SCENARIO.id}
        scenarioName={FLOOD_SCENARIO.name}
        missionStatus={mission?.status ?? "idle"}
        verificationApproved={
          mission?.verification ? mission.verification.approved : null
        }
        environmentVersion={currentEnvVersion}
        health={health}
        healthError={healthError}
        sseConnected={sseConnected}
      />

      <main className="console-container">
        {health && !health.planner?.configured && (
          <div className="banner banner-warning" role="status">
            <AlertCircle size={17} aria-hidden="true" />
            <div>
              <strong>Server Gemini API key is not configured.</strong> Add{" "}
              <code>GEMINI_API_KEY</code> to <code>.env</code> and restart the
              backend to enable live mission planning. Without credentials,
              planning requests fail closed into <code>SAFE_HOLD</code>.
            </div>
          </div>
        )}

        {actionError && (
          <div className="banner banner-danger" role="alert">
            <AlertCircle size={17} aria-hidden="true" />
            <div className="banner-body">
              <span>{actionError}</span>
              <button
                type="button"
                className="btn-dismiss"
                onClick={() => setActionError(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Primary 2-Column Workspace: 3D Simulation + Fault Injection (Left) | Command & Gate (Right) */}
        <div className="workspace-grid">
          <div className="workspace-primary">
            <DroneSimulation
              missionStatus={mission?.status ?? "idle"}
              activeLeg={mission?.activeLeg ?? null}
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
              <div className="rejected-inspect-bar" role="status">
                <div className="rejected-inspect-copy">
                  <strong>
                    Prior route invalidated on ENV v
                    {mission.lastRejectedVerification.environmentVersion}
                  </strong>
                  <span>
                    Violations:{" "}
                    {mission.lastRejectedVerification.violations
                      .map((v) => v.code)
                      .join(", ")}{" "}
                    · Outcome:{" "}
                    {formatReplanOutcome(mission.lastReplanOutcome).label}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-outlined btn-sm"
                  onClick={() => setInspectRejectedOverlay((v) => !v)}
                >
                  {inspectRejectedOverlay
                    ? "Show Active Route"
                    : "Inspect Rejected Path"}
                </button>
              </div>
            )}

            {/* Dynamic Environment & Recovery Controls */}
            <section
              className="card fault-card"
              aria-labelledby="fault-controls-heading"
            >
              <div className="card-header">
                <div>
                  <div className="section-eyebrow">
                    Dynamic Environment Simulation · ENV v{currentEnvVersion}
                  </div>
                  <h2 id="fault-controls-heading" className="card-title">
                    Scenario Mutations & Recovery Triggers
                  </h2>
                </div>
              </div>
              <p className="card-description">
                Inject live spatial or battery changes before or during flight.
                Each mutation pauses active movement, revokes prior approvals,
                and attempts local A* recovery before escalating to bounded
                Gemini replanning.
              </p>

              <div className="fault-grid">
                <button
                  type="button"
                  className="fault-btn"
                  disabled={busyAction !== null || !mission}
                  onClick={() =>
                    void handleInjectEvent("crane", {
                      type: "obstacle.spawned",
                      obstacleId: "crane-01",
                    })
                  }
                >
                  <span className="fault-title">Spawn South Crane</span>
                  <span className="fault-sub">
                    Blocks south corridor · Tier 1 local A* reroute
                  </span>
                </button>

                <button
                  type="button"
                  className="fault-btn"
                  disabled={busyAction !== null || !mission}
                  onClick={() =>
                    void handleInjectEvent("debris", {
                      type: "obstacle.spawned",
                      obstacleId: "debris-north-01",
                    })
                  }
                >
                  <span className="fault-title">Block ROOF-03 Approach</span>
                  <span className="fault-sub">
                    Isolates East School · Tier 2 Gemini replan
                  </span>
                </button>

                <button
                  type="button"
                  className="fault-btn"
                  disabled={busyAction !== null || !mission}
                  onClick={() =>
                    void handleInjectEvent("battery-sag", {
                      type: "battery.changed",
                      batteryPercent: 52,
                      reason: "Simulated cell sag to 52%",
                    })
                  }
                >
                  <span className="fault-title">Battery Sag → 52%</span>
                  <span className="fault-sub">
                    Reduces reserve · Sheds lower-priority targets
                  </span>
                </button>

                <button
                  type="button"
                  className="fault-btn fault-btn-danger"
                  disabled={busyAction !== null || !mission}
                  onClick={() =>
                    void handleInjectEvent("battery-crit", {
                      type: "battery.changed",
                      batteryPercent: 22,
                      reason: "Critical reserve breach → 22%",
                    })
                  }
                >
                  <span className="fault-title">Critical Battery → 22%</span>
                  <span className="fault-sub">
                    Breaches landing reserve · Enters SAFE_HOLD
                  </span>
                </button>

                <button
                  type="button"
                  className="fault-btn"
                  disabled={busyAction !== null || !mission}
                  onClick={() =>
                    void handleInjectEvent("target-flare", {
                      type: "target.discovered",
                      targetId: "ROOF-05",
                    })
                  }
                >
                  <span className="fault-title">Discover Target ROOF-05</span>
                  <span className="fault-sub">
                    Urgent East Hub beacon · Re-evaluates priorities
                  </span>
                </button>
              </div>
            </section>
          </div>

          <aside className="workspace-secondary">
            <MissionCommandPanel
              missionStatus={mission?.status ?? "idle"}
              environmentVersion={currentEnvVersion}
              instruction={instruction}
              onInstructionChange={setInstruction}
              presets={MISSION_PRESETS}
              maxAltitudeMeters={maxAltitudeMeters}
              onMaxAltitudeChange={setMaxAltitudeMeters}
              minLandingReservePercent={minLandingReservePercent}
              onMinReserveChange={setMinLandingReservePercent}
              includeSceneStill={includeSceneStill}
              onIncludeSceneStillChange={setIncludeSceneStill}
              verification={mission?.verification ?? null}
              activeViolations={activeViolations}
              approval={mission?.approval ?? null}
              hasRoute={Boolean(mission?.route)}
              canExecute={canExecute}
              busyAction={busyAction}
              onPlanMission={() => void handlePlanMission()}
              onReverify={() => void handleReverify()}
              onExecute={() => void handleExecute()}
              onReset={() => void handleReset()}
            />
          </aside>
        </div>

        {/* Lower Section: Mission Intelligence & Live Event History */}
        <MissionIntelligenceSection
          plan={mission?.plan ?? null}
          plannerModel={mission?.plannerModel ?? null}
          plannerLatencyMs={mission?.plannerLatencyMs ?? null}
          route={mission?.route ?? null}
          targets={mission?.targets ?? FLOOD_SCENARIO.targets}
          lastReplanOutcome={mission?.lastReplanOutcome ?? "none"}
          repairAttemptsUsed={mission?.repairAttemptsUsed ?? 0}
          events={activeEvents}
        />

        <footer className="console-footer">
          <span>
            AeroMind Simulation & Validation Prototype — Gemini proposes
            symbolic plans; deterministic systems verify spatial and energy
            bounds.
          </span>
          <span>
            Synthetic simulation only. Not certified for physical aircraft
            control.
          </span>
        </footer>
      </main>
    </div>
  );
}
