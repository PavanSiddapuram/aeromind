import type {
  DroneState,
  EnergyBreakdown,
  MissionConstraints,
  NoFlyZone,
  RouteViolation,
  ScenarioDefinition,
  ScenarioObstacle,
  Vector3,
  VerificationReport,
} from "../index.js";
import { estimateMissionEnergy } from "../energy/energy-model.js";
import { containsPoint, expandAABB } from "../geometry/aabb.js";
import { intersectSegmentAABB } from "../geometry/segment-aabb.js";
import { equals, isFiniteVector3 } from "../math/vector3.js";
import { VERIFIER_POLICY_VERSION } from "../scenario/flood-scenario.js";

export type VerifyRouteInput = {
  routeId: string;
  environmentVersion: number;
  waypoints: Vector3[];
  returnWaypoints: Vector3[];
  inspectedTargetCount: number;
  executionLeg?: "outbound" | "return" | undefined;
  drone: DroneState;
  constraints: MissionConstraints;
  scenario: ScenarioDefinition;
  obstacles?: ScenarioObstacle[] | undefined;
  noFlyZones?: NoFlyZone[] | undefined;
  windMetersPerSecond?: number | undefined;
  policyVersion?: string | undefined;
  now?: (() => string) | undefined;
};

function makeFallbackEnergy(
  availableBatteryPercent: number,
  requiredReservePercent: number,
): EnergyBreakdown {
  const safeBattery = Number.isFinite(availableBatteryPercent)
    ? availableBatteryPercent
    : 0;
  const safeReserve = Number.isFinite(requiredReservePercent)
    ? requiredReservePercent
    : 20;
  return {
    missionTravelPercent: 0,
    missionClimbPercent: 0,
    missionWindPercent: 0,
    missionOperationPercent: 0,
    estimatedMissionEnergyPercent: 0,
    estimatedReturnEnergyPercent: 0,
    requiredReservePercent: safeReserve,
    availableBatteryPercent: safeBattery,
    projectedLandingReservePercent: safeBattery,
    feasible: false,
  };
}

/**
 * Deterministic, fail-closed route verifier.
 * Independently evaluates waypoint bounds, altitude limits, expanded obstacle AABBs,
 * inflated no-fly zones, return-to-home connectivity, and mission + RTH energy reserves.
 */
