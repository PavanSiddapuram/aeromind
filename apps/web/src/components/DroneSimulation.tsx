import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import {
  FLOOD_SCENARIO,
  resolvePreviewWaypoints,
  type DroneState,
  type MissionStatus,
  type RescueTarget,
  type RouteViolation,
  type ScenarioObstacle,
  type Vector3,
} from "@aeromind/shared";
import { AeroMindScene, type RouteVisualMode } from "../scene/AeroMindScene";
import { formatHeadingDegrees, type ExecutionLeg } from "../types";

export type DroneSimulationProps = {
  missionStatus?: MissionStatus | undefined;
  activeLeg?: ExecutionLeg | null | undefined;
  environmentVersion?: number | undefined;
  drone?: DroneState | undefined;
  headingRad?: number | undefined;
  obstacles?: ScenarioObstacle[] | undefined;
  targets?: RescueTarget[] | undefined;
  waypoints?: Vector3[] | undefined;
  returnWaypoints?: Vector3[] | undefined;
  routeMode?: RouteVisualMode | undefined;
  violations?: RouteViolation[] | undefined;
  onSceneReady?: ((scene: AeroMindScene | null) => void) | undefined;
};

export default function DroneSimulation({
  missionStatus = "idle",
  activeLeg = null,
  environmentVersion = 1,
  drone = FLOOD_SCENARIO.initialDrone,
  headingRad = 0,
  obstacles = FLOOD_SCENARIO.obstacles,
  targets = FLOOD_SCENARIO.targets,
  waypoints,
  returnWaypoints,
  routeMode = "preview",
  violations = [],
  onSceneReady,
}: DroneSimulationProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<AeroMindScene | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scene: AeroMindScene | null = null;
    try {
      scene = new AeroMindScene(container, FLOOD_SCENARIO);
      sceneRef.current = scene;
      onSceneReady?.(scene);
      setSceneError(null);
    } catch (error) {
      setSceneError(
        error instanceof Error
          ? error.message
          : "WebGL scene could not be initialized",
      );
    }

    return () => {
      onSceneReady?.(null);
      sceneRef.current = null;
      scene?.dispose();
    };
  }, [onSceneReady]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setScenario(FLOOD_SCENARIO, targets, obstacles);
  }, [obstacles, targets]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const activeWaypoints = waypoints ?? resolvePreviewWaypoints(FLOOD_SCENARIO);
    scene.setRoute(activeWaypoints, routeMode, returnWaypoints);
    scene.setViolations(violations, activeWaypoints, returnWaypoints);
  }, [waypoints, returnWaypoints, routeMode, violations]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setDronePose(
      drone.position,
      headingRad,
      missionStatus === "executing",
    );
  }, [drone.position, headingRad, missionStatus]);

  const headingDeg = formatHeadingDegrees(headingRad);
  const dynamicObstacleCount = obstacles.filter(
    (o) => o.kind === "dynamic_hazard",
  ).length;

  return (
    <section
      className="card viewport-card"
      aria-label="3D mission simulation viewport"
    >
      <div className="viewport-toolbar">
        <div className="viewport-title-group">
          <h2 className="card-title">{FLOOD_SCENARIO.name}</h2>
          <span className="viewport-meta">
            World frame: X East · Y Altitude · Z North (metres) · Envelope{" "}
            {(
              drone.radiusMeters + FLOOD_SCENARIO.safetyClearanceMeters
            ).toFixed(1)}{" "}
            m
          </span>
        </div>

        <div className="viewport-actions">
          {activeLeg && (
            <span className="badge badge-neutral">
              Leg: {activeLeg === "return" ? "Return-to-Home" : "Outbound"}
            </span>
          )}
          <span className="viewport-hint">Drag to orbit · Scroll to zoom</span>
          <button
            type="button"
            className="btn btn-tonal btn-sm"
            onClick={() => sceneRef.current?.resetCameraView()}
            aria-label="Reset 3D camera view"
          >
            <RotateCcw size={13} aria-hidden="true" />
            Reset view
          </button>
        </div>
      </div>

      <div className="simulation-frame">
        <div className="scene-canvas" ref={containerRef}>
          {sceneError && (
            <div className="scene-fallback" role="alert">
              <AlertTriangle size={22} aria-hidden="true" />
              <strong>3D visualization unavailable</strong>
              <span>{sceneError}</span>
              <span>
                Enable WebGL or open the console in a hardware-accelerated
                browser.
              </span>
            </div>
          )}
        </div>

        {/* Restrained, solid-surface telemetry strip inside the dark 3D viewport */}
        <div className="viewport-hud" aria-live="polite">
          <div className="hud-group">
            <span className="hud-item">
              <span className="hud-label">Drone</span>
              <strong className="mono">{drone.id}</strong>
            </span>
            <span className="hud-sep" aria-hidden="true" />
            <span className="hud-item">
              <span className="hud-label">Pos</span>
              <strong className="mono tabular">
                ({drone.position.x.toFixed(1)}, {drone.position.y.toFixed(1)},{" "}
                {drone.position.z.toFixed(1)})
              </strong>
            </span>
            <span className="hud-sep" aria-hidden="true" />
            <span className="hud-item">
              <span className="hud-label">Hdg</span>
              <strong className="mono tabular">{headingDeg}°</strong>
            </span>
          </div>

          <div className="hud-group">
            <span className="hud-item">
              <span className="hud-label">Alt</span>
              <strong className="mono tabular">
                {drone.position.y.toFixed(1)} m
              </strong>
            </span>
            <span className="hud-sep" aria-hidden="true" />
            <span className="hud-item">
              <span className="hud-label">Battery</span>
              <strong className="mono tabular">
                {drone.batteryPercent.toFixed(1)}%
              </strong>
            </span>
            <span className="hud-sep" aria-hidden="true" />
            <span className="hud-item">
              <span className="hud-label">Env</span>
              <strong className="mono tabular">v{environmentVersion}</strong>
            </span>
            {dynamicObstacleCount > 0 && (
              <>
                <span className="hud-sep" aria-hidden="true" />
                <span className="hud-item hud-warn">
                  +{dynamicObstacleCount} Hazard
                  {dynamicObstacleCount > 1 ? "s" : ""}
                </span>
              </>
            )}
            {violations.length > 0 && (
              <>
                <span className="hud-sep" aria-hidden="true" />
                <span className="hud-item hud-danger">
                  {violations.length} Violation
                  {violations.length > 1 ? "s" : ""}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Clear 3D Visual Legend */}
      <div className="viewport-legend" aria-label="3D visualization legend">
        <span className="legend-item">
          <i className="legend-swatch swatch-approved" aria-hidden="true" />
          Approved outbound
        </span>
        <span className="legend-item">
          <i className="legend-swatch swatch-rth" aria-hidden="true" />
          Return-to-home (RTH)
        </span>
        <span className="legend-item">
          <i className="legend-swatch swatch-rejected" aria-hidden="true" />
          Rejected / violation
        </span>
        <span className="legend-item">
          <i className="legend-dot dot-pending" aria-hidden="true" />
          Pending target
        </span>
        <span className="legend-item">
          <i className="legend-dot dot-visited" aria-hidden="true" />
          Visited target
        </span>
        <span className="legend-item">
          <i className="legend-box box-nfz" aria-hidden="true" />
          No-fly zone ({FLOOD_SCENARIO.noFlyZones[0]?.id ?? "NFZ-01"})
        </span>
        <span className="legend-item">
          <i className="legend-box box-hazard" aria-hidden="true" />
          Dynamic obstacle
        </span>
      </div>
    </section>
  );
}
