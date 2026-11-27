import type {
  DroneState,
  MissionConstraints,
  NavigationEdge,
  NavigationNode,
  NoFlyZone,
  ResolvedRoute,
  ScenarioDefinition,
  ScenarioObstacle,
  Vector3,
} from "../index.js";
import { containsPoint, expandAABB } from "../geometry/aabb.js";
import { intersectSegmentAABB } from "../geometry/segment-aabb.js";
import { distance, equals, isFiniteVector3 } from "../math/vector3.js";

export const TEMP_START_NODE_ID = "__TEMP_DRONE_START__";

export type AdjacencyEntry = {
  to: string;
  cost: number;
  distanceMeters: number;
};

export type CompiledNavigationGraph = {
  environmentVersion: number;
  nodesById: Map<string, NavigationNode>;
  adjacency: Map<string, AdjacencyEntry[]>;
};

export type PathSearchResult =
  | {
      ok: true;
      nodeIds: string[];
      waypoints: Vector3[];
      cost: number;
      distanceMeters: number;
    }
  | {
      ok: false;
      code: "UNKNOWN_NODE" | "UNREACHABLE" | "INVALID_GRAPH";
      message: string;
    };

export type RouteResolutionResult =
  | {
      ok: true;
      route: ResolvedRoute;
    }
  | {
      ok: false;
      code: "UNKNOWN_TARGET" | "UNKNOWN_NODE" | "UNREACHABLE" | "INVALID_GRAPH";
      message: string;
      unreachableTargetId?: string | undefined;
    };

export type GraphBuildOptions = {
  environmentVersion: number;
  worldBounds?: ScenarioDefinition["worldBounds"] | undefined;
  nodes: NavigationNode[];
  edges: NavigationEdge[];
  obstacles: ScenarioObstacle[];
  noFlyZones: NoFlyZone[];
  droneRadiusMeters: number;
  safetyClearanceMeters: number;
  maxAltitudeMeters: number;
  climbPenaltyPerMeter?: number | undefined;
};

export function isSegmentClearForNavigation(
  start: Vector3,
  end: Vector3,
  options: {
    worldBounds?: ScenarioDefinition["worldBounds"] | undefined;
    expandedObstacles: ReturnType<typeof expandAABB>[];
    expandedNoFlyZones: ReturnType<typeof expandAABB>[];
    maxAltitudeMeters: number;
  },
): boolean {
  if (!isFiniteVector3(start) || !isFiniteVector3(end)) {
    return false;
  }
  if (
    start.y < 0 ||
    end.y < 0 ||
    start.y > options.maxAltitudeMeters ||
    end.y > options.maxAltitudeMeters
  ) {
    return false;
  }
  if (options.worldBounds) {
    if (
      !containsPoint(options.worldBounds, start, true) ||
      !containsPoint(options.worldBounds, end, true)
    ) {
      return false;
    }
  }

  for (const box of options.expandedObstacles) {
    if (intersectSegmentAABB(start, end, box).intersects) {
      return false;
    }
  }

  for (const zone of options.expandedNoFlyZones) {
    if (intersectSegmentAABB(start, end, zone).intersects) {
      return false;
    }
  }

  return true;
}

