import type {
  AABB,
  DroneState,
  EnergyConfig,
  MissionConstraints,
  NavigationEdge,
  NavigationNode,
  NoFlyZone,
  RescueTarget,
  ScenarioObstacle,
  Vector3,
} from "../index.js";

export type HomeBaseSpec = {
  id: string;
  label: string;
  groundPosition: Vector3;
  hoverPosition: Vector3;
  nodeId: string;
};

export type ScenarioDefinition = {
  id: string;
  name: string;
  description: string;
  worldBounds: AABB;
  homeBase: HomeBaseSpec;
  initialDrone: DroneState;
  safetyClearanceMeters: number;
  windMetersPerSecond: number;
  defaultConstraints: MissionConstraints;
  energyConfig: EnergyConfig;
  obstacles: ScenarioObstacle[];
  noFlyZones: NoFlyZone[];
  targets: RescueTarget[];
  nodes: NavigationNode[];
  edges: NavigationEdge[];
  chaosObstaclePresets: Record<string, ScenarioObstacle>;
  discoverableTargetPresets: Record<string, RescueTarget>;
  previewRouteNodeIds: string[];
};

export function createBuildingBounds(
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  height: number,
): AABB {
  return {
    min: { x: centerX - width / 2, y: 0, z: centerZ - depth / 2 },
    max: { x: centerX + width / 2, y: height, z: centerZ + depth / 2 },
  };
}

export function getBoxDimensions(bounds: AABB): {
  center: Vector3;
  width: number;
  height: number;
  depth: number;
} {
  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;
  const depth = bounds.max.z - bounds.min.z;
  return {
    center: {
      x: bounds.min.x + width / 2,
      y: bounds.min.y + height / 2,
      z: bounds.min.z + depth / 2,
    },
    width,
    height,
    depth,
  };
}

export const VERIFIER_POLICY_VERSION = "mvp-v1.0";

