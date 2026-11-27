import { describe, expect, it } from "vitest";
import {
  FLOOD_SCENARIO,
  cloneScenarioSnapshot,
} from "../scenario/flood-scenario.js";
import {
  TEMP_START_NODE_ID,
  VersionedNavigationEngine,
  buildNavigationGraph,
  findShortestPath,
  resolveMissionRoute,
} from "./astar.js";

describe("3D navigation graph and A* search", () => {
  it("chooses the direct south corridor route from base to east shelter when clear", () => {
    const graph = buildNavigationGraph({
      environmentVersion: 1,
      worldBounds: FLOOD_SCENARIO.worldBounds,
      nodes: FLOOD_SCENARIO.nodes,
      edges: FLOOD_SCENARIO.edges,
      obstacles: FLOOD_SCENARIO.obstacles,
      noFlyZones: FLOOD_SCENARIO.noFlyZones,
      droneRadiusMeters: FLOOD_SCENARIO.initialDrone.radiusMeters,
      safetyClearanceMeters: FLOOD_SCENARIO.safetyClearanceMeters,
      maxAltitudeMeters: FLOOD_SCENARIO.defaultConstraints.maxAltitudeMeters,
    });

    const result = findShortestPath(graph, "N-BASE", "N-ROOF-02");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.nodeIds).toEqual([
      "N-BASE",
      "N-WEST-SOUTH",
      "N-SOUTH-WEST",
      "N-SOUTH-CORRIDOR",
      "N-EAST-SOUTH",
      "N-ROOF-02",
    ]);
  });

  it("reroutes via the northern corridor when crane-01 blocks the southern corridor", () => {
    const crane = FLOOD_SCENARIO.chaosObstaclePresets["crane-01"];
    expect(crane).toBeDefined();
    if (!crane) return;

    const graph = buildNavigationGraph({
      environmentVersion: 2,
      worldBounds: FLOOD_SCENARIO.worldBounds,
      nodes: FLOOD_SCENARIO.nodes,
      edges: FLOOD_SCENARIO.edges,
      obstacles: [...FLOOD_SCENARIO.obstacles, crane],
      noFlyZones: FLOOD_SCENARIO.noFlyZones,
      droneRadiusMeters: FLOOD_SCENARIO.initialDrone.radiusMeters,
      safetyClearanceMeters: FLOOD_SCENARIO.safetyClearanceMeters,
      maxAltitudeMeters: FLOOD_SCENARIO.defaultConstraints.maxAltitudeMeters,
    });

    const result = findShortestPath(graph, "N-BASE", "N-ROOF-02");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.nodeIds).not.toContain("N-SOUTH-CORRIDOR");
    expect(result.nodeIds).toContain("N-NORTH-CORRIDOR");
    expect(result.nodeIds[result.nodeIds.length - 1]).toBe("N-ROOF-02");
  });

  it("reports unreachable when all paths to a target are blocked", () => {
    const debris = FLOOD_SCENARIO.chaosObstaclePresets["debris-north-01"];
    expect(debris).toBeDefined();
    if (!debris) return;

    const graph = buildNavigationGraph({
      environmentVersion: 3,
      worldBounds: FLOOD_SCENARIO.worldBounds,
      nodes: FLOOD_SCENARIO.nodes,
      edges: FLOOD_SCENARIO.edges,
      obstacles: [...FLOOD_SCENARIO.obstacles, debris],
      noFlyZones: FLOOD_SCENARIO.noFlyZones,
      droneRadiusMeters: FLOOD_SCENARIO.initialDrone.radiusMeters,
      safetyClearanceMeters: FLOOD_SCENARIO.safetyClearanceMeters,
      maxAltitudeMeters: FLOOD_SCENARIO.defaultConstraints.maxAltitudeMeters,
    });

    const result = findShortestPath(graph, "N-BASE", "N-ROOF-03");
    expect(result).toEqual({
      ok: false,
      code: "UNREACHABLE",
      message: "No clear route from N-BASE to N-ROOF-03",
    });
  });

  it("rejects unknown start or goal node IDs", () => {
    const graph = buildNavigationGraph({
      environmentVersion: 1,
      nodes: FLOOD_SCENARIO.nodes,
      edges: FLOOD_SCENARIO.edges,
      obstacles: FLOOD_SCENARIO.obstacles,
      noFlyZones: FLOOD_SCENARIO.noFlyZones,
      droneRadiusMeters: 1.8,
      safetyClearanceMeters: 1.7,
      maxAltitudeMeters: 40,
    });

    const result = findShortestPath(graph, "N-BASE", "N-DOES-NOT-EXIST");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNKNOWN_NODE");
    }
  });

  it("terminates cleanly on a disconnected graph and breaks equal-cost ties deterministically", () => {
    const symmetricGraph = buildNavigationGraph({
      environmentVersion: 1,
      nodes: [
        { id: "S", label: "Start", position: { x: 0, y: 10, z: 0 }, kind: "base" },
        { id: "A", label: "Branch A", position: { x: 10, y: 10, z: 10 }, kind: "corridor" },
        { id: "B", label: "Branch B", position: { x: 10, y: 10, z: -10 }, kind: "corridor" },
        { id: "G", label: "Goal", position: { x: 20, y: 10, z: 0 }, kind: "target_approach" },
        { id: "ISLAND", label: "Disconnected", position: { x: 60, y: 10, z: 60 }, kind: "corridor" },
      ],
      edges: [
        { from: "S", to: "B", bidirectional: true },
        { from: "S", to: "A", bidirectional: true },
        { from: "B", to: "G", bidirectional: true },
        { from: "A", to: "G", bidirectional: true },
      ],
      obstacles: [],
      noFlyZones: [],
      droneRadiusMeters: 1,
      safetyClearanceMeters: 1,
      maxAltitudeMeters: 40,
    });

    const tieResult = findShortestPath(symmetricGraph, "S", "G");
    expect(tieResult.ok).toBe(true);
    if (tieResult.ok) {
      expect(tieResult.nodeIds).toEqual(["S", "A", "G"]);
    }

    const disconnected = findShortestPath(symmetricGraph, "S", "ISLAND");
    expect(disconnected.ok).toBe(false);
    if (!disconnected.ok) {
      expect(disconnected.code).toBe("UNREACHABLE");
    }
  });

  it("rejects negative edge risk costs", () => {
    expect(() =>
      buildNavigationGraph({
        environmentVersion: 1,
        nodes: [
          { id: "A", label: "A", position: { x: 0, y: 10, z: 0 }, kind: "base" },
          { id: "B", label: "B", position: { x: 5, y: 10, z: 0 }, kind: "corridor" },
        ],
        edges: [{ from: "A", to: "B", riskCost: -3 }],
        obstacles: [],
        noFlyZones: [],
        droneRadiusMeters: 1,
        safetyClearanceMeters: 1,
        maxAltitudeMeters: 40,
      }),
    ).toThrow(RangeError);
  });

  it("injects a temporary start node when replanning mid-flight between graph nodes and invalidates cached graph on version bump", () => {
    const scenario = cloneScenarioSnapshot();
    const engine = new VersionedNavigationEngine();

    // Mid-flight drone positioned between N-BASE (-56,16,48) and N-WEST-SOUTH (-26,22,28)
    const midFlightDrone = {
      ...scenario.initialDrone,
      position: { x: -41, y: 19, z: 38 },
    };

    const resV1 = resolveMissionRoute({
      routeId: "route-v1",
      environmentVersion: 1,
      scenario,
      obstacles: scenario.obstacles,
      targets: scenario.targets,
      drone: midFlightDrone,
      constraints: scenario.defaultConstraints,
      targetOrder: ["ROOF-02"],
      engine,
    });

    expect(resV1.ok).toBe(true);
    if (!resV1.ok) return;
    expect(resV1.route.nodeIds[0]).toBe(TEMP_START_NODE_ID);
    expect(resV1.route.waypoints[0]).toEqual({ x: -41, y: 19, z: 38 });
    expect(resV1.route.nodeIds).toContain("N-SOUTH-CORRIDOR");

    // Spawn crane-01 on environmentVersion 2 -> cached v1 graph must not be reused
    const crane = scenario.chaosObstaclePresets["crane-01"]!;
    const resV2 = resolveMissionRoute({
      routeId: "route-v2",
      environmentVersion: 2,
      scenario,
      obstacles: [...scenario.obstacles, crane],
      targets: scenario.targets,
      drone: midFlightDrone,
      constraints: scenario.defaultConstraints,
      targetOrder: ["ROOF-02"],
      engine,
    });

    expect(resV2.ok).toBe(true);
    if (!resV2.ok) return;
    expect(resV2.route.nodeIds).not.toContain("N-SOUTH-CORRIDOR");
    expect(resV2.route.nodeIds).toContain("N-NORTH-CORRIDOR");
  });
});