export function buildNavigationGraph(
  options: GraphBuildOptions,
): CompiledNavigationGraph {
  const climbWeight = options.climbPenaltyPerMeter ?? 0.2;
  if (!Number.isFinite(climbWeight) || climbWeight < 0) {
    throw new RangeError("climbPenaltyPerMeter must be finite and non-negative");
  }
  if (
    !Number.isFinite(options.droneRadiusMeters) ||
    options.droneRadiusMeters < 0 ||
    !Number.isFinite(options.safetyClearanceMeters) ||
    options.safetyClearanceMeters < 0
  ) {
    throw new RangeError("Drone radius and safety clearance must be non-negative");
  }

  const obstacleMargin =
    options.droneRadiusMeters + options.safetyClearanceMeters;
  const expandedObstacles = options.obstacles.map((obstacle) =>
    expandAABB(obstacle.bounds, obstacleMargin),
  );
  const expandedNoFlyZones = options.noFlyZones.map((zone) =>
    expandAABB(zone.bounds, options.droneRadiusMeters),
  );

  const nodesById = new Map<string, NavigationNode>();
  const adjacency = new Map<string, AdjacencyEntry[]>();

  for (const node of options.nodes) {
    if (!isFiniteVector3(node.position)) {
      throw new TypeError(`Node ${node.id} has non-finite coordinates`);
    }
    nodesById.set(node.id, node);
    adjacency.set(node.id, []);
  }

  const addDirectedEdge = (
    fromNode: NavigationNode,
    toNode: NavigationNode,
    riskCost: number,
  ) => {
    if (!Number.isFinite(riskCost) || riskCost < 0) {
      throw new RangeError(
        `Edge ${fromNode.id}->${toNode.id} must have a non-negative finite riskCost`,
      );
    }

    const clear = isSegmentClearForNavigation(
      fromNode.position,
      toNode.position,
      {
        worldBounds: options.worldBounds,
        expandedObstacles,
        expandedNoFlyZones,
        maxAltitudeMeters: options.maxAltitudeMeters,
      },
    );
    if (!clear) return;

    const segDistance = distance(fromNode.position, toNode.position);
    const climbMeters = Math.max(0, toNode.position.y - fromNode.position.y);
    const cost = segDistance + climbMeters * climbWeight + riskCost;

    const list = adjacency.get(fromNode.id);
    if (list) {
      list.push({
        to: toNode.id,
        cost,
        distanceMeters: segDistance,
      });
    }
  };

  for (const edge of options.edges) {
    const fromNode = nodesById.get(edge.from);
    const toNode = nodesById.get(edge.to);
    if (!fromNode || !toNode) {
      throw new RangeError(
        `Edge references unknown node: ${edge.from} -> ${edge.to}`,
      );
    }
    const riskCost = edge.riskCost ?? 0;
    addDirectedEdge(fromNode, toNode, riskCost);
    if (edge.bidirectional !== false) {
      addDirectedEdge(toNode, fromNode, riskCost);
    }
  }

  // Sort adjacency deterministically by target ID so equal-cost ties resolve predictably.
  for (const entries of adjacency.values()) {
    entries.sort((a, b) => a.to.localeCompare(b.to));
  }

  return {
    environmentVersion: options.environmentVersion,
    nodesById,
    adjacency,
  };
}

/**
 * Injects a temporary start node at `startPosition` when the drone is mid-flight
 * between canonical graph nodes, connecting clear straight-line edges to reachable nodes.
 */
export function attachTemporaryStartNode(
  baseOptions: GraphBuildOptions,
  graph: CompiledNavigationGraph,
  startPosition: Vector3,
): { graph: CompiledNavigationGraph; startNodeId: string } {
  for (const node of graph.nodesById.values()) {
    if (equals(node.position, startPosition, 1e-3)) {
      return { graph, startNodeId: node.id };
    }
  }

  const climbWeight = baseOptions.climbPenaltyPerMeter ?? 0.2;
  const obstacleMargin =
    baseOptions.droneRadiusMeters + baseOptions.safetyClearanceMeters;
  const expandedObstacles = baseOptions.obstacles.map((obstacle) =>
    expandAABB(obstacle.bounds, obstacleMargin),
  );
  const expandedNoFlyZones = baseOptions.noFlyZones.map((zone) =>
    expandAABB(zone.bounds, baseOptions.droneRadiusMeters),
  );

  const nodesById = new Map(graph.nodesById);
  const adjacency = new Map<string, AdjacencyEntry[]>();
  for (const [id, list] of graph.adjacency.entries()) {
    adjacency.set(id, [...list]);
  }

  const tempNode: NavigationNode = {
    id: TEMP_START_NODE_ID,
    label: "Live Drone Position",
    position: { ...startPosition },
    kind: "corridor",
  };
  nodesById.set(TEMP_START_NODE_ID, tempNode);

  const tempEdges: AdjacencyEntry[] = [];
  for (const candidate of graph.nodesById.values()) {
    const clear = isSegmentClearForNavigation(startPosition, candidate.position, {
      worldBounds: baseOptions.worldBounds,
      expandedObstacles,
      expandedNoFlyZones,
      maxAltitudeMeters: baseOptions.maxAltitudeMeters,
    });
    if (!clear) continue;

    const segDistance = distance(startPosition, candidate.position);
    const climbMeters = Math.max(0, candidate.position.y - startPosition.y);
    tempEdges.push({
      to: candidate.id,
      cost: segDistance + climbMeters * climbWeight,
      distanceMeters: segDistance,
    });
  }

  tempEdges.sort((a, b) => a.to.localeCompare(b.to));
  adjacency.set(TEMP_START_NODE_ID, tempEdges);

  return {
    graph: {
      environmentVersion: graph.environmentVersion,
      nodesById,
      adjacency,
    },
    startNodeId: TEMP_START_NODE_ID,
  };
}