export const FLOOD_SCENARIO: ScenarioDefinition = {
  id: "flood-block-a",
  name: "Urban Flood Zone — Block A",
  description:
    "Synthetic flooded urban district with seven multi-storey structures, a central downed-powerline geofence, rooftop rescue beacons, and bounded 3D air corridors.",
  worldBounds: {
    min: { x: -90, y: 0, z: -90 },
    max: { x: 90, y: 60, z: 90 },
  },
  homeBase: {
    id: "BASE-HOME",
    label: "West Rescue Helipad",
    groundPosition: { x: -56, y: 0, z: 48 },
    hoverPosition: { x: -56, y: 16, z: 48 },
    nodeId: "N-BASE",
  },
  initialDrone: {
    id: "AM-01",
    position: { x: -56, y: 16, z: 48 },
    batteryPercent: 96,
    altitudeMeters: 16,
    speedMetersPerSecond: 14,
    radiusMeters: 1.8,
  },
  safetyClearanceMeters: 1.7,
  windMetersPerSecond: 2.0,
  defaultConstraints: {
    maxAltitudeMeters: 40,
    minLandingReservePercent: 20,
  },
  energyConfig: {
    travelPercentPerMeter: 0.11,
    climbPercentPerMeter: 0.25,
    windFactorPerMeterPerSecond: 0.03,
    inspectionOperationPercent: 4.0,
  },
  obstacles: [
    {
      id: "BLDG-01",
      label: "West Medical Clinic",
      kind: "building",
      bounds: createBuildingBounds(-36, -28, 14, 14, 22),
      colorHex: 0x52677d,
    },
    {
      id: "BLDG-02",
      label: "Civic Administration Tower",
      kind: "building",
      bounds: createBuildingBounds(-6, -34, 14, 12, 32),
      colorHex: 0x60758a,
    },
    {
      id: "BLDG-03",
      label: "East Primary School",
      kind: "building",
      bounds: createBuildingBounds(24, -32, 14, 14, 18),
      colorHex: 0x50677a,
    },
    {
      id: "BLDG-04",
      label: "East Utility Hub",
      kind: "building",
      bounds: createBuildingBounds(40, -4, 12, 14, 24),
      colorHex: 0x61768a,
    },
    {
      id: "BLDG-05",
      label: "East Community Shelter",
      kind: "building",
      bounds: createBuildingBounds(22, 26, 16, 12, 22),
      colorHex: 0x546b80,
    },
    {
      id: "BLDG-06",
      label: "South Riverfront Apartments",
      kind: "building",
      bounds: createBuildingBounds(-10, 34, 14, 14, 26),
      colorHex: 0x64788b,
    },
    {
      id: "BLDG-07",
      label: "West Logistics Depot",
      kind: "building",
      bounds: createBuildingBounds(-40, 10, 12, 16, 19),
      colorHex: 0x53687d,
    },
  ],
  noFlyZones: [
    {
      id: "NFZ-01",
      label: "Downed HV Line & Transformer Arc Zone",
      bounds: {
        min: { x: -6, y: 0, z: -10 },
        max: { x: 10, y: 42, z: 8 },
      },
    },
  ],
  targets: [
    {
      id: "ROOF-01",
      label: "West Clinic Rooftop Triage",
      position: { x: -36, y: 28, z: -28 },
      rooftopElevationMeters: 22,
      buildingId: "BLDG-01",
      nodeId: "N-ROOF-01",
      sector: "west",
      priority: 2,
      status: "pending",
    },
    {
      id: "ROOF-02",
      label: "East Shelter Rooftop",
      position: { x: 22, y: 28, z: 26 },
      rooftopElevationMeters: 22,
      buildingId: "BLDG-05",
      nodeId: "N-ROOF-02",
      sector: "east",
      priority: 1,
      status: "pending",
    },
    {
      id: "ROOF-03",
      label: "East School Rooftop",
      position: { x: 24, y: 24, z: -32 },
      rooftopElevationMeters: 18,
      buildingId: "BLDG-03",
      nodeId: "N-ROOF-03",
      sector: "east",
      priority: 1,
      status: "pending",
    },
    {
      id: "ROOF-04",
      label: "South Apartments Rooftop",
      position: { x: -10, y: 32, z: 34 },
      rooftopElevationMeters: 26,
      buildingId: "BLDG-06",
      nodeId: "N-ROOF-04",
      sector: "south",
      priority: 3,
      status: "pending",
    },
  ],
  nodes: [
    {
      id: "N-BASE",
      label: "Helipad Launch Hover",
      position: { x: -56, y: 16, z: 48 },
      kind: "base",
    },
    {
      id: "N-WEST-SOUTH",
      label: "Southwest Approach",
      position: { x: -26, y: 22, z: 28 },
      kind: "corridor",
    },
    {
      id: "N-SOUTH-WEST",
      label: "South Corridor West Entry",
      position: { x: -24, y: 24, z: 14 },
      kind: "corridor",
    },
    {
      id: "N-SOUTH-CORRIDOR",
      label: "South Central Corridor",
      position: { x: 2, y: 30, z: 14 },
      kind: "corridor",
    },
    {
      id: "N-EAST-SOUTH",
      label: "Southeast Junction",
      position: { x: 22, y: 27, z: 14 },
      kind: "corridor",
    },
    {
      id: "N-EAST-MID",
      label: "East Avenue Midpoint",
      position: { x: 22, y: 27, z: 4 },
      kind: "corridor",
    },
    {
      id: "N-EAST-NORTH",
      label: "Northeast Junction",
      position: { x: 24, y: 25, z: -17 },
      kind: "corridor",
    },
    {
      id: "N-NORTH-CORRIDOR",
      label: "North Central Corridor",
      position: { x: 2, y: 26, z: -17 },
      kind: "corridor",
    },
    {
      id: "N-NORTH-WEST",
      label: "Northwest Junction",
      position: { x: -22, y: 27, z: -17 },
      kind: "corridor",
    },
    {
      id: "N-WEST-MID",
      label: "West Avenue Midpoint",
      position: { x: -22, y: 24, z: -8 },
      kind: "corridor",
    },
    {
      id: "N-WEST-GATE",
      label: "Far West Bypass",
      position: { x: -56, y: 27, z: -8 },
      kind: "corridor",
    },
    {
      id: "N-ROOF-01",
      label: "West Clinic Hover",
      position: { x: -36, y: 28, z: -28 },
      kind: "target_approach",
    },
    {
      id: "N-ROOF-02",
      label: "East Shelter Hover",
      position: { x: 22, y: 28, z: 26 },
      kind: "target_approach",
    },
    {
      id: "N-ROOF-03",
      label: "East School Hover",
      position: { x: 24, y: 24, z: -32 },
      kind: "target_approach",
    },
    {
      id: "N-ROOF-04",
      label: "South Apartments Hover",
      position: { x: -10, y: 32, z: 34 },
      kind: "target_approach",
    },
    {
      id: "N-ROOF-05",
      label: "East Utility Hub Hover",
      position: { x: 40, y: 30, z: -4 },
      kind: "target_approach",
    },
  ],
  edges: [
    { from: "N-BASE", to: "N-WEST-SOUTH", bidirectional: true },
    { from: "N-BASE", to: "N-WEST-GATE", bidirectional: true },
    { from: "N-WEST-SOUTH", to: "N-SOUTH-WEST", bidirectional: true },
    { from: "N-SOUTH-WEST", to: "N-SOUTH-CORRIDOR", bidirectional: true },
    { from: "N-SOUTH-CORRIDOR", to: "N-EAST-SOUTH", bidirectional: true },
    { from: "N-EAST-SOUTH", to: "N-EAST-MID", bidirectional: true },
    { from: "N-EAST-MID", to: "N-EAST-NORTH", bidirectional: true },
    { from: "N-EAST-NORTH", to: "N-NORTH-CORRIDOR", bidirectional: true },
    { from: "N-NORTH-CORRIDOR", to: "N-NORTH-WEST", bidirectional: true },
    { from: "N-NORTH-WEST", to: "N-WEST-MID", bidirectional: true },
    { from: "N-WEST-MID", to: "N-SOUTH-WEST", bidirectional: true },
    { from: "N-WEST-GATE", to: "N-WEST-MID", bidirectional: true },
    // Target approaches
    { from: "N-NORTH-WEST", to: "N-ROOF-01", bidirectional: true },
    { from: "N-EAST-SOUTH", to: "N-ROOF-02", bidirectional: true },
    { from: "N-EAST-NORTH", to: "N-ROOF-03", bidirectional: true },
    { from: "N-SOUTH-CORRIDOR", to: "N-ROOF-04", bidirectional: true },
    { from: "N-EAST-MID", to: "N-ROOF-05", bidirectional: true },
  ],
  chaosObstaclePresets: {
    "crane-01": {
      id: "crane-01",
      label: "Collapsed Emergency Crane",
      kind: "dynamic_hazard",
      bounds: {
        min: { x: -14, y: 0, z: 11 },
        max: { x: -8, y: 36, z: 17 },
      },
      colorHex: 0xe66b4b,
    },
    "debris-north-01": {
      id: "debris-north-01",
      label: "East School Smoke & Debris Plume",
      kind: "dynamic_hazard",
      bounds: {
        min: { x: 18, y: 0, z: -26 },
        max: { x: 30, y: 38, z: -20 },
      },
      colorHex: 0xd94f5c,
    },
  },
  discoverableTargetPresets: {
    "ROOF-05": {
      id: "ROOF-05",
      label: "East Utility Hub Urgent Flare",
      position: { x: 40, y: 30, z: -4 },
      rooftopElevationMeters: 24,
      buildingId: "BLDG-04",
      nodeId: "N-ROOF-05",
      sector: "east",
      priority: 1,
      status: "pending",
    },
  },
  previewRouteNodeIds: [
    "N-BASE",
    "N-WEST-SOUTH",
    "N-SOUTH-WEST",
    "N-SOUTH-CORRIDOR",
    "N-EAST-SOUTH",
    "N-ROOF-02",
  ],
};

const SCENARIO_REGISTRY: Record<string, ScenarioDefinition> = {
  [FLOOD_SCENARIO.id]: FLOOD_SCENARIO,
  "flood-block-01": FLOOD_SCENARIO,
};

export function getScenarioDefinition(scenarioId: string): ScenarioDefinition | null {
  const found = SCENARIO_REGISTRY[scenarioId.toLowerCase()];
  return found ?? null;
}

export function cloneScenarioSnapshot(
  definition: ScenarioDefinition = FLOOD_SCENARIO,
): ScenarioDefinition {
  return structuredClone(definition);
}

export function resolvePreviewWaypoints(
  scenario: ScenarioDefinition = FLOOD_SCENARIO,
): Vector3[] {
  const byId = new Map(scenario.nodes.map((node) => [node.id, node.position]));
  const waypoints: Vector3[] = [];
  for (const nodeId of scenario.previewRouteNodeIds) {
    const position = byId.get(nodeId);
    if (position) {
      waypoints.push({ ...position });
    }
  }
  return waypoints;
}
