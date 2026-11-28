import { describe, expect, it } from "vitest";
import { resolveMissionRoute } from "../navigation/astar.js";
import {
  FLOOD_SCENARIO,
  cloneScenarioSnapshot,
} from "../scenario/flood-scenario.js";
import { verifyRoute } from "./route-verifier.js";

describe("deterministic route verifier", () => {
  it("approves an A*-resolved multi-target East Block mission under baseline constraints", () => {
    const scenario = cloneScenarioSnapshot(FLOOD_SCENARIO);
    const resolved = resolveMissionRoute({
      routeId: "route-ok",
      environmentVersion: 1,
      scenario,
      obstacles: scenario.obstacles,
      targets: scenario.targets,
      drone: scenario.initialDrone,
      constraints: scenario.defaultConstraints,
      targetOrder: ["ROOF-02", "ROOF-03"],
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const report = verifyRoute({
      routeId: resolved.route.routeId,
      environmentVersion: 1,
      waypoints: resolved.route.waypoints,
      returnWaypoints: resolved.route.returnWaypoints,
      inspectedTargetCount: resolved.route.targetIds.length,
      drone: scenario.initialDrone,
      constraints: scenario.defaultConstraints,
      scenario,
    });

    expect(report.approved).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.projectedLandingReservePercent).toBeGreaterThanOrEqual(
      scenario.defaultConstraints.minLandingReservePercent,
    );
  });

  it("rejects a route intersecting an expanded building or spawned obstacle with OBSTACLE_COLLISION", () => {
    const scenario = cloneScenarioSnapshot(FLOOD_SCENARIO);
    const resolved = resolveMissionRoute({
      routeId: "route-south",
      environmentVersion: 1,
      scenario,
      obstacles: scenario.obstacles,
      targets: scenario.targets,
      drone: scenario.initialDrone,
      constraints: scenario.defaultConstraints,
      targetOrder: ["ROOF-02"],
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    // Now spawn crane-01 and re-verify the previously resolved southern route
    const crane = scenario.chaosObstaclePresets["crane-01"]!;
    const report = verifyRoute({
      routeId: resolved.route.routeId,
      environmentVersion: 2,
      waypoints: resolved.route.waypoints,
      returnWaypoints: resolved.route.returnWaypoints,
      inspectedTargetCount: 1,
      drone: scenario.initialDrone,
      constraints: scenario.defaultConstraints,
      scenario,
      obstacles: [...scenario.obstacles, crane],
    });

    expect(report.approved).toBe(false);
    expect(
      report.violations.some(
        (v) => v.code === "OBSTACLE_COLLISION" && v.entityId === "crane-01",
      ),
    ).toBe(true);
  });

  it("rejects a segment entering the restricted no-fly zone with NO_FLY_ZONE (GEO-09)", () => {
    const scenario = cloneScenarioSnapshot(FLOOD_SCENARIO);
    const home = scenario.homeBase.hoverPosition;

    // Straight line from home (-56, 16, 48) through NFZ-01 (x in [-6,10], z in [-10,8]) to (24, 24, -32)
    const report = verifyRoute({
      routeId: "route-nfz",
      environmentVersion: 1,
      waypoints: [home, { x: 2, y: 20, z: 0 }, home],
      returnWaypoints: [home, home],
      inspectedTargetCount: 0,
      drone: scenario.initialDrone,
      constraints: scenario.defaultConstraints,
      scenario,
    });

    expect(report.approved).toBe(false);
    expect(
      report.violations.some(
        (v) => v.code === "NO_FLY_ZONE" && v.entityId === "NFZ-01",
      ),
    ).toBe(true);
  });

  it("rejects waypoints exceeding maxAltitudeMeters with ALTITUDE_LIMIT (GEO-10)", () => {
    const scenario = cloneScenarioSnapshot(FLOOD_SCENARIO);
    const home = scenario.homeBase.hoverPosition;

    const report = verifyRoute({
      routeId: "route-alt",
      environmentVersion: 1,
      waypoints: [home, { x: -56, y: 44, z: 48 }, home],
      returnWaypoints: [home, home],
      inspectedTargetCount: 0,
      drone: scenario.initialDrone,
      constraints: { maxAltitudeMeters: 40, minLandingReservePercent: 20 },
      scenario,
    });

    expect(report.approved).toBe(false);
    expect(report.violations.some((v) => v.code === "ALTITUDE_LIMIT")).toBe(
      true,
    );
  });

  it("rejects insufficient battery reserve with ENERGY_INFEASIBLE", () => {
    const scenario = cloneScenarioSnapshot(FLOOD_SCENARIO);
    const resolved = resolveMissionRoute({
      routeId: "route-all-4",
      environmentVersion: 1,
      scenario,
      obstacles: scenario.obstacles,
      targets: scenario.targets,
      drone: scenario.initialDrone,
      constraints: scenario.defaultConstraints,
      targetOrder: ["ROOF-02", "ROOF-03", "ROOF-01", "ROOF-04"],
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const lowBatteryDrone = { ...scenario.initialDrone, batteryPercent: 45 };
    const report = verifyRoute({
      routeId: resolved.route.routeId,
      environmentVersion: 1,
      waypoints: resolved.route.waypoints,
      returnWaypoints: resolved.route.returnWaypoints,
      inspectedTargetCount: 4,
      drone: lowBatteryDrone,
      constraints: scenario.defaultConstraints,
      scenario,
    });

    expect(report.approved).toBe(false);
    expect(report.violations.some((v) => v.code === "ENERGY_INFEASIBLE")).toBe(
      true,
    );
  });

  it("fails closed if verifier encounters malformed obstacle bounds or non-finite inputs", () => {
    const scenario = cloneScenarioSnapshot(FLOOD_SCENARIO);
    const home = scenario.homeBase.hoverPosition;

    const brokenScenario = {
      ...scenario,
      safetyClearanceMeters: -5,
    };

    const report = verifyRoute({
      routeId: "route-broken",
      environmentVersion: 1,
      waypoints: [home, home],
      returnWaypoints: [home, home],
      inspectedTargetCount: 0,
      drone: scenario.initialDrone,
      constraints: scenario.defaultConstraints,
      scenario: brokenScenario,
    });

    expect(report.approved).toBe(false);
    expect(report.violations.length).toBeGreaterThan(0);
  });

  it("verifies a return-only route accounting for return energy once and zero outbound/dwell energy", () => {
    const scenario = cloneScenarioSnapshot(FLOOD_SCENARIO);
    const roof02 = scenario.targets.find((t) => t.id === "ROOF-02")!;
    const resolved = resolveMissionRoute({
      routeId: "route-rth-verify",
      environmentVersion: 1,
      scenario,
      obstacles: scenario.obstacles,
      targets: scenario.targets,
      drone: { ...scenario.initialDrone, position: { ...roof02.position }, batteryPercent: 60 },
      constraints: scenario.defaultConstraints,
      targetOrder: [],
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const report = verifyRoute({
      routeId: resolved.route.routeId,
      environmentVersion: 1,
      waypoints: resolved.route.waypoints,
      returnWaypoints: resolved.route.returnWaypoints,
      inspectedTargetCount: 0,
      executionLeg: "return",
      drone: { ...scenario.initialDrone, position: { ...roof02.position }, batteryPercent: 60 },
      constraints: scenario.defaultConstraints,
      scenario,
    });

    expect(report.approved).toBe(true);
    expect(report.estimatedMissionEnergyPercent).toBe(0);
    expect(report.estimatedReturnEnergyPercent).toBeGreaterThan(0);
    expect(report.projectedLandingReservePercent).toBeCloseTo(
      60 - report.estimatedReturnEnergyPercent,
      5,
    );
  });
});