/**
 * Deterministic A* search with admissible Euclidean 3D heuristic and
 * lexicographical path tie-breaking.
 */
export function findShortestPath(
  graph: CompiledNavigationGraph,
  startId: string,
  goalId: string,
): PathSearchResult {
  const startNode = graph.nodesById.get(startId);
  const goalNode = graph.nodesById.get(goalId);
  if (!startNode || !goalNode) {
    return {
      ok: false,
      code: "UNKNOWN_NODE",
      message: `Unknown start (${startId}) or goal (${goalId}) node`,
    };
  }

  if (startId === goalId) {
    return {
      ok: true,
      nodeIds: [startId],
      waypoints: [{ ...startNode.position }],
      cost: 0,
      distanceMeters: 0,
    };
  }

  type OpenState = {
    nodeId: string;
    g: number;
    f: number;
    distanceMeters: number;
    path: string[];
    pathKey: string;
  };

  const open: OpenState[] = [
    {
      nodeId: startId,
      g: 0,
      f: distance(startNode.position, goalNode.position),
      distanceMeters: 0,
      path: [startId],
      pathKey: startId,
    },
  ];

  const bestCostByNode = new Map<string, { g: number; pathKey: string }>();
  bestCostByNode.set(startId, { g: 0, pathKey: startId });

  const compareStates = (a: OpenState, b: OpenState): number => {
    const fDiff = a.f - b.f;
    if (Math.abs(fDiff) > 1e-9) return fDiff;
    const gDiff = a.g - b.g;
    if (Math.abs(gDiff) > 1e-9) return gDiff;
    return a.pathKey.localeCompare(b.pathKey);
  };

  while (open.length > 0) {
    open.sort(compareStates);
    const current = open.shift();
    if (!current) break;

    if (current.nodeId === goalId) {
      const waypoints = current.path.map((id) => {
        const node = graph.nodesById.get(id);
        if (!node) {
          throw new Error(`Resolved path references missing node ${id}`);
        }
        return { ...node.position };
      });
      return {
        ok: true,
        nodeIds: current.path,
        waypoints,
        cost: current.g,
        distanceMeters: current.distanceMeters,
      };
    }

    const bestRecorded = bestCostByNode.get(current.nodeId);
    if (
      bestRecorded &&
      (current.g > bestRecorded.g + 1e-9 ||
        (Math.abs(current.g - bestRecorded.g) <= 1e-9 &&
          current.pathKey.localeCompare(bestRecorded.pathKey) > 0))
    ) {
      continue;
    }

    const neighbors = graph.adjacency.get(current.nodeId) ?? [];
    for (const edge of neighbors) {
      const neighborNode = graph.nodesById.get(edge.to);
      if (!neighborNode) continue;

      const tentativeG = current.g + edge.cost;
      const nextPathKey = `${current.pathKey}>${edge.to}`;
      const existing = bestCostByNode.get(edge.to);

      const isBetter =
        !existing ||
        tentativeG < existing.g - 1e-9 ||
        (Math.abs(tentativeG - existing.g) <= 1e-9 &&
          nextPathKey.localeCompare(existing.pathKey) < 0);

      if (!isBetter) continue;

      bestCostByNode.set(edge.to, { g: tentativeG, pathKey: nextPathKey });
      const h = distance(neighborNode.position, goalNode.position);
      open.push({
        nodeId: edge.to,
        g: tentativeG,
        f: tentativeG + h,
        distanceMeters: current.distanceMeters + edge.distanceMeters,
        path: [...current.path, edge.to],
        pathKey: nextPathKey,
      });
    }
  }

  return {
    ok: false,
    code: "UNREACHABLE",
    message: `No clear route from ${startId} to ${goalId}`,
  };
}

