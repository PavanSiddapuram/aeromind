import { describe, expect, it } from "vitest";
import { assertValidAABB, expandAABB } from "../geometry/aabb.js";
import { intersectSegmentAABB } from "../geometry/segment-aabb.js";
import {
  FLOOD_SCENARIO,
  cloneScenarioSnapshot,
  resolvePreviewWaypoints,
} from "./flood-scenario.js";

describe("canonical urban flood scenario (FLOOD_SCENARIO)", () => {
  it("has valid world bounds, building AABBs, and restricted zone AABBs", () => {
    expect(() => assertValidAABB(FLOOD_SCENARIO.worldBounds, "worldBounds")).not.toThrow();

    for (const obstacle of FLOOD_SCENARIO.obstacles) {
      expect(() => assertValidAABB(obstacle.bounds, obstacle.id)).not.toThrow();
      expect(obstacle.bounds.max.y).toBeGreaterThan(0);
    }

    for (const zone of FLOOD_SCENARIO.noFlyZones) {
      expect(() => assertValidAABB(zone.bounds, zone.id)).not.toThrow();
    }
  });

  it("places every rescue target (including ROOF-01 and presets) strictly above its building footprint with safe vertical clearance", () => {
    const buildingById = new Map(
      FLOOD_SCENARIO.obstacles.map((obstacle) => [obstacle.id, obstacle]),
    );
    const totalClearance =
      FLOOD_SCENARIO.initialDrone.radiusMeters + FLOOD_SCENARIO.safetyClearanceMeters;

    const allTargets = [
      ...FLOOD_SCENARIO.targets,
      ...Object.values(FLOOD_SCENARIO.discoverableTargetPresets),
    ];

    expect(allTargets.some((target) => target.id === "ROOF-01")).toBe(true);

    for (const target of allTargets) {
      const building = buildingById.get(target.buildingId);
      expect(building, `Missing host building for ${target.id}`).toBeDefined();
      if (!building) continue;

      // Horizontally strictly inside the building's roof footprint
      expect(target.position.x).toBeGreaterThan(building.bounds.min.x);
      expect(target.position.x).toBeLessThan(building.bounds.max.x);
      expect(target.position.z).toBeGreaterThan(building.bounds.min.z);
      expect(target.position.z).toBeLessThan(building.bounds.max.z);

      // Vertically above expanded building roof and within default max altitude
      expect(target.rooftopElevationMeters).toBe(building.bounds.max.y);
      expect(target.position.y).toBeGreaterThan(building.bounds.max.y + totalClearance);
      expect(target.position.y).toBeLessThanOrEqual(
        FLOOD_SCENARIO.defaultConstraints.maxAltitudeMeters,
      );
    }
  });

  it("ensures the preview route clears all expanded buildings, inflated no-fly zones, and max altitude", () => {
    const waypoints = resolvePreviewWaypoints(FLOOD_SCENARIO);
    expect(waypoints.length).toBeGreaterThanOrEqual(4);

    const obstacleMargin =
      FLOOD_SCENARIO.initialDrone.radiusMeters + FLOOD_SCENARIO.safetyClearanceMeters;
    const expandedObstacles = FLOOD_SCENARIO.obstacles.map((obstacle) => ({
      id: obstacle.id,
      bounds: expandAABB(obstacle.bounds, obstacleMargin),
    }));
    const expandedZones = FLOOD_SCENARIO.noFlyZones.map((zone) => ({
      id: zone.id,
      bounds: expandAABB(zone.bounds, FLOOD_SCENARIO.initialDrone.radiusMeters),
    }));

    for (let i = 0; i < waypoints.length - 1; i += 1) {
      const start = waypoints[i];
      const end = waypoints[i + 1];
      if (!start || !end) continue;

      expect(start.y).toBeLessThanOrEqual(
        FLOOD_SCENARIO.defaultConstraints.maxAltitudeMeters,
      );
      expect(end.y).toBeLessThanOrEqual(
        FLOOD_SCENARIO.defaultConstraints.maxAltitudeMeters,
      );

      for (const obstacle of expandedObstacles) {
        const hit = intersectSegmentAABB(start, end, obstacle.bounds);
        expect(
          hit.intersects,
          `Preview segment ${i} collided with ${obstacle.id}`,
        ).toBe(false);
      }

      for (const zone of expandedZones) {
        const hit = intersectSegmentAABB(start, end, zone.bounds);
        expect(
          hit.intersects,
          `Preview segment ${i} entered restricted zone ${zone.id}`,
        ).toBe(false);
      }
    }
  });

  it("ensures all baseline navigation graph edges clear static buildings and restricted zones", () => {
    const nodeMap = new Map(FLOOD_SCENARIO.nodes.map((node) => [node.id, node]));
    const obstacleMargin =
      FLOOD_SCENARIO.initialDrone.radiusMeters + FLOOD_SCENARIO.safetyClearanceMeters;
    const expandedObstacles = FLOOD_SCENARIO.obstacles.map((obstacle) => ({
      id: obstacle.id,
      bounds: expandAABB(obstacle.bounds, obstacleMargin),
    }));
    const expandedZones = FLOOD_SCENARIO.noFlyZones.map((zone) => ({
      id: zone.id,
      bounds: expandAABB(zone.bounds, FLOOD_SCENARIO.initialDrone.radiusMeters),
    }));

    for (const edge of FLOOD_SCENARIO.edges) {
      const fromNode = nodeMap.get(edge.from);
      const toNode = nodeMap.get(edge.to);
      expect(fromNode, `Missing node ${edge.from}`).toBeDefined();
      expect(toNode, `Missing node ${edge.to}`).toBeDefined();
      if (!fromNode || !toNode) continue;

      for (const obstacle of expandedObstacles) {
        const hit = intersectSegmentAABB(
          fromNode.position,
          toNode.position,
          obstacle.bounds,
        );
        expect(
          hit.intersects,
          `Baseline edge ${edge.from}->${edge.to} hits ${obstacle.id}`,
        ).toBe(false);
      }

      for (const zone of expandedZones) {
        const hit = intersectSegmentAABB(
          fromNode.position,
          toNode.position,
          zone.bounds,
        );
        expect(
          hit.intersects,
          `Baseline edge ${edge.from}->${edge.to} enters ${zone.id}`,
        ).toBe(false);
      }
    }
  });

  it("deep-clones scenario snapshots without mutating the canonical fixture", () => {
    const snapshot = cloneScenarioSnapshot();
    snapshot.initialDrone.batteryPercent = 12;
    expect(FLOOD_SCENARIO.initialDrone.batteryPercent).toBe(96);
  });
});
