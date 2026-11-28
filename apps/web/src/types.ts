import type {
  DroneState,
  MissionConstraints,
  MissionEvent,
  MissionPlan,
  MissionStatus,
  RescueTarget,
  ResolvedRoute,
  RouteApproval,
  ScenarioObstacle,
  Vector3,
  VerificationReport,
} from "@aeromind/shared";

export type HealthResponse = {
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

export type ReplanOutcome =
  | "none"
  | "unchanged_valid"
  | "local_astar"
  | "ai_replan"
  | "safe_hold";

export type ExecutionLeg = "outbound" | "return";

export type MissionSnapshot = {
  missionId: string;
  scenarioId: string;
  status: MissionStatus;
  activeLeg: ExecutionLeg | null;
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

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export type MissionStatusMeta = {
  label: string;
  tone: StatusTone;
  description: string;
};

export function getMissionStatusMeta(
  status: MissionStatus,
  verificationApproved?: boolean | null,
): MissionStatusMeta {
  switch (status) {
    case "idle":
      return {
        label: "Idle",
        tone: "neutral",
        description: "Awaiting mission instruction and verification.",
      };
    case "planning":
      return {
        label: "Proposed",
        tone: "info",
        description: "Requesting structured symbolic target plan from Gemini.",
      };
    case "resolving":
      return {
        label: "Routing",
        tone: "info",
        description: "Resolving collision-free 3D A* corridors and RTH path.",
      };
    case "verifying":
      return {
        label: "Verifying",
        tone: "warning",
        description: "Checking segment clearance, geofence, altitude, and reserve.",
      };
    case "repairing":
      return {
        label: "Repairing",
        tone: "warning",
        description: "Running local A* reroute or bounded mission replanning.",
      };
    case "ready":
      return {
        label: verificationApproved === false ? "Rejected" : "Approved",
        tone: verificationApproved === false ? "danger" : "success",
        description:
          "Passed configured simulation checks; version-bound approval active.",
      };
    case "executing":
      return {
        label: "Executing",
        tone: "info",
        description: "Simulating flight along the verified route polyline.",
      };
    case "paused":
      return {
        label: "Paused",
        tone: "warning",
        description: "Flight halted due to an environment mutation; re-verification required.",
      };
    case "completed":
      return {
        label: "Completed",
        tone: "success",
        description: "Scheduled targets inspected and drone returned to helipad.",
      };
    case "safe_hold":
      return {
        label: "SAFE_HOLD",
        tone: "danger",
        description:
          "Fail-closed hold: no feasible verified route available; movement locked.",
      };
    case "aborted":
      return {
        label: "Aborted",
        tone: "danger",
        description: "Mission objectives aborted under active constraints.",
      };
    case "failed":
      return {
        label: "Rejected",
        tone: "danger",
        description: "Proposal failed schema, allowlist, or deterministic verification.",
      };
  }
}

export function formatReplanOutcome(outcome: ReplanOutcome): {
  label: string;
  tone: StatusTone;
  detail: string;
} {
  switch (outcome) {
    case "local_astar":
      return {
        label: "Local A* Reroute",
        tone: "success",
        detail: "Recovered deterministically on the 3D graph (0 Gemini calls).",
      };
    case "ai_replan":
      return {
        label: "Gemini Mission Replan",
        tone: "info",
        detail: "Objectives revised by Gemini and re-verified deterministically.",
      };
    case "unchanged_valid":
      return {
        label: "Remaining Route Valid",
        tone: "success",
        detail: "Unflown trajectory passed re-verification on new environment.",
      };
    case "safe_hold":
      return {
        label: "SAFE_HOLD Fallback",
        tone: "danger",
        detail: "Recovery exhausted or infeasible; execution locked.",
      };
    case "none":
      return {
        label: "Initial Plan",
        tone: "neutral",
        detail: "Primary plan resolved without environment recovery.",
      };
  }
}

export function formatHeadingDegrees(headingRad: number): number {
  const deg = ((headingRad * 180) / Math.PI) % 360;
  return Math.round(deg < 0 ? deg + 360 : deg);
}