/**
 * Caching wrapper keyed by `environmentVersion` so environment mutations
 * automatically invalidate stale graph edge eligibility.
 */
export class VersionedNavigationEngine {
  private cachedVersion: number | null = null;
  private cachedMaxAltitude: number | null = null;
  private cachedGraph: CompiledNavigationGraph | null = null;

  getGraph(options: GraphBuildOptions): CompiledNavigationGraph {
    if (
      this.cachedGraph &&
      this.cachedVersion === options.environmentVersion &&
      this.cachedMaxAltitude === options.maxAltitudeMeters
    ) {
      return this.cachedGraph;
    }

    const built = buildNavigationGraph(options);
    this.cachedVersion = options.environmentVersion;
    this.cachedMaxAltitude = options.maxAltitudeMeters;
    this.cachedGraph = built;
    return built;
  }

  invalidate(): void {
    this.cachedVersion = null;
    this.cachedMaxAltitude = null;
    this.cachedGraph = null;
  }
}

export function resolveMissionRoute(params: {
  routeId: string;
  environmentVersion: number;
  scenario: ScenarioDefinition;
  obstacles: ScenarioObstacle[];
  targets: ScenarioDefinition["targets"];
  drone: DroneState;
  constraints: MissionConstraints;
  targetOrder: string[];
  preferredNodeSequence?: string[] | undefined;
  useAdvisorySequence?: boolean | undefined;
  engine?: VersionedNavigationEngine | undefined;
}): RouteResolutionResult {
  const {
    routeId,
    environmentVersion,
    scenario,
    obstacles,
    targets,
    drone,
    constraints,
    targetOrder,
    preferredNodeSequence = [],
    useAdvisorySequence = true,
    engine,
  } = params;

  const graphOptions: GraphBuildOptions = {
    environmentVersion,
    worldBounds: scenario.worldBounds,
    nodes: scenario.nodes,
    edges: scenario.edges,
    obstacles,
    noFlyZones: scenario.noFlyZones,
    droneRadiusMeters: drone.radiusMeters,
    safetyClearanceMeters: scenario.safetyClearanceMeters,
    maxAltitudeMeters: constraints.maxAltitudeMeters,
  };

  let baseGraph: CompiledNavigationGraph;
  try {
    baseGraph = engine
      ? engine.getGraph(graphOptions)
      : buildNavigationGraph(graphOptions);
  } catch (error) {
    return {
      ok: false,
      code: "INVALID_GRAPH",
      message: error instanceof Error ? error.message : "Invalid navigation graph",
    };
  }

  for (const nodeId of preferredNodeSequence) {
    if (!baseGraph.nodesById.has(nodeId)) {
      return {
        ok: false,
        code: "UNKNOWN_NODE",
        message: `Preferred node sequence contains unknown node ID: ${nodeId}`,
      };
    }
  }

  const targetById = new Map(targets.map((target) => [target.id, target]));
  const orderedGoalNodes: { nodeId: string; targetId?: string | undefined }[] = [];

  for (const targetId of targetOrder) {
    const target = targetById.get(targetId);
    if (!target || target.status === "abandoned") {
      return {
        ok: false,
        code: "UNKNOWN_TARGET",
        message: `Unknown or unavailable target ID: ${targetId}`,
      };
    }
    orderedGoalNodes.push({ nodeId: target.nodeId, targetId: target.id });
  }

  const { graph, startNodeId } = attachTemporaryStartNode(
    graphOptions,
    baseGraph,
    drone.position,
  );

  // If no targets are requested (e.g. safe return to base), route back to homeBase.
  if (orderedGoalNodes.length === 0) {
    orderedGoalNodes.push({ nodeId: scenario.homeBase.nodeId });
  }

  const buildChain = (
    goals: { nodeId: string; targetId?: string | undefined }[],
  ): {
    ok: true;
    nodeIds: string[];
    waypoints: Vector3[];
    distanceMeters: number;
  } | {
    ok: false;
    code: "UNKNOWN_NODE" | "UNREACHABLE";
    message: string;
    unreachableTargetId?: string | undefined;
  } => {
    const allNodeIds: string[] = [startNodeId];
    const startNode = graph.nodesById.get(startNodeId);
    const allWaypoints: Vector3[] = startNode ? [{ ...startNode.position }] : [];
    let totalDistance = 0;
    let currentId = startNodeId;

    for (const goal of goals) {
      const leg = findShortestPath(graph, currentId, goal.nodeId);
      if (!leg.ok) {
        return {
          ok: false,
          code: leg.code === "UNKNOWN_NODE" ? "UNKNOWN_NODE" : "UNREACHABLE",
          message: leg.message,
          unreachableTargetId: goal.targetId,
        };
      }
      if (leg.nodeIds.length > 1) {
        allNodeIds.push(...leg.nodeIds.slice(1));
        allWaypoints.push(...leg.waypoints.slice(1));
      }
      totalDistance += leg.distanceMeters;
      currentId = goal.nodeId;
    }

    // Ensure polyline has at least 2 points even when drone is already at the only goal.
    if (allWaypoints.length === 1 && allWaypoints[0]) {
      allWaypoints.push({ ...allWaypoints[0] });
    }

    return {
      ok: true,
      nodeIds: allNodeIds,
      waypoints: allWaypoints,
      distanceMeters: totalDistance,
    };
  };

  // Optional advisory corridor hints before the first target: used only if valid, clear,
  // and within 35% of the direct shortest path; ignored automatically if blocked.
  let chosenChain = buildChain(orderedGoalNodes);

  if (
    chosenChain.ok &&
    useAdvisorySequence &&
    preferredNodeSequence.length > 0 &&
    orderedGoalNodes.length > 0
  ) {
    const targetNodeSet = new Set(orderedGoalNodes.map((g) => g.nodeId));
    const advisoryHints = preferredNodeSequence
      .filter(
        (id) =>
          id !== startNodeId &&
          id !== scenario.homeBase.nodeId &&
          !targetNodeSet.has(id),
      )
      .slice(0, 3)
      .map((nodeId) => ({ nodeId }));

    if (advisoryHints.length > 0) {
      const hintedChain = buildChain([...advisoryHints, ...orderedGoalNodes]);
      if (
        hintedChain.ok &&
        hintedChain.distanceMeters <= Math.max(chosenChain.distanceMeters * 1.35, chosenChain.distanceMeters + 25)
      ) {
        chosenChain = hintedChain;
      }
    }
  }

  if (!chosenChain.ok) {
    return chosenChain;
  }

  const finalNodeId =
    chosenChain.nodeIds[chosenChain.nodeIds.length - 1] ?? startNodeId;
  const rthLeg = findShortestPath(graph, finalNodeId, scenario.homeBase.nodeId);
  if (!rthLeg.ok) {
    return {
      ok: false,
      code: "UNREACHABLE",
      message: `Return-to-home route from ${finalNodeId} to ${scenario.homeBase.nodeId} is blocked`,
    };
  }

  const returnWaypoints =
    rthLeg.waypoints.length >= 2
      ? rthLeg.waypoints
      : rthLeg.waypoints[0]
        ? [{ ...rthLeg.waypoints[0] }, { ...rthLeg.waypoints[0] }]
        : [];

  return {
    ok: true,
    route: {
      routeId,
      nodeIds: chosenChain.nodeIds,
      waypoints: chosenChain.waypoints,
      returnNodeIds: rthLeg.nodeIds,
      returnWaypoints,
      targetIds: [...targetOrder],
      distanceMeters: chosenChain.distanceMeters,
      returnDistanceMeters: rthLeg.distanceMeters,
      environmentVersion,
    },
  };
}
