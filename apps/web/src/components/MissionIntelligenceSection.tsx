import { useMemo, useState } from "react";
import {
  FLOOD_SCENARIO,
  type MissionEvent,
  type MissionPlan,
  type RescueTarget,
  type ResolvedRoute,
} from "@aeromind/shared";
import {
  formatReplanOutcome,
  type ReplanOutcome,
  type StatusTone,
} from "../types";

export type MissionIntelligenceSectionProps = {
  plan: MissionPlan | null;
  plannerModel: string | null;
  plannerLatencyMs: number | null;
  route: ResolvedRoute | null;
  targets: RescueTarget[];
  lastReplanOutcome: ReplanOutcome;
  repairAttemptsUsed: number;
  events: MissionEvent[];
};

type EventFilter = "all" | "verification" | "recovery" | "execution";

function classifyEvent(type: MissionEvent["type"]): {
  category: EventFilter;
  tone: StatusTone;
  title: string;
} {
  switch (type) {
    case "mission.received":
      return { category: "all", tone: "neutral", title: "Mission Received" };
    case "planning.started":
      return { category: "all", tone: "info", title: "Gemini Planning Started" };
    case "plan.generated":
      return { category: "all", tone: "info", title: "Gemini Proposal Validated" };
    case "route.resolved":
      return { category: "recovery", tone: "info", title: "3D A* Route Resolved" };
    case "verification.started":
      return {
        category: "verification",
        tone: "neutral",
        title: "Deterministic Check Started",
      };
    case "verification.passed":
      return {
        category: "verification",
        tone: "success",
        title: "Verification Passed & Approved",
      };
    case "verification.rejected":
      return {
        category: "verification",
        tone: "danger",
        title: "Verification Rejected",
      };
    case "environment.changed":
      return {
        category: "recovery",
        tone: "warning",
        title: "Environment Mutated (Approvals Revoked)",
      };
    case "replanning.started":
      return {
        category: "recovery",
        tone: "warning",
        title: "Dynamic Recovery Triggered",
      };
    case "execution.authorized":
      return {
        category: "execution",
        tone: "success",
        title: "Execution Authorized",
      };
    case "simulation.started":
      return {
        category: "execution",
        tone: "info",
        title: "Flight Simulation Started",
      };
    case "simulation.paused":
      return {
        category: "execution",
        tone: "warning",
        title: "Flight Simulation Paused",
      };
    case "simulation.completed":
      return {
        category: "execution",
        tone: "success",
        title: "Mission & Return-to-Home Completed",
      };
    case "mission.safe_hold":
      return {
        category: "verification",
        tone: "danger",
        title: "Entered Fail-Closed SAFE_HOLD",
      };
    case "mission.failed":
      return {
        category: "verification",
        tone: "danger",
        title: "Proposal Rejected (Fail-Closed)",
      };
  }
}