export function verifyRoute(input: VerifyRouteInput): VerificationReport {
  const policyVersion = input.policyVersion ?? VERIFIER_POLICY_VERSION;
  const verifiedAt = input.now ? input.now() : new Date().toISOString();
  const violations: RouteViolation[] = [];

  try {
    const obstacles = input.obstacles ?? input.scenario.obstacles;
    const noFlyZones = input.noFlyZones ?? input.scenario.noFlyZones;
    const wind = input.windMetersPerSecond ?? input.scenario.windMetersPerSecond;

    if (
      !Number.isFinite(input.drone.radiusMeters) ||
      input.drone.radiusMeters < 0 ||
      !Number.isFinite(input.scenario.safetyClearanceMeters) ||
      input.scenario.safetyClearanceMeters < 0
    ) {
      throw new RangeError("Invalid drone radius or safety clearance");
    }

    if (
      !Number.isFinite(input.constraints.maxAltitudeMeters) ||
      input.constraints.maxAltitudeMeters <= 0
    ) {
      throw new RangeError("Invalid maxAltitudeMeters constraint");
    }

    const isReturnOnly =
      input.executionLeg === "return" ||
      (input.waypoints.length === 1 && input.inspectedTargetCount === 0);

    if (isReturnOnly) {
      if (input.waypoints.length < 1) {
        violations.push({
          code: "INVALID_WAYPOINT",
          leg: "return",
          message:
            "Return-to-home verification requires the current drone anchor waypoint.",
        });
      }
      if (input.inspectedTargetCount > 0) {
        violations.push({
          code: "INVALID_WAYPOINT",
          leg: "return",
          message:
            "Return-only route must not include pending outbound target inspections.",
        });
      }
    } else if (input.waypoints.length < 2) {
      violations.push({
        code: "INVALID_WAYPOINT",
        leg: "outbound",
        message: "Outbound route must contain at least two waypoints.",
      });
    }

    const obstacleMargin =
      input.drone.radiusMeters + input.scenario.safetyClearanceMeters;
    const expandedObstacles = obstacles.map((obs) => ({
      id: obs.id,
      label: obs.label,
      bounds: expandAABB(obs.bounds, obstacleMargin),
    }));
    const expandedZones = noFlyZones.map((zone) => ({
      id: zone.id,
      label: zone.label,
      bounds: expandAABB(zone.bounds, input.drone.radiusMeters),
    }));

    const checkWaypointsAndSegments = (
      polyline: Vector3[],
      leg: "outbound" | "return",
    ) => {
      const legLabel = leg === "outbound" ? "mission" : "return-to-home";

      for (let i = 0; i < polyline.length; i += 1) {
        const wp = polyline[i];
        if (!wp || !isFiniteVector3(wp)) {
          violations.push({
            code: "INVALID_WAYPOINT",
            leg,
            message: `${legLabel} waypoint ${i} has non-finite coordinates.`,
            segmentIndex: Math.max(0, i - 1),
          });
          return;
        }

        if (
          wp.y < 0 ||
          !containsPoint(input.scenario.worldBounds, wp, true)
        ) {
          violations.push({
            code: "INVALID_WAYPOINT",
            leg,
            message: `${legLabel} waypoint ${i} (${wp.x.toFixed(1)}, ${wp.y.toFixed(1)}, ${wp.z.toFixed(1)}) is outside scenario bounds.`,
            segmentIndex: Math.max(0, i - 1),
            point: { ...wp },
          });
        }

        if (wp.y > input.constraints.maxAltitudeMeters) {
          violations.push({
            code: "ALTITUDE_LIMIT",
            leg,
            message: `${legLabel} waypoint ${i} altitude ${wp.y.toFixed(1)}m exceeds max limit ${input.constraints.maxAltitudeMeters}m.`,
            segmentIndex: Math.max(0, i - 1),
            point: { ...wp },
          });
        }
      }

      for (let i = 0; i < polyline.length - 1; i += 1) {
        const start = polyline[i];
        const end = polyline[i + 1];
        if (!start || !end || !isFiniteVector3(start) || !isFiniteVector3(end)) {
          continue;
        }

        for (const obstacle of expandedObstacles) {
          const hit = intersectSegmentAABB(start, end, obstacle.bounds);
          if (hit.intersects) {
            violations.push({
              code: "OBSTACLE_COLLISION",
              leg,
              message: `${legLabel} segment ${i} violates ${obstacleMargin.toFixed(1)}m safety envelope of ${obstacle.id} (${obstacle.label}).`,
              segmentIndex: i,
              point: hit.point ?? { ...start },
              entityId: obstacle.id,
            });
          }
        }

        for (const zone of expandedZones) {
          const hit = intersectSegmentAABB(start, end, zone.bounds);
          if (hit.intersects) {
            violations.push({
              code: "NO_FLY_ZONE",
              leg,
              message: `${legLabel} segment ${i} enters restricted airspace ${zone.id} (${zone.label}).`,
              segmentIndex: i,
              point: hit.point ?? { ...start },
              entityId: zone.id,
            });
          }
        }
      }
    };

    if (input.waypoints.length > 0) {
      checkWaypointsAndSegments(input.waypoints, "outbound");
    }

    const missionEnd = input.waypoints[input.waypoints.length - 1];
    const alreadyAtHome =
      missionEnd !== undefined &&
      isFiniteVector3(missionEnd) &&
      equals(missionEnd, input.scenario.homeBase.hoverPosition, 1e-3);

    const returnStart = input.returnWaypoints[0];
    const returnEnd = input.returnWaypoints[input.returnWaypoints.length - 1];

    const validReturnChain =
      (alreadyAtHome &&
        (input.returnWaypoints.length === 0 ||
          (returnStart !== undefined &&
            returnEnd !== undefined &&
            isFiniteVector3(returnStart) &&
            isFiniteVector3(returnEnd) &&
            equals(returnStart, missionEnd, 1e-3) &&
            equals(returnEnd, input.scenario.homeBase.hoverPosition, 1e-3)))) ||
      (input.returnWaypoints.length >= 2 &&
        returnStart !== undefined &&
        returnEnd !== undefined &&
        missionEnd !== undefined &&
        isFiniteVector3(returnStart) &&
        isFiniteVector3(returnEnd) &&
        isFiniteVector3(missionEnd) &&
        equals(returnStart, missionEnd, 1e-3) &&
        equals(returnEnd, input.scenario.homeBase.hoverPosition, 1e-3));

    if (input.returnWaypoints.length > 0) {
      checkWaypointsAndSegments(input.returnWaypoints, "return");
    }

    const hasInvalidWaypoint = violations.some(
      (v) => v.code === "INVALID_WAYPOINT",
    );

    const energy = hasInvalidWaypoint
      ? makeFallbackEnergy(
          input.drone.batteryPercent,
          input.constraints.minLandingReservePercent,
        )
      : estimateMissionEnergy({
          missionWaypoints: isReturnOnly ? [] : input.waypoints,
          returnWaypoints: input.returnWaypoints,
          inspectedTargetCount: isReturnOnly ? 0 : input.inspectedTargetCount,
          availableBatteryPercent: input.drone.batteryPercent,
          minLandingReservePercent: input.constraints.minLandingReservePercent,
          windMetersPerSecond: wind,
          config: input.scenario.energyConfig,
          returnPathAvailable: validReturnChain,
        });

    if (!hasInvalidWaypoint && !validReturnChain) {
      violations.push({
        code: "ENERGY_INFEASIBLE",
        leg: "return",
        message:
          "No valid return-to-home path connects the final mission waypoint back to home base.",
      });
    } else if (!hasInvalidWaypoint && !energy.feasible) {
      violations.push({
        code: "ENERGY_INFEASIBLE",
        leg: isReturnOnly ? "return" : "outbound",
        message: `Projected landing reserve ${energy.projectedLandingReservePercent.toFixed(1)}% is below required ${input.constraints.minLandingReservePercent.toFixed(1)}% (battery ${input.drone.batteryPercent.toFixed(1)}%, mission ${energy.estimatedMissionEnergyPercent.toFixed(1)}%, return ${energy.estimatedReturnEnergyPercent.toFixed(1)}%).`,
      });
    }

    const approved = violations.length === 0 && energy.feasible;

    return {
      routeId: input.routeId,
      environmentVersion: input.environmentVersion,
      policyVersion,
      approved,
      violations,
      estimatedMissionEnergyPercent: energy.estimatedMissionEnergyPercent,
      estimatedReturnEnergyPercent: energy.estimatedReturnEnergyPercent,
      projectedLandingReservePercent: energy.projectedLandingReservePercent,
      energy,
      verifiedAt,
    };
  } catch (error) {
    // INV-03: Verifier exceptions always fail closed and never approve execution.
    const fallbackEnergy = makeFallbackEnergy(
      input.drone.batteryPercent,
      input.constraints.minLandingReservePercent,
    );
    return {
      routeId: input.routeId,
      environmentVersion: input.environmentVersion,
      policyVersion,
      approved: false,
      violations: [
        ...violations,
        {
          code: "INVALID_WAYPOINT",
          message:
            error instanceof Error
              ? `Verifier failed closed: ${error.message}`
              : "Verifier failed closed due to an internal error.",
        },
      ],
      estimatedMissionEnergyPercent: 0,
      estimatedReturnEnergyPercent: 0,
      projectedLandingReservePercent: fallbackEnergy.projectedLandingReservePercent,
      energy: fallbackEnergy,
      verifiedAt,
    };
  }
}
