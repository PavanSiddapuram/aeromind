/** Shared domain contracts. Keep this package provider- and UI-agnostic. */

export type Vector3 = { x: number; y: number; z: number };
export type AABB = { min: Vector3; max: Vector3 };

export type MissionStatus =
  | "idle"
  | "planning"
  | "resolving"
  | "verifying"
  | "repairing"
  | "ready"
  | "executing"
  | "paused"
  | "completed"
  | "safe_hold"
  | "aborted"
  | "failed";

export type TargetStatus = "pending" | "visited" | "abandoned";
export type TargetSector = "west" | "central" | "east" | "south";

export type RescueTarget = {
  id: string;
  label: string;
  position: Vector3;
  rooftopElevationMeters: number;
  buildingId: string;
  nodeId: string;
  sector: TargetSector;
  priority: number;
  status: TargetStatus;
};

export type DroneState = {
  id: string;
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

export type SearchPattern =
  | "perimeter_scan"
  | "grid_scan"
  | "direct_inspection";

export type MissionPlan = {
  missionStatus: "planned" | "partial" | "aborted";
  targetOrder: string[];
  searchPattern: SearchPattern;
  preferredNodeSequence: string[];
  abortedObjectives: string[];
  decisionSummary: string;
};

export type ViolationCode =
  | "OBSTACLE_COLLISION"
  | "NO_FLY_ZONE"
  | "ALTITUDE_LIMIT"
  | "ENERGY_INFEASIBLE"
  | "INVALID_WAYPOINT";

export type RouteViolation = {
  code: ViolationCode;
  message: string;
  leg?: "outbound" | "return" | undefined;
  segmentIndex?: number | undefined;
  point?: Vector3 | undefined;
  entityId?: string | undefined;
};

export type EnergyConfig = {
  /** Battery percentage points per 3D metre of travel. */
  travelPercentPerMeter: number;
  /** Additional battery percentage points per positive metre of climb. */
  climbPercentPerMeter: number;
  /** Fractional travel surcharge per m/s of ambient wind. */
  windFactorPerMeterPerSecond: number;
  /** Fixed battery percentage points per target inspection. */
  inspectionOperationPercent: number;
};

export type EnergyBreakdown = {
  missionTravelPercent: number;
  missionClimbPercent: number;
  missionWindPercent: number;
  missionOperationPercent: number;
  estimatedMissionEnergyPercent: number;
  estimatedReturnEnergyPercent: number;
  requiredReservePercent: number;
  availableBatteryPercent: number;
  projectedLandingReservePercent: number;
  feasible: boolean;
};

export type VerificationReport = {
  routeId: string;
  environmentVersion: number;
  policyVersion: string;
  approved: boolean;
  violations: RouteViolation[];
  estimatedMissionEnergyPercent: number;
  estimatedReturnEnergyPercent: number;
  projectedLandingReservePercent: number;
  energy: EnergyBreakdown;
  verifiedAt: string;
};

export type ResolvedRoute = {
  routeId: string;
  nodeIds: string[];
  waypoints: Vector3[];
  returnNodeIds: string[];
  returnWaypoints: Vector3[];
  targetIds: string[];
  distanceMeters: number;
  returnDistanceMeters: number;
  environmentVersion: number;
};

export type RouteApproval = {
  approvalId: string;
  missionId: string;
  routeId: string;
  environmentVersion: number;
  policyVersion: string;
  approvedAt: string;
  revokedAt?: string | undefined;
  consumedAt?: string | undefined;
  expiresAt?: string | undefined;
};

export type ObstacleKind = "building" | "dynamic_hazard";

export type ScenarioObstacle = {
  id: string;
  label: string;
  kind: ObstacleKind;
  bounds: AABB;
  colorHex: number;
};

export type NoFlyZone = {
  id: string;
  label: string;
  bounds: AABB;
};

export type NavigationNode = {
  id: string;
  label: string;
  position: Vector3;
  kind: "base" | "corridor" | "target_approach";
};

export type NavigationEdge = {
  from: string;
  to: string;
  bidirectional?: boolean | undefined;
  riskCost?: number | undefined;
};

export type EnvironmentMutationEvent =
  | {
      type: "obstacle.spawned";
      obstacleId: string;
      obstacle?: ScenarioObstacle | undefined;
    }
  | {
      type: "battery.changed";
      batteryPercent: number;
      reason?: string | undefined;
    }
  | {
      type: "target.discovered";
      targetId: string;
      target?: RescueTarget | undefined;
    }
  | {
      type: "wind.changed";
      windMetersPerSecond: number;
    };

export type MissionEventType =
  | "mission.received"
  | "planning.started"
  | "plan.generated"
  | "route.resolved"
  | "verification.started"
  | "verification.rejected"
  | "verification.passed"
  | "environment.changed"
  | "replanning.started"
  | "execution.authorized"
  | "simulation.started"
  | "simulation.paused"
  | "simulation.completed"
  | "mission.safe_hold"
  | "mission.failed";

export type MissionEvent<TPayload = unknown> = {
  eventId: string;
  missionId: string;
  sequence: number;
  occurredAt: string;
  type: MissionEventType;
  environmentVersion: number;
  payload: TPayload;
};

export * from "./math/index.js";
export * from "./geometry/index.js";
export * from "./scenario/index.js";
export * from "./navigation/index.js";
export * from "./energy/index.js";
export * from "./verification/index.js";