function summarizeEventPayload(event: MissionEvent): {
  summary: string;
  recoveryBadge?: { label: string; tone: StatusTone } | undefined;
} {
  const p = (event.payload ?? {}) as Record<string, unknown>;

  if (event.type === "replanning.started") {
    if (p.mode === "local_astar") {
      const remaining = Array.isArray(p.remainingTargets)
        ? p.remainingTargets.join(", ") || "RTH only"
        : "";
      return {
        summary: `Attempting Tier 1 deterministic A* reroute (${remaining}).`,
        recoveryBadge: { label: "Tier 1 · Local A*", tone: "success" },
      };
    }
    return {
      summary: `Escalating to Tier 2 Gemini mission replanning (attempt ${String(p.repairAttempt ?? 1)}/${String(p.maxRepairAttempts ?? 2)}).`,
      recoveryBadge: { label: "Tier 2 · Gemini Replan", tone: "info" },
    };
  }

  if (event.type === "route.resolved") {
    const mode = p.mode === "local_astar" ? "Local A*" : "Planned A*";
    return {
      summary: `${mode}: ${String(p.distanceMeters ?? 0)} m outbound + ${String(p.returnDistanceMeters ?? 0)} m RTH.`,
      recoveryBadge:
        p.mode === "local_astar"
          ? { label: "Local A*", tone: "success" }
          : undefined,
    };
  }

  if (event.type === "verification.passed") {
    const reserve =
      p.projectedLandingReservePercent !== undefined
        ? ` · Reserve ${String(p.projectedLandingReservePercent)}%`
        : "";
    return {
      summary: `Issued approval ${String(p.approvalId ?? "")}${reserve}.`,
    };
  }

  if (event.type === "verification.rejected") {
    const violations = Array.isArray(p.violations)
      ? (p.violations as { code?: string; message?: string }[])
          .map((v) => v.code ?? "VIOLATION")
          .join(", ")
      : "Constraint check failed";
    return { summary: `Violations: ${violations}` };
  }

  if (event.type === "plan.generated") {
    const targets = Array.isArray(p.targetOrder)
      ? p.targetOrder.join(" → ") || "None"
      : "";
    return {
      summary: `Status "${String(p.missionStatus ?? "")}" · Targets: ${targets} (${String(p.latencyMs ?? 0)} ms).`,
    };
  }

  if (event.type === "environment.changed") {
    const mutation = (p.mutation ?? {}) as Record<string, unknown>;
    return {
      summary: `Mutation ${String(mutation.type ?? "")} applied · Revoked ${String(p.revokedApprovals ?? 0)} active approval(s) · Battery ${Number(p.batteryPercent ?? 0).toFixed(1)}%.`,
    };
  }

  if (event.type === "mission.safe_hold") {
    return { summary: String(p.reason ?? "Safe hold engaged.") };
  }

  if (event.type === "simulation.completed") {
    const visited = Array.isArray(p.visitedTargets)
      ? p.visitedTargets.join(", ") || "None"
      : "";
    return {
      summary: `Landed at helipad with ${String(p.finalBatteryPercent ?? "")}% battery · Visited: ${visited}.`,
    };
  }

  return { summary: JSON.stringify(p) };
}

