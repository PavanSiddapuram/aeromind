import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Compass, RadioTower, ShieldAlert } from "lucide-react";
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

export type DroneSimulationProps = {
  missionStatus?: MissionStatus | undefined;
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
  environmentVersion = 1,
  drone = FLOOD_SCENARIO.initialDrone,
  headingRad,
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
    scene.setViolations(violations, activeWaypoints);
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

  return (
    <section className="simulation-section">
      <div className="section-heading">
        <div>
          <div className="panel-kicker">LIVE ENVIRONMENT / CANONICAL SCENARIO</div>
          <h2>{FLOOD_SCENARIO.name}</h2>
        </div>
        <div className="scene-controls-hint">
          <Compass size={14} /> Drag to orbit · Scroll to zoom
        </div>
      </div>

      <div className="simulation-frame">
        <div className="scene-canvas" ref={containerRef}>
          {sceneError && (
            <div className="scene-fallback">
              <AlertTriangle size={22} />
              <strong>3D renderer unavailable</strong>
              <span>{sceneError}</span>
              <span>Enable WebGL or use a browser with hardware acceleration.</span>
            </div>
          )}
        </div>

        <div className="scene-overlay scene-overlay-top">
          <span className="live-indicator">
            <i /> STATUS / {missionStatus.toUpperCase()}
          </span>
          <span>
            SCENARIO / {FLOOD_SCENARIO.id.toUpperCase()} · ENV v{environmentVersion}
          </span>
        </div>

        <div className="scene-overlay scene-overlay-bottom">
          <span>
            <RadioTower size={13} /> DRONE / {drone.id} (R={drone.radiusMeters}m + {FLOOD_SCENARIO.safetyClearanceMeters}m CLEARANCE)
          </span>
          <span>
            <Camera size={13} /> POS ({drone.position.x.toFixed(0)}, {drone.position.y.toFixed(1)}, {drone.position.z.toFixed(0)})
          </span>
          <span>
            ALT {drone.position.y.toFixed(1)} M · BAT {drone.batteryPercent.toFixed(1)}%
          </span>
          {violations.length > 0 && (
            <span className="overlay-alert">
              <ShieldAlert size={13} /> {violations.length} VIOLATION{violations.length === 1 ? "" : "S"}
            </span>
          )}
        </div>
      </div>
      <p className="scene-caption">
        Rendered and verified from the same world-space scenario contract (metres, Y=altitude).
        Red volume marks restricted airspace ({FLOOD_SCENARIO.noFlyZones[0]?.id ?? "NFZ-01"}).
      </p>
    </section>
  );
}
