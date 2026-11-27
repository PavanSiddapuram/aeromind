import { describe, expect, it } from "vitest";
import type { EnergyConfig } from "../index.js";
import { estimateMissionEnergy } from "./energy-model.js";

const unitConfig: EnergyConfig = {
  travelPercentPerMeter: 0.5,
  climbPercentPerMeter: 1.0,
  windFactorPerMeterPerSecond: 0.1,
  inspectionOperationPercent: 5.0,
};

describe("deterministic energy and landing-reserve model", () => {
  it("accepts a route whose mission + return + reserve exactly equals available battery (>= policy)", () => {
    // 40m flat outbound => travel 20%, wind=0 => 20% + 1 target (5%) = 25%
    // 40m flat return => 20%
    // Reserve => 20%
    // Total required = 65%; available = 65%
    const breakdown = estimateMissionEnergy({
      missionWaypoints: [
        { x: 0, y: 20, z: 0 },
        { x: 40, y: 20, z: 0 },
      ],
      returnWaypoints: [
        { x: 40, y: 20, z: 0 },
        { x: 0, y: 20, z: 0 },
      ],
      inspectedTargetCount: 1,
      availableBatteryPercent: 65,
      minLandingReservePercent: 20,
      windMetersPerSecond: 0,
      config: unitConfig,
    });

    expect(breakdown.estimatedMissionEnergyPercent).toBe(25);
    expect(breakdown.estimatedReturnEnergyPercent).toBe(20);
    expect(breakdown.projectedLandingReservePercent).toBe(20);
    expect(breakdown.feasible).toBe(true);
  });

  it("rejects when required energy exceeds available battery even slightly", () => {
    const breakdown = estimateMissionEnergy({
      missionWaypoints: [
        { x: 0, y: 20, z: 0 },
        { x: 40, y: 20, z: 0 },
      ],
      returnWaypoints: [
        { x: 40, y: 20, z: 0 },
        { x: 0, y: 20, z: 0 },
      ],
      inspectedTargetCount: 1,
      availableBatteryPercent: 64.9,
      minLandingReservePercent: 20,
      windMetersPerSecond: 0,
      config: unitConfig,
    });

    expect(breakdown.feasible).toBe(false);
    expect(breakdown.projectedLandingReservePercent).toBeCloseTo(19.9);
  });

  it("recomputes increased cost from positive climbs and headwind", () => {
    const calmFlat = estimateMissionEnergy({
      missionWaypoints: [
        { x: 0, y: 15, z: 0 },
        { x: 30, y: 15, z: 0 },
      ],
      returnWaypoints: [
        { x: 30, y: 15, z: 0 },
        { x: 0, y: 15, z: 0 },
      ],
      inspectedTargetCount: 0,
      availableBatteryPercent: 90,
      minLandingReservePercent: 20,
      windMetersPerSecond: 0,
      config: unitConfig,
    });

    const windyClimb = estimateMissionEnergy({
      missionWaypoints: [
        { x: 0, y: 15, z: 0 },
        { x: 30, y: 25, z: 0 },
      ],
      returnWaypoints: [
        { x: 30, y: 25, z: 0 },
        { x: 0, y: 15, z: 0 },
      ],
      inspectedTargetCount: 0,
      availableBatteryPercent: 90,
      minLandingReservePercent: 20,
      windMetersPerSecond: 4,
      config: unitConfig,
    });

    expect(windyClimb.missionClimbPercent).toBeGreaterThan(0);
    expect(windyClimb.missionWindPercent).toBeGreaterThan(0);
    expect(windyClimb.estimatedMissionEnergyPercent).toBeGreaterThan(
      calmFlat.estimatedMissionEnergyPercent,
    );
  });

  it("marks route infeasible when return path is unavailable", () => {
    const breakdown = estimateMissionEnergy({
      missionWaypoints: [
        { x: 0, y: 20, z: 0 },
        { x: 10, y: 20, z: 0 },
      ],
      returnWaypoints: [],
      inspectedTargetCount: 1,
      availableBatteryPercent: 100,
      minLandingReservePercent: 20,
      windMetersPerSecond: 0,
      config: unitConfig,
      returnPathAvailable: false,
    });

    expect(breakdown.feasible).toBe(false);
  });

  it("rejects negative or NaN energy coefficients", () => {
    expect(() =>
      estimateMissionEnergy({
        missionWaypoints: [
          { x: 0, y: 10, z: 0 },
          { x: 10, y: 10, z: 0 },
        ],
        returnWaypoints: [
          { x: 10, y: 10, z: 0 },
          { x: 0, y: 10, z: 0 },
        ],
        inspectedTargetCount: 0,
        availableBatteryPercent: 80,
        minLandingReservePercent: 20,
        windMetersPerSecond: 0,
        config: { ...unitConfig, travelPercentPerMeter: -0.1 },
      }),
    ).toThrow(RangeError);

    expect(() =>
      estimateMissionEnergy({
        missionWaypoints: [
          { x: 0, y: 10, z: 0 },
          { x: 10, y: 10, z: 0 },
        ],
        returnWaypoints: [
          { x: 10, y: 10, z: 0 },
          { x: 0, y: 10, z: 0 },
        ],
        inspectedTargetCount: 0,
        availableBatteryPercent: 80,
        minLandingReservePercent: 20,
        windMetersPerSecond: 0,
        config: { ...unitConfig, climbPercentPerMeter: Number.NaN },
      }),
    ).toThrow(RangeError);
  });
});
