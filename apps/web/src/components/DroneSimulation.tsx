import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Compass, RadioTower } from "lucide-react";
import { AeroMindScene } from "../scene/AeroMindScene";

export default function DroneSimulation() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scene: AeroMindScene | null = null;
    try {
      scene = new AeroMindScene(container);
      setSceneError(null);
    } catch (error) {
      setSceneError(
        error instanceof Error
          ? error.message
          : "WebGL scene could not be initialized",
      );
    }

    return () => {
      scene?.dispose();
    };
  }, []);

  return (
    <section className="simulation-section">
      <div className="section-heading">
        <div>
          <div className="panel-kicker">LIVE ENVIRONMENT / SIMULATION PREVIEW</div>
          <h2>Urban flood zone</h2>
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
          <span className="live-indicator"><i /> SIMULATION</span>
          <span>SCENARIO / FLOOD-BLOCK-01</span>
        </div>

        <div className="scene-overlay scene-overlay-bottom">
          <span><RadioTower size={13} /> DRONE / AM-01</span>
          <span><Camera size={13} /> DRONE / ROTOR PREVIEW</span>
          <span>ALT 17 M · BAT 86%</span>
        </div>
      </div>
      <p className="scene-caption">
        Procedural scene preview. The displayed route and telemetry are illustrative;
        mission planning, route verification and live drone control are not connected yet.
      </p>
    </section>
  );
}
