import { useEffect, useState } from "react";
import {
  FLOOD_SCENARIO,
  VERIFIER_POLICY_VERSION,
  type MissionStatus,
  type RouteApproval,
  type RouteViolation,
  type VerificationReport,
} from "@aeromind/shared";
import { getMissionStatusMeta } from "../types";

export type MissionPreset = {
  readonly label: string;
  readonly prompt: string;
};

export type MissionCommandPanelProps = {
  missionStatus: MissionStatus;
  environmentVersion: number;
  instruction: string;
  onInstructionChange: (value: string) => void;
  presets: readonly MissionPreset[];
  maxAltitudeMeters: number;
  onMaxAltitudeChange: (value: number) => void;
  minLandingReservePercent: number;
  onMinReserveChange: (value: number) => void;
  includeSceneStill: boolean;
  onIncludeSceneStillChange: (value: boolean) => void;
  verification: VerificationReport | null;
  activeViolations: RouteViolation[];
  approval: RouteApproval | null;
  hasRoute: boolean;
  canExecute: boolean;
  busyAction: string | null;
  onPlanMission: () => void;
  onReverify: () => void;
  onExecute: () => void;
  onReset: () => void;
};

const LIFECYCLE_STAGES = [
  { key: "proposed", label: "Proposed" },
  { key: "routing", label: "Routing" },
  { key: "verifying", label: "Verifying" },
  { key: "gate", label: "Gate" },
  { key: "execution", label: "Execution" },
] as const;

function resolveActiveStageIndex(
  status: MissionStatus,
  approved: boolean | null,
): number {
  switch (status) {
    case "idle":
      return -1;
    case "planning":
      return 0;
    case "resolving":
    case "repairing":
      return 1;
    case "verifying":
      return 2;
    case "ready":
    case "failed":
    case "aborted":
    case "safe_hold":
      return approved !== null ? 3 : 2;
    case "executing":
    case "paused":
    case "completed":
      return 4;
  }
}

