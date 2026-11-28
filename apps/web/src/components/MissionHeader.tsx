import type { MissionStatus } from "@aeromind/shared";
import {
  getMissionStatusMeta,
  type HealthResponse,
} from "../types";

export type MissionHeaderProps = {
  scenarioId: string;
  scenarioName: string;
  missionStatus: MissionStatus;
  verificationApproved: boolean | null;
  environmentVersion: number;
  health: HealthResponse | null;
  healthError: string | null;
  sseConnected: boolean;
};

export default function MissionHeader({
  scenarioId,
  scenarioName,
  missionStatus,
  verificationApproved,
  environmentVersion,
  health,
  healthError,
  sseConnected,
}: MissionHeaderProps) {
  const statusMeta = getMissionStatusMeta(missionStatus, verificationApproved);

  const apiConnected = health !== null && !healthError;
  const geminiConfigured = Boolean(health?.planner?.configured);
  const geminiModel = health?.planner?.model ?? "unconfigured";

  return (
    <header className="mission-header" role="banner">
      <div className="header-inner">
        <div className="brand-group">
          <a className="brand-link" href="/" aria-label="AeroMind Mission Console">
            <span className="brand-monogram" aria-hidden="true">
              AM
            </span>
            <div className="brand-titles">
              <span className="brand-name">AeroMind</span>
              <span className="brand-subtitle">
                Autonomous Mission Validation Console
              </span>
            </div>
          </a>

          <div className="header-divider" aria-hidden="true" />

          <div className="scenario-context" aria-label="Active scenario">
            <span className="context-label">Scenario</span>
            <span className="context-value" title={scenarioName}>
              {scenarioId}
            </span>
          </div>
        </div>

        <div className="header-telemetry" aria-label="System and mission status">
          <div className="header-metric">
            <span className="context-label">Mission</span>
            <span className={`badge badge-${statusMeta.tone}`}>
              <span className="badge-dot" aria-hidden="true" />
              {statusMeta.label}
            </span>
          </div>

          <div className="header-metric">
            <span className="context-label">Env Version</span>
            <span className="badge badge-neutral mono">v{environmentVersion}</span>
          </div>

          <div className="header-metric">
            <span className="context-label">API</span>
            <span
              className={`badge ${
                apiConnected
                  ? "badge-success"
                  : healthError
                    ? "badge-danger"
                    : "badge-neutral"
              }`}
              title={
                apiConnected
                  ? `${health.service} (${health.environment})`
                  : (healthError ?? "Connecting to backend")
              }
            >
              <span className="badge-dot" aria-hidden="true" />
              {apiConnected ? "Connected" : healthError ? "Offline" : "Checking"}
            </span>
          </div>

          <div className="header-metric">
            <span className="context-label">Gemini</span>
            <span
              className={`badge ${geminiConfigured ? "badge-info" : "badge-warning"}`}
              title={
                geminiConfigured
                  ? `Server-side model: ${geminiModel}`
                  : "GEMINI_API_KEY not configured on server"
              }
            >
              <span className="badge-dot" aria-hidden="true" />
              {geminiConfigured ? `Ready (${geminiModel})` : "Key Missing"}
            </span>
          </div>

          <div className="header-metric">
            <span className="context-label">Event Stream</span>
            <span
              className={`badge ${sseConnected ? "badge-success" : "badge-neutral"}`}
            >
              <span className="badge-dot" aria-hidden="true" />
              {sseConnected ? "SSE Live" : "SSE Sync"}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
