/** Shared domain contracts. Keep this package provider- and UI-agnostic. */

export type Vector3 = { x: number; y: number; z: number };
export type AABB = { min: Vector3; max: Vector3 };

export type MissionStatus =
  | "idle" | "planning" | "resolving" | "verifying" | "repairing"
  | "ready" | "executing" | "paused" | "completed"
  | "safe_hold" | "aborted" | "failed";

export type TargetStatus = "pending" | "visited" | "abandoned";

export type RescueTarget = {
  id: string;
  position: Vector3;
  priority: number;
  status: TargetStatus;
};

export type DroneState = {
  position: Vector3;
  batteryPercent: number;
  altitudeMeters: number;
  speedMetersPerSecond: number;
  radiusMeters: number;
};

export type MissionConstraints = {
  maxAltitudeMeters: number;
  minLandingReservePercent: number;
};

export type MissionEventType =
  | "mission.received" | "planning.started" | "plan.generated"
  | "route.resolved" | "verification.started" | "verification.rejected"
  | "verification.passed" | "replanning.started"
  | "execution.authorized" | "simulation.started"
  | "simulation.paused" | "simulation.completed"
  | "mission.safe_hold" | "mission.failed";

export type MissionEvent<TPayload = unknown> = {
  eventId: string;
  missionId: string;
  sequence: number;
  occurredAt: string;
  type: MissionEventType;
  environmentVersion: number;
  payload: TPayload;
};
