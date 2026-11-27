import type { EnergyBreakdown, EnergyConfig, Vector3 } from "../index.js";
import { assertFiniteVector3, distance } from "../math/vector3.js";

export function assertValidEnergyConfig(config: EnergyConfig): void {
  const entries: [string, number][] = [
    ["travelPercentPerMeter", config.travelPercentPerMeter],
    ["climbPercentPerMeter", config.climbPercentPerMeter],
    ["windFactorPerMeterPerSecond", config.windFactorPerMeterPerSecond],
    ["inspectionOperationPercent", config.inspectionOperationPercent],
  ];

  for (const [name, value] of entries) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(
        `EnergyConfig.${name} must be a finite, non-negative number`,
      );
    }
  }
}

export function computePolylineEnergyComponents(
  waypoints: Vector3[],
  config: EnergyConfig,
  windMetersPerSecond: number,
): {
  travelPercent: number;
  climbPercent: number;
  windPercent: number;
  totalPercent: number;
} {
  assertValidEnergyConfig(config);
  if (!Number.isFinite(windMetersPerSecond) || windMetersPerSecond < 0) {
    throw new RangeError("windMetersPerSecond must be finite and non-negative");
  }

  if (waypoints.length < 2) {
    return {
      travelPercent: 0,
      climbPercent: 0,
      windPercent: 0,
      totalPercent: 0,
    };
  }

  let totalDistance = 0;
  let totalClimb = 0;

  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const start = waypoints[i];
    const end = waypoints[i + 1];
    if (!start || !end) continue;
    assertFiniteVector3(start, `waypoints[${i}]`);
    assertFiniteVector3(end, `waypoints[${i + 1}]`);

    totalDistance += distance(start, end);
    totalClimb += Math.max(0, end.y - start.y);
  }

  const travelPercent = totalDistance * config.travelPercentPerMeter;
  const climbPercent = totalClimb * config.climbPercentPerMeter;
  const windPercent =
    travelPercent * (windMetersPerSecond * config.windFactorPerMeterPerSecond);
  const totalPercent = travelPercent + climbPercent + windPercent;

  return {
    travelPercent,
    climbPercent,
    windPercent,
    totalPercent,
  };
}

export function estimateMissionEnergy(params: {
  missionWaypoints: Vector3[];
  returnWaypoints: Vector3[];
  inspectedTargetCount: number;
  availableBatteryPercent: number;
  minLandingReservePercent: number;
  windMetersPerSecond: number;
  config: EnergyConfig;
  returnPathAvailable?: boolean | undefined;
}): EnergyBreakdown {
  const {
    missionWaypoints,
    returnWaypoints,
    inspectedTargetCount,
    availableBatteryPercent,
    minLandingReservePercent,
    windMetersPerSecond,
    config,
    returnPathAvailable = true,
  } = params;

  assertValidEnergyConfig(config);

  if (
    !Number.isFinite(availableBatteryPercent) ||
    availableBatteryPercent < 0 ||
    availableBatteryPercent > 100
  ) {
    throw new RangeError("availableBatteryPercent must be within [0, 100]");
  }
  if (
    !Number.isFinite(minLandingReservePercent) ||
    minLandingReservePercent < 0 ||
    minLandingReservePercent > 100
  ) {
    throw new RangeError("minLandingReservePercent must be within [0, 100]");
  }
  if (!Number.isFinite(inspectedTargetCount) || inspectedTargetCount < 0) {
    throw new RangeError("inspectedTargetCount must be finite and non-negative");
  }

  const missionLeg = computePolylineEnergyComponents(
    missionWaypoints,
    config,
    windMetersPerSecond,
  );
  const returnLeg = computePolylineEnergyComponents(
    returnWaypoints,
    config,
    windMetersPerSecond,
  );

  const missionOperationPercent =
    inspectedTargetCount * config.inspectionOperationPercent;
  const estimatedMissionEnergyPercent =
    missionLeg.totalPercent + missionOperationPercent;
  const estimatedReturnEnergyPercent = returnLeg.totalPercent;
  const requiredTotal =
    estimatedMissionEnergyPercent +
    estimatedReturnEnergyPercent +
    minLandingReservePercent;
  const projectedLandingReservePercent =
    availableBatteryPercent -
    (estimatedMissionEnergyPercent + estimatedReturnEnergyPercent);

  // Policy: exact reserve match (>=) passes; missing return path always fails.
  const feasible =
    returnPathAvailable && availableBatteryPercent >= requiredTotal;

  return {
    missionTravelPercent: missionLeg.travelPercent,
    missionClimbPercent: missionLeg.climbPercent,
    missionWindPercent: missionLeg.windPercent,
    missionOperationPercent,
    estimatedMissionEnergyPercent,
    estimatedReturnEnergyPercent,
    requiredReservePercent: minLandingReservePercent,
    availableBatteryPercent,
    projectedLandingReservePercent,
    feasible,
  };
}