export default function MissionCommandPanel({
  missionStatus,
  environmentVersion,
  instruction,
  onInstructionChange,
  presets,
  maxAltitudeMeters,
  onMaxAltitudeChange,
  minLandingReservePercent,
  onMinReserveChange,
  includeSceneStill,
  onIncludeSceneStillChange,
  verification,
  activeViolations,
  approval,
  hasRoute,
  canExecute,
  busyAction,
  onPlanMission,
  onReverify,
  onExecute,
  onReset,
}: MissionCommandPanelProps) {
  const [confirmingExecute, setConfirmingExecute] = useState(false);

  // Automatically clear any open execution confirmation if approval, status, or version changes.
  useEffect(() => {
    setConfirmingExecute(false);
  }, [approval?.approvalId, environmentVersion, missionStatus, canExecute]);

  const approvedState = verification ? verification.approved : null;
  const statusMeta = getMissionStatusMeta(missionStatus, approvedState);
  const stageIdx = resolveActiveStageIndex(missionStatus, approvedState);

  const approvalStatusLabel = (() => {
    if (!approval) return "None issued";
    if (approval.revokedAt) return `Revoked (was v${approval.environmentVersion})`;
    if (approval.consumedAt)
      return `Consumed in flight (v${approval.environmentVersion})`;
    if (approval.environmentVersion !== environmentVersion) {
      return `Stale (v${approval.environmentVersion} ≠ v${environmentVersion})`;
    }
    return `Valid · ${approval.approvalId} (v${approval.environmentVersion})`;
  })();

  const isPlanningBusy = busyAction === "plan";
  const isVerifyBusy = busyAction === "verify";
  const isExecuteBusy = busyAction === "execute";

  return (
    <div className="side-stack">
      {/* Mission Command Card */}
      <section className="card" aria-labelledby="command-heading">
        <div className="card-header">
          <div>
            <div className="section-eyebrow">Mission Command</div>
            <h2 id="command-heading" className="card-title">
              Objective & Constraints
            </h2>
          </div>
          <span className={`badge badge-${statusMeta.tone}`}>
            <span className="badge-dot" aria-hidden="true" />
            {statusMeta.label}
          </span>
        </div>

        {/* Clear Lifecycle Pipeline */}
        <ol className="lifecycle-bar" aria-label="Mission validation stages">
          {LIFECYCLE_STAGES.map((stage, idx) => {
            const stateClass =
              stageIdx < 0
                ? "pending"
                : idx < stageIdx
                  ? "complete"
                  : idx === stageIdx
                    ? statusMeta.tone === "danger"
                      ? "error"
                      : statusMeta.tone === "warning"
                        ? "warning"
                        : "active"
                    : "pending";
            return (
              <li key={stage.key} className={`lifecycle-step ${stateClass}`}>
                <span className="step-indicator" aria-hidden="true" />
                <span className="step-label">{stage.label}</span>
              </li>
            );
          })}
        </ol>
        <p className="status-helper">{statusMeta.description}</p>

        {/* Presets */}
        <div className="preset-group" role="group" aria-label="Mission presets">
          {presets.map((preset) => {
            const selected = instruction.trim() === preset.prompt.trim();
            return (
              <button
                key={preset.label}
                type="button"
                className={`preset-chip ${selected ? "selected" : ""}`}
                onClick={() => onInstructionChange(preset.prompt)}
                disabled={busyAction !== null}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="field-block">
          <label className="field-label" htmlFor="mission-instruction">
            Natural-language mission instruction
          </label>
          <textarea
            id="mission-instruction"
            className="text-input textarea-input"
            rows={3}
            value={instruction}
            onChange={(e) => onInstructionChange(e.target.value)}
            placeholder="Describe rescue sector priorities and inspection goals…"
            disabled={busyAction !== null}
          />
        </div>

        <div className="field-grid-2">
          <div className="field-block">
            <label className="field-label" htmlFor="max-altitude">
              Max altitude (m)
            </label>
            <input
              id="max-altitude"
              type="number"
              min={15}
              max={80}
              step={1}
              className="text-input tabular"
              value={maxAltitudeMeters}
              onChange={(e) => onMaxAltitudeChange(Number(e.target.value) || 40)}
              disabled={busyAction !== null}
            />
          </div>

          <div className="field-block">
            <label className="field-label" htmlFor="min-reserve">
              Min landing reserve (%)
            </label>
            <input
              id="min-reserve"
              type="number"
              min={10}
              max={60}
              step={1}
              className="text-input tabular"
              value={minLandingReservePercent}
              onChange={(e) => onMinReserveChange(Number(e.target.value) || 20)}
              disabled={busyAction !== null}
            />
          </div>
        </div>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={includeSceneStill}
            onChange={(e) => onIncludeSceneStillChange(e.target.checked)}
            disabled={busyAction !== null}
          />
          <span>Include 3D viewport snapshot with Gemini request</span>
        </label>

        <div className="button-row-primary">
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={
              busyAction !== null ||
              instruction.trim().length < 3 ||
              missionStatus === "executing"
            }
            onClick={onPlanMission}
          >
            {isPlanningBusy ? "Planning & verifying…" : "Plan & Verify"}
          </button>
        </div>

        <div className="button-row-secondary">
          <button
            type="button"
            className="btn btn-outlined"
            disabled={
              busyAction !== null || !hasRoute || missionStatus === "executing"
            }
            onClick={onReverify}
          >
            {isVerifyBusy ? "Verifying…" : "Re-Verify"}
          </button>

          <button
            type="button"
            className="btn btn-outlined"
            disabled={busyAction !== null}
            onClick={onReset}
          >
            Reset Mission
          </button>
        </div>
      </section>

      {/* Independent Deterministic Verification & Execution Gate Card */}
      <section className="card" aria-labelledby="verifier-heading">
        <div className="card-header">
          <div>
            <div className="section-eyebrow">
              Deterministic Gate · Policy {VERIFIER_POLICY_VERSION}
            </div>
            <h2 id="verifier-heading" className="card-title">
              Verification & Execution
            </h2>
          </div>
          {verification ? (
            <span
              className={`badge ${
                verification.approved ? "badge-success" : "badge-danger"
              }`}
            >
              {verification.approved ? "Approved" : "Rejected"}
            </span>
          ) : (
            <span className="badge badge-neutral">Unverified</span>
          )}
        </div>

        {missionStatus === "safe_hold" && (
          <div className="callout callout-danger" role="alert">
            <strong>SAFE_HOLD Active — Execution Locked</strong>
            <p>
              No route satisfied spatial and battery reserve checks within the
              recovery budget. Adjust constraints, reset the scenario, or submit
              a revised mission.
            </p>
          </div>
        )}

        {verification ? (
          <div className="verification-body">
            <div className="metrics-grid">
              <div className="metric-box">
                <span className="metric-label">Outbound + Dwell</span>
                <strong className="metric-value tabular">
                  {verification.estimatedMissionEnergyPercent.toFixed(1)}%
                </strong>
              </div>

              <div className="metric-box">
                <span className="metric-label">Return-to-Home</span>
                <strong className="metric-value tabular">
                  {verification.estimatedReturnEnergyPercent.toFixed(1)}%
                </strong>
              </div>

              <div className="metric-box">
                <span className="metric-label">Projected Reserve</span>
                <strong
                  className={`metric-value tabular ${
                    verification.energy.feasible
                      ? "text-success"
                      : "text-danger"
                  }`}
                >
                  {verification.projectedLandingReservePercent.toFixed(1)}%{" "}
                  <span className="metric-sub">
                    (min {verification.energy.requiredReservePercent}%)
                  </span>
                </strong>
              </div>

              <div className="metric-box">
                <span className="metric-label">Available Battery</span>
                <strong className="metric-value tabular">
                  {verification.energy.availableBatteryPercent.toFixed(1)}%
                </strong>
              </div>
            </div>

            <div className="approval-record">
              <span className="metric-label">Approval status</span>
              <span
                className={`mono approval-value ${
                  canExecute ? "text-success" : ""
                }`}
              >
                {approvalStatusLabel}
              </span>
            </div>

            {activeViolations.length > 0 && (
              <div className="violations-box" role="region" aria-label="Verification violations">
                <div className="violations-heading">
                  Hard-constraint violations ({activeViolations.length})
                </div>
                <ul className="violations-ul">
                  {activeViolations.map((v, idx) => (
                    <li key={`${v.code}-${idx}`} className="violation-li">
                      <div className="violation-meta">
                        <code className="violation-code">{v.code}</code>
                        {v.leg && (
                          <span className="violation-leg">
                            {v.leg === "return" ? "RTH leg" : "Outbound leg"}
                          </span>
                        )}
                      </div>
                      <span>{v.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="empty-state">
            <p>
              Submit a mission plan to evaluate expanded obstacle envelopes,{" "}
              <code>NFZ-01</code> geofence clearance, altitude bounds, and
              return-to-home battery reserve.
            </p>
          </div>
        )}

        {/* Protected Execution Control (two-step confirmation prevents accidental token consumption) */}
        <div className="execution-gate-box">
          {!confirmingExecute ? (
            <button
              type="button"
              className="btn btn-success btn-block"
              disabled={busyAction !== null || !canExecute}
              onClick={() => setConfirmingExecute(true)}
            >
              {isExecuteBusy
                ? "Starting simulation…"
                : missionStatus === "executing"
                  ? "Simulation in progress…"
                  : canExecute
                    ? `Authorize & Execute (ENV v${environmentVersion})`
                    : "Authorize & Execute (Requires Valid Approval)"}
            </button>
          ) : (
            <div
              className="confirm-bar"
              role="group"
              aria-label="Confirm mission execution"
            >
              <span className="confirm-prompt">
                Consume approval <code>{approval?.approvalId}</code> and launch
                simulated flight?
              </span>
              <div className="confirm-actions">
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  disabled={busyAction !== null || !canExecute}
                  onClick={() => {
                    setConfirmingExecute(false);
                    onExecute();
                  }}
                >
                  Confirm & Launch
                </button>
                <button
                  type="button"
                  className="btn btn-outlined btn-sm"
                  onClick={() => setConfirmingExecute(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="footnote-copy">
          Synthetic energy coefficients:{" "}
          {FLOOD_SCENARIO.energyConfig.travelPercentPerMeter}%/m travel ·{" "}
          {FLOOD_SCENARIO.energyConfig.climbPercentPerMeter}%/m climb ·{" "}
          {(FLOOD_SCENARIO.energyConfig.windFactorPerMeterPerSecond * 100).toFixed(
            0,
          )}
          %/(m/s) wind · {FLOOD_SCENARIO.energyConfig.inspectionOperationPercent}
          %/target dwell.
        </p>
      </section>
    </div>
  );
}
