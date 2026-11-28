import {
  distance,
  equals,
  type DroneState,
  type MissionPlan,
  type RescueTarget,
  type ResolvedRoute,
  type ScenarioDefinition,
  type Vector3,
} from "@aeromind/shared";

export type ExecutionLeg = "outbound" | "return";

export type FlightProgressState = {
  leg: ExecutionLeg;
  segmentIndex: number;
  segmentOffsetMeters: number;
  headingRad: number;
};

export type RemainingMissionRoute = {
  leg: ExecutionLeg;
  outboundWaypoints: Vector3[];
  returnWaypoints: Vector3[];
  combinedTrajectory: Vector3[];
  remainingTargetIds: string[];
  inspectedTargetCount: number;
  outboundDistanceMeters: number;
  returnDistanceMeters: number;
};

export function dedupeConsecutiveWaypoints(
  points: readonly Vector3[],
  tolerance = 1e-4,
): Vector3[] {
  const result: Vector3[] = [];
  for (const point of points) {
    const prev = result[result.length - 1];
    if (!prev || !equals(prev, point, tolerance)) {
      result.push({ ...point });
    }
  }
  return result;
}

export function computePolylineDistance(points: readonly Vector3[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a && b) {
      total += distance(a, b);
    }
  }
  return total;
}

/**
 * Derives an exact, stage-aware representation of the unflown mission and return-to-home
 * trajectory from authoritative server state:
 *
 * - Case A (READY before execution, `flightProgress === null`):
 *   Preserves the full planned outbound path and full return-to-home path.
 * - Case B (EXECUTING on outbound leg):
 *   Starts at `drone.position`, keeps remaining outbound segments, counts only still-pending
 *   targets, and preserves the return-to-home path from the final outbound objective.
 * - Case C (EXECUTING on return-to-home leg, or all outbound targets already visited):
 *   Sets `leg = "return"`, `outboundWaypoints = [drone.position]` (0m, 0% outbound/dwell),
 *   and verifies only `[drone.position, ...remainingReturnTail]` back to `homeBase`.
 * - Case D (PAUSED during outbound or return):
 *   Uses preserved `flightProgress` + `executedRoute` to slice from the exact live
 *   `drone.position` without repeating completed segments or dropping unflown waypoints.
 */
export function deriveRemainingMissionRoute(context: {
  drone: DroneState;
  scenario: ScenarioDefinition;
  targets: readonly RescueTarget[];
  plan: MissionPlan | null;
  route: ResolvedRoute;
  executedRoute: ResolvedRoute | null;
  flightProgress: FlightProgressState | null;
}): RemainingMissionRoute {
  const {
    drone,
    scenario,
    targets,
    plan,
    route,
    executedRoute,
    flightProgress,
  } = context;

  const activeRoute =
    flightProgress !== null && executedRoute !== null ? executedRoute : route;

  const targetById = new Map(targets.map((t) => [t.id, t]));
  const plannedIds =
    activeRoute.targetIds.length > 0
      ? activeRoute.targetIds
      : (plan?.targetOrder ?? []);

  const remainingTargetIds = plannedIds.filter(
    (id) => targetById.get(id)?.status === "pending",
  );

  const isReturnStage =
    flightProgress?.leg === "return" || remainingTargetIds.length === 0;

  // Case C & Case D (return): All outbound targets visited or actively flying RTH leg.
  if (isReturnStage) {
    const returnTail =
      flightProgress?.leg === "return"
        ? activeRoute.returnWaypoints.slice(flightProgress.segmentIndex + 1)
        : activeRoute.returnWaypoints;

    let returnWaypoints = dedupeConsecutiveWaypoints([
      drone.position,
      ...returnTail,
    ]);

    if (returnWaypoints.length === 0) {
      returnWaypoints = [{ ...drone.position }];
    }

    // If not yet at home base and returnWaypoints collapsed to 1 point without reaching home,
    // keep the single point so verifyRoute flags the missing RTH connection explicitly.
    const outboundWaypoints: Vector3[] = [{ ...drone.position }];
    return {
      leg: "return",
      outboundWaypoints,
      returnWaypoints,
      combinedTrajectory: returnWaypoints.map((p) => ({ ...p })),
      remainingTargetIds: [],
      inspectedTargetCount: 0,
      outboundDistanceMeters: 0,
      returnDistanceMeters: computePolylineDistance(returnWaypoints),
    };
  }

  // Case A (READY before execution): preserve complete planned outbound & return paths.
  if (flightProgress === null) {
    let outboundWaypoints = dedupeConsecutiveWaypoints([
      drone.position,
      ...activeRoute.waypoints,
    ]);
    if (outboundWaypoints.length === 1 && outboundWaypoints[0]) {
      // Stationary single-target hover right at current drone position.
      outboundWaypoints = [
        { ...outboundWaypoints[0] },
        { ...outboundWaypoints[0] },
      ];
    }

    const returnWaypoints =
      activeRoute.returnWaypoints.length > 0
        ? dedupeConsecutiveWaypoints(activeRoute.returnWaypoints)
        : [{ ...scenario.homeBase.hoverPosition }];

    const combinedTrajectory = dedupeConsecutiveWaypoints([
      ...outboundWaypoints,
      ...returnWaypoints,
    ]);

    return {
      leg: "outbound",
      outboundWaypoints,
      returnWaypoints,
      combinedTrajectory,
      remainingTargetIds,
      inspectedTargetCount: remainingTargetIds.length,
      outboundDistanceMeters: computePolylineDistance(outboundWaypoints),
      returnDistanceMeters: computePolylineDistance(returnWaypoints),
    };
  }

  // Case B & Case D (outbound): mid-flight or paused on outbound leg with pending targets.
  const outboundTail = activeRoute.waypoints.slice(
    flightProgress.segmentIndex + 1,
  );
  let outboundWaypoints = dedupeConsecutiveWaypoints([
    drone.position,
    ...outboundTail,
  ]);
  if (outboundWaypoints.length === 1 && outboundWaypoints[0]) {
    outboundWaypoints = [
      { ...outboundWaypoints[0] },
      { ...outboundWaypoints[0] },
    ];
  }

  const returnWaypoints =
    activeRoute.returnWaypoints.length > 0
      ? dedupeConsecutiveWaypoints(activeRoute.returnWaypoints)
      : [{ ...scenario.homeBase.hoverPosition }];

  const combinedTrajectory = dedupeConsecutiveWaypoints([
    ...outboundWaypoints,
    ...returnWaypoints,
  ]);

  return {
    leg: "outbound",
    outboundWaypoints,
    returnWaypoints,
    combinedTrajectory,
    remainingTargetIds,
    inspectedTargetCount: remainingTargetIds.length,
    outboundDistanceMeters: computePolylineDistance(outboundWaypoints),
    returnDistanceMeters: computePolylineDistance(returnWaypoints),
  };
}