export default function MissionIntelligenceSection({
  plan,
  plannerModel,
  plannerLatencyMs,
  route,
  targets,
  lastReplanOutcome,
  repairAttemptsUsed,
  events,
}: MissionIntelligenceSectionProps) {
  const [filter, setFilter] = useState<EventFilter>("all");
  const replanMeta = formatReplanOutcome(lastReplanOutcome);

  const filteredEvents = useMemo(() => {
    const reversed = [...events].reverse();
    if (filter === "all") return reversed;
    return reversed.filter((evt) => classifyEvent(evt.type).category === filter);
  }, [events, filter]);

  const activeTargets = targets.length > 0 ? targets : FLOOD_SCENARIO.targets;

  return (
    <section
      className="intel-grid"
      aria-label="Mission intelligence and event history"
    >
      {/* Left: Gemini Proposal, Resolved Graph Sequence & Target Status */}
      <article className="card" aria-labelledby="intel-heading">
        <div className="card-header">
          <div>
            <div className="section-eyebrow">Probabilistic Proposal & Graph</div>
            <h2 id="intel-heading" className="card-title">
              Mission Intelligence
            </h2>
          </div>
          <span className={`badge badge-${replanMeta.tone}`} title={replanMeta.detail}>
            {replanMeta.label}
            {repairAttemptsUsed > 0 ? ` (${repairAttemptsUsed}/2)` : ""}
          </span>
        </div>

        {plan ? (
          <div className="intel-content">
            <div className="decision-summary-box">
              <div className="decision-meta-row">
                <span className="decision-heading">Gemini Decision Summary</span>
                <div className="inline-pills">
                  {plannerModel && (
                    <span className="meta-tag mono">{plannerModel}</span>
                  )}
                  {plannerLatencyMs !== null && (
                    <span className="meta-tag tabular">{plannerLatencyMs} ms</span>
                  )}
                  <span className="meta-tag">{plan.searchPattern}</span>
                  <span className="meta-tag">Status: {plan.missionStatus}</span>
                </div>
              </div>
              <p className="decision-text">{plan.decisionSummary}</p>
            </div>

            <div className="sequence-columns">
              <div className="sequence-block">
                <span className="field-label">Selected target order</span>
                {plan.targetOrder.length > 0 ? (
                  <div className="token-list">
                    {plan.targetOrder.map((id, i) => (
                      <span key={id} className="token-chip token-primary mono">
                        {i + 1}. {id}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="muted-inline">
                    None (Return-to-Home / Aborted)
                  </span>
                )}
              </div>

              <div className="sequence-block">
                <span className="field-label">Abandoned objectives</span>
                {plan.abortedObjectives.length > 0 ? (
                  <div className="token-list">
                    {plan.abortedObjectives.map((id) => (
                      <span key={id} className="token-chip token-muted mono">
                        {id}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="muted-inline">None</span>
                )}
              </div>
            </div>

            {route && (
              <div className="route-nodes-box">
                <div className="route-nodes-header">
                  <span className="field-label">Resolved 3D A* node sequence</span>
                  <span className="tabular muted-inline">
                    {route.distanceMeters.toFixed(0)} m outbound ·{" "}
                    {route.returnDistanceMeters.toFixed(0)} m RTH
                  </span>
                </div>
                <div className="node-chain mono">
                  {route.waypoints.length > 1 && (
                    <div>
                      <span className="leg-tag">Outbound:</span>{" "}
                      {route.nodeIds.join(" → ")}
                    </div>
                  )}
                  <div>
                    <span className="leg-tag">RTH:</span>{" "}
                    {route.returnNodeIds.join(" → ")}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="empty-state">
            <p>
              No mission proposal generated yet. Gemini receives natural-language
              intent, scalar mission telemetry, and discrete target/node
              catalogues, and never authors XYZ coordinates.
            </p>
          </div>
        )}

        {/* Rescue Target Status Table */}
        <div className="targets-section">
          <div className="field-label">Rescue target catalogue & status</div>
          <div className="targets-table" role="table" aria-label="Rescue targets">
            {activeTargets.map((target) => {
              const statusTone: StatusTone =
                target.status === "visited"
                  ? "success"
                  : target.status === "abandoned"
                    ? "neutral"
                    : "warning";
              return (
                <div key={target.id} className="target-row-item" role="row">
                  <div className="target-main" role="cell">
                    <span className="mono target-id">{target.id}</span>
                    <span className="target-name">{target.label}</span>
                  </div>
                  <div className="target-meta" role="cell">
                    <span className="meta-tag">
                      {target.sector} · P{target.priority}
                    </span>
                    <span className={`badge badge-${statusTone}`}>
                      {target.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </article>

      {/* Right: Live Monotonic SSE Event Timeline */}
      <article className="card" aria-labelledby="timeline-heading">
        <div className="card-header">
          <div>
            <div className="section-eyebrow">Authoritative Audit Log</div>
            <h2 id="timeline-heading" className="card-title">
              Live Mission Event History
            </h2>
          </div>
          <span className="badge badge-neutral tabular">
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
        </div>

        <div
          className="filter-tabs"
          role="tablist"
          aria-label="Filter mission events"
        >
          {(
            [
              ["all", "All"],
              ["verification", "Verification"],
              ["recovery", "Recovery"],
              ["execution", "Execution"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={`filter-tab ${filter === key ? "active" : ""}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {filteredEvents.length > 0 ? (
          <ol className="event-timeline">
            {filteredEvents.map((evt) => {
              const meta = classifyEvent(evt.type);
              const formatted = summarizeEventPayload(evt);
              return (
                <li key={evt.eventId} className="event-row">
                  <span
                    className={`event-dot dot-${meta.tone}`}
                    aria-hidden="true"
                  />
                  <div className="event-body">
                    <div className="event-header-line">
                      <span className="event-seq mono tabular">
                        #{evt.sequence}
                      </span>
                      <strong className="event-title">{meta.title}</strong>
                      <code className="event-code">{evt.type}</code>
                      {formatted.recoveryBadge && (
                        <span
                          className={`badge badge-${formatted.recoveryBadge.tone}`}
                        >
                          {formatted.recoveryBadge.label}
                        </span>
                      )}
                      <span className="event-env mono tabular">
                        ENV v{evt.environmentVersion}
                      </span>
                      <time className="event-time tabular">
                        {new Date(evt.occurredAt).toLocaleTimeString()}
                      </time>
                    </div>
                    <p className="event-summary">{formatted.summary}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="empty-state">
            <p>
              {events.length === 0
                ? "Monotonic server events stream here in real time once a mission starts."
                : "No events match the selected filter."}
            </p>
          </div>
        )}
      </article>
    </section>
  );
}
