import { describe, expect, it } from "vitest";
import {
  FLOOD_SCENARIO,
  distance,
  equals,
  lerp,
  type MissionPlan,
} from "@aeromind/shared";
import { AppHttpError } from "../errors.js";
import type {
  MissionPlanner,
  PlannerOutput,
  PlannerRequestContext,
} from "../planner/gemini-planner.js";
import { MissionOrchestrator } from "./mission-orchestrator.js";
import { deriveRemainingMissionRoute } from "./remaining-route.js";

class DeterministicTestPlanner implements MissionPlanner {
  readonly providerName = "deterministic-test-planner";
  readonly isConfigured = true;
  readonly modelName = "test-planner-v1";
  public callCount = 0;

  constructor(
    private readonly respond: (
      ctx: PlannerRequestContext,
      callIndex: number,
    ) => MissionPlan,
  ) {}

  async proposeMissionPlan(
    context: PlannerRequestContext,
  ): Promise<PlannerOutput> {
    const idx = this.callCount;
    this.callCount += 1;
    return {
      rawOutput: this.respond(context, idx),
      modelName: this.modelName,
      latencyMs: 2,
    };
  }
}

const singleTargetPlan = (targetId = "ROOF-02"): MissionPlan => ({
  missionStatus: "planned",
  targetOrder: [targetId],
  searchPattern: "direct_inspection",
  preferredNodeSequence: [],
  abortedObjectives: [],
  decisionSummary: `Direct inspection of ${targetId}.`,
});

describe("Remaining-route derivation & recovery correctness (10 mandatory regression cases)", () => {
  it("1. Environment change while READY before execution preserves complete outbound and RTH paths", async () => {
    const planner = new DeterministicTestPlanner(() =>
      singleTargetPlan("ROOF-02"),
    );
    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    const initial = await orchestrator.planMission({
      missionId: "reg-01-ready",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Inspect ROOF-02.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });

    const originalWaypoints = initial.route!.waypoints;
    const originalReturnWaypoints = initial.route!.returnWaypoints;
    expect(originalWaypoints.length).toBe(6);
    expect(originalReturnWaypoints.length).toBe(6);
    const oldApprovalId = initial.approval!.approvalId;

    // Slight battery change while still READY (flight has NOT started)
    const afterEvent = await orchestrator.applyEnvironmentEvent({
      missionId: "reg-01-ready",
      expectedEnvironmentVersion: 1,
      event: { type: "battery.changed", batteryPercent: 88 },
    });

    expect(planner.callCount).toBe(1);
    expect(afterEvent.status).toBe("ready");
    expect(afterEvent.lastReplanOutcome).toBe("unchanged_valid");
    expect(afterEvent.route!.waypoints).toEqual(originalWaypoints);
    expect(afterEvent.route!.returnWaypoints).toEqual(originalReturnWaypoints);
    expect(afterEvent.route!.targetIds).toEqual(["ROOF-02"]);
    expect(afterEvent.verification!.approved).toBe(true);
    expect(afterEvent.verification!.energy.missionOperationPercent).toBe(
      FLOOD_SCENARIO.energyConfig.inspectionOperationPercent,
    );
    expect(afterEvent.approval?.environmentVersion).toBe(2);
    expect(afterEvent.approval?.approvalId).not.toBe(oldApprovalId);
  });

  it("2. Obstacle appearing during outbound leg excludes already-visited targets and reroutes from live drone position", async () => {
    const planner = new DeterministicTestPlanner((): MissionPlan => ({
      missionStatus: "planned",
      targetOrder: ["ROOF-04", "ROOF-02"],
      searchPattern: "direct_inspection",
      preferredNodeSequence: [],
      abortedObjectives: [],
      decisionSummary: "Inspect ROOF-04 then ROOF-02.",
    }));
    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    const initial = await orchestrator.planMission({
      missionId: "reg-02-outbound",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Inspect South Apartments then East Shelter.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });

    await orchestrator.authorizeExecution({
      missionId: "reg-02-outbound",
      routeId: initial.route!.routeId,
      approvalId: initial.approval!.approvalId,
      expectedEnvironmentVersion: 1,
    });

    // Step until ROOF-04 is visited, but ROOF-02 is still pending
    let snap = orchestrator.getMissionSnapshot("reg-02-outbound");
    for (let i = 0; i < 40; i += 1) {
      snap = orchestrator.advanceSimulation("reg-02-outbound", 0.5);
      const roof04 = snap.targets.find((t) => t.id === "ROOF-04");
      const roof02 = snap.targets.find((t) => t.id === "ROOF-02");
      if (roof04?.status === "visited" && roof02?.status === "pending") {
        break;
      }
    }
    expect(snap.targets.find((t) => t.id === "ROOF-04")?.status).toBe("visited");
    expect(snap.targets.find((t) => t.id === "ROOF-02")?.status).toBe("pending");
    const livePos = { ...snap.drone.position };

    // Spawn an obstacle right between N-SOUTH-CORRIDOR (2,30,14) and N-EAST-SOUTH (22,27,14)
    const afterObstacle = await orchestrator.applyEnvironmentEvent({
      missionId: "reg-02-outbound",
      expectedEnvironmentVersion: 1,
      event: {
        type: "obstacle.spawned",
        obstacleId: "east-south-block",
        obstacle: {
          id: "east-south-block",
          label: "South-East Crane Boom",
          kind: "dynamic_hazard",
          bounds: {
            min: { x: 11, y: 0, z: 11 },
            max: { x: 15, y: 38, z: 17 },
          },
          colorHex: 0xe66b4b,
        },
      },
    });

    expect(planner.callCount).toBe(1); // Zero extra Gemini calls
    expect(afterObstacle.status).toBe("ready");
    expect(afterObstacle.lastReplanOutcome).toBe("local_astar");
    // Only still-pending ROOF-02 remains; ROOF-04 is not re-charged
    expect(afterObstacle.route!.targetIds).toEqual(["ROOF-02"]);
    expect(afterObstacle.route!.waypoints[0]).toEqual(livePos);
    expect(afterObstacle.verification!.energy.missionOperationPercent).toBe(
      FLOOD_SCENARIO.energyConfig.inspectionOperationPercent,
    );
    expect(afterObstacle.approval).not.toBeNull();
  });

  it("3. Obstacle appearing during return-to-home reroutes to base without reintroducing visited targets", async () => {
    const planner = new DeterministicTestPlanner(() =>
      singleTargetPlan("ROOF-02"),
    );
    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    const initial = await orchestrator.planMission({
      missionId: "reg-03-rth",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Inspect East Shelter.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });

    await orchestrator.authorizeExecution({
      missionId: "reg-03-rth",
      routeId: initial.route!.routeId,
      approvalId: initial.approval!.approvalId,
      expectedEnvironmentVersion: 1,
    });

    // Advance until ROOF-02 is visited and drone is actively on the return leg
    let snap = orchestrator.getMissionSnapshot("reg-03-rth");
    for (let i = 0; i < 40; i += 1) {
      snap = orchestrator.advanceSimulation("reg-03-rth", 0.5);
      if (snap.activeLeg === "return") {
        // Step one more half-second into the return path
        snap = orchestrator.advanceSimulation("reg-03-rth", 0.5);
        break;
      }
    }
    expect(snap.activeLeg).toBe("return");
    expect(snap.targets.find((t) => t.id === "ROOF-02")?.status).toBe("visited");
    const rthDronePos = { ...snap.drone.position };

    // Spawn crane-01 blocking the southern RTH corridor ahead of the drone
    const recovered = await orchestrator.applyEnvironmentEvent({
      missionId: "reg-03-rth",
      expectedEnvironmentVersion: 1,
      event: { type: "obstacle.spawned", obstacleId: "crane-01" },
    });

    expect(planner.callCount).toBe(1); // Zero extra Gemini calls
    expect(recovered.status).toBe("ready");
    expect(recovered.activeLeg).toBe("return");
    expect(recovered.lastReplanOutcome).toBe("local_astar");
    expect(recovered.route!.targetIds).toEqual([]);
    expect(recovered.route!.waypoints).toEqual([rthDronePos]);
    expect(recovered.route!.distanceMeters).toBe(0);
    expect(recovered.route!.returnWaypoints[0]).toEqual(rthDronePos);
    expect(
      recovered.route!.returnWaypoints[
        recovered.route!.returnWaypoints.length - 1
      ],
    ).toEqual(FLOOD_SCENARIO.homeBase.hoverPosition);
    expect(recovered.route!.returnNodeIds).toContain("N-NORTH-CORRIDOR");
    expect(recovered.verification!.estimatedMissionEnergyPercent).toBe(0);
    expect(recovered.verification!.estimatedReturnEnergyPercent).toBeGreaterThan(0);

    // Authorize RTH approval and fly home to completion
    await orchestrator.authorizeExecution({
      missionId: "reg-03-rth",
      routeId: recovered.route!.routeId,
      approvalId: recovered.approval!.approvalId,
      expectedEnvironmentVersion: 2,
    });
    const completed = orchestrator.advanceSimulation("reg-03-rth", 40);
    expect(completed.status).toBe("completed");
    expect(
      equals(
        completed.drone.position,
        FLOOD_SCENARIO.homeBase.hoverPosition,
        1e-3,
      ),
    ).toBe(true);
  });

  it("4. Battery change while PAUSED preserves live segment progress and reverifies accurately", async () => {
    const planner = new DeterministicTestPlanner(() =>
      singleTargetPlan("ROOF-02"),
    );
    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    const initial = await orchestrator.planMission({
      missionId: "reg-04-paused-bat",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Inspect East Shelter.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });

    await orchestrator.authorizeExecution({
      missionId: "reg-04-paused-bat",
      routeId: initial.route!.routeId,
      approvalId: initial.approval!.approvalId,
      expectedEnvironmentVersion: 1,
    });

    const midFlight = orchestrator.advanceSimulation("reg-04-paused-bat", 1.5);
    const pausedPos = { ...midFlight.drone.position };

    // First event pauses execution WITHOUT auto-replan
    const paused = await orchestrator.applyEnvironmentEvent({
      missionId: "reg-04-paused-bat",
      expectedEnvironmentVersion: 1,
      event: { type: "wind.changed", windMetersPerSecond: 2.5 },
      autoReplan: false,
    });
    expect(paused.status).toBe("paused");
    expect(paused.approval?.revokedAt).toBeDefined();

    // Second event mutates battery while PAUSED with autoReplan=true
    const reverified = await orchestrator.applyEnvironmentEvent({
      missionId: "reg-04-paused-bat",
      expectedEnvironmentVersion: 2,
      event: { type: "battery.changed", batteryPercent: 80 },
      autoReplan: true,
    });

    expect(reverified.status).toBe("ready");
    expect(reverified.environmentVersion).toBe(3);
    expect(reverified.route!.waypoints[0]).toEqual(pausedPos);
    expect(reverified.route!.waypoints.slice(1)).toEqual(
      initial.route!.waypoints.slice(1),
    );
    expect(reverified.approval?.environmentVersion).toBe(3);
  });

  it("5. Drone paused halfway along a route segment starts remaining waypoints at exact 3D midpoint", async () => {
    const planner = new DeterministicTestPlanner(() =>
      singleTargetPlan("ROOF-02"),
    );
    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    const initial = await orchestrator.planMission({
      missionId: "reg-05-midpoint",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Inspect East Shelter.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });

    const wp0 = initial.route!.waypoints[0]!;
    const wp1 = initial.route!.waypoints[1]!;
    const seg0Len = distance(wp0, wp1);
    const halfSegSeconds =
      (seg0Len * 0.5) / FLOOD_SCENARIO.initialDrone.speedMetersPerSecond;
    const expectedMidpoint = lerp(wp0, wp1, 0.5);

    await orchestrator.authorizeExecution({
      missionId: "reg-05-midpoint",
      routeId: initial.route!.routeId,
      approvalId: initial.approval!.approvalId,
      expectedEnvironmentVersion: 1,
    });

    orchestrator.advanceSimulation("reg-05-midpoint", halfSegSeconds);

    const updated = await orchestrator.applyEnvironmentEvent({
      missionId: "reg-05-midpoint",
      expectedEnvironmentVersion: 1,
      event: { type: "wind.changed", windMetersPerSecond: 1.5 },
    });

    expect(updated.status).toBe("ready");
    expect(equals(updated.route!.waypoints[0]!, expectedMidpoint, 1e-4)).toBe(
      true,
    );
    expect(updated.route!.waypoints.slice(1)).toEqual(
      initial.route!.waypoints.slice(1),
    );
  });

  it("6. Drone positioned exactly at an intermediate waypoint produces no zero-length duplicate segment", async () => {
    const planner = new DeterministicTestPlanner(() =>
      singleTargetPlan("ROOF-02"),
    );
    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    const initial = await orchestrator.planMission({
      missionId: "reg-06-exact-wp",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Inspect East Shelter.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });

    const wp0 = initial.route!.waypoints[0]!;
    const wp1 = initial.route!.waypoints[1]!;
    const exactSeg0Seconds =
      distance(wp0, wp1) / FLOOD_SCENARIO.initialDrone.speedMetersPerSecond;

    await orchestrator.authorizeExecution({
      missionId: "reg-06-exact-wp",
      routeId: initial.route!.routeId,
      approvalId: initial.approval!.approvalId,
      expectedEnvironmentVersion: 1,
    });

    orchestrator.advanceSimulation("reg-06-exact-wp", exactSeg0Seconds);

    const updated = await orchestrator.applyEnvironmentEvent({
      missionId: "reg-06-exact-wp",
      expectedEnvironmentVersion: 1,
      event: { type: "wind.changed", windMetersPerSecond: 1.0 },
    });

    expect(updated.status).toBe("ready");
    expect(equals(updated.route!.waypoints[0]!, wp1, 1e-4)).toBe(true);
    expect(equals(updated.route!.waypoints[1]!, initial.route!.waypoints[2]!, 1e-4)).toBe(
      true,
    );
    expect(updated.route!.waypoints.length).toBe(
      initial.route!.waypoints.length - 1,
    );
  });

  it("7. All outbound targets already visited yields 0 target count, 0 outbound energy, and RTH-only verification", () => {
    const visitedTargets = FLOOD_SCENARIO.targets.map((t) =>
      t.id === "ROOF-02" ? { ...t, status: "visited" as const } : { ...t },
    );
    const roof02Pos = FLOOD_SCENARIO.targets.find(
      (t) => t.id === "ROOF-02",
    )!.position;

    const derived = deriveRemainingMissionRoute({
      drone: { ...FLOOD_SCENARIO.initialDrone, position: { ...roof02Pos } },
      scenario: FLOOD_SCENARIO,
      targets: visitedTargets,
      plan: singleTargetPlan("ROOF-02"),
      route: {
        routeId: "r-1",
        nodeIds: ["N-BASE", "N-ROOF-02"],
        waypoints: [FLOOD_SCENARIO.homeBase.hoverPosition, roof02Pos],
        returnNodeIds: ["N-ROOF-02", "N-EAST-SOUTH", "N-BASE"],
        returnWaypoints: [
          roof02Pos,
          { x: 22, y: 27, z: 14 },
          FLOOD_SCENARIO.homeBase.hoverPosition,
        ],
        targetIds: ["ROOF-02"],
        distanceMeters: 100,
        returnDistanceMeters: 100,
        environmentVersion: 1,
      },
      executedRoute: null,
      flightProgress: {
        leg: "outbound",
        segmentIndex: 1,
        segmentOffsetMeters: 0,
        headingRad: 0,
      },
    });

    expect(derived.leg).toBe("return");
    expect(derived.remainingTargetIds).toEqual([]);
    expect(derived.inspectedTargetCount).toBe(0);
    expect(derived.outboundWaypoints).toEqual([roof02Pos]);
    expect(derived.outboundDistanceMeters).toBe(0);
    expect(derived.returnWaypoints).toEqual([
      roof02Pos,
      { x: 22, y: 27, z: 14 },
      FLOOD_SCENARIO.homeBase.hoverPosition,
    ]);
  });

  it("8. No remaining reachable targets enters SAFE_HOLD with zero execution approval", async () => {
    const planner = new DeterministicTestPlanner((ctx): MissionPlan => {
      if (ctx.repairAttempt === 0) {
        return singleTargetPlan("ROOF-03");
      }
      // Planner recognizes no requested objective is reachable and aborts
      return {
        missionStatus: "aborted",
        targetOrder: [],
        searchPattern: "direct_inspection",
        preferredNodeSequence: [],
        abortedObjectives: ["ROOF-03"],
        decisionSummary: "ROOF-03 is completely blocked by debris plume.",
      };
    });

    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    const planned = await orchestrator.planMission({
      missionId: "reg-08-unreachable",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Only inspect East School ROOF-03.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });
    const oldApprovalId = planned.approval!.approvalId;
    const oldRouteId = planned.route!.routeId;

    const held = await orchestrator.applyEnvironmentEvent({
      missionId: "reg-08-unreachable",
      expectedEnvironmentVersion: 1,
      event: { type: "obstacle.spawned", obstacleId: "debris-north-01" },
    });

    expect(held.status).toBe("safe_hold");
    expect(held.approval).toBeNull();
    await expect(
      orchestrator.authorizeExecution({
        missionId: "reg-08-unreachable",
        routeId: oldRouteId,
        approvalId: oldApprovalId,
        expectedEnvironmentVersion: 2,
      }),
    ).rejects.toThrow(AppHttpError);
  });

  it("9. No valid path to home enters SAFE_HOLD without issuing approval or making bogus AI calls", async () => {
    const planner = new DeterministicTestPlanner(() =>
      singleTargetPlan("ROOF-02"),
    );
    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    const initial = await orchestrator.planMission({
      missionId: "reg-09-no-rth",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Inspect East Shelter.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });

    await orchestrator.authorizeExecution({
      missionId: "reg-09-no-rth",
      routeId: initial.route!.routeId,
      approvalId: initial.approval!.approvalId,
      expectedEnvironmentVersion: 1,
    });

    // Advance until drone reaches return leg
    for (let i = 0; i < 40; i += 1) {
      const snap = orchestrator.advanceSimulation("reg-09-no-rth", 0.5);
      if (snap.activeLeg === "return") break;
    }

    // Spawn an obstacle directly enveloping the home base approach at (-56, 16, 48)
    const held = await orchestrator.applyEnvironmentEvent({
      missionId: "reg-09-no-rth",
      expectedEnvironmentVersion: 1,
      event: {
        type: "obstacle.spawned",
        obstacleId: "helipad-blockade",
        obstacle: {
          id: "helipad-blockade",
          label: "Helipad Floodwall Collapse",
          kind: "dynamic_hazard",
          bounds: {
            min: { x: -62, y: 0, z: 40 },
            max: { x: -48, y: 38, z: 54 },
          },
          colorHex: 0xd94f5c,
        },
      },
    });

    expect(planner.callCount).toBe(1); // Zero extra AI calls on pure RTH blockade
    expect(held.status).toBe("safe_hold");
    expect(held.approval).toBeNull();
  });

  it("10. Insufficient projected return reserve fails closed into SAFE_HOLD with ENERGY_INFEASIBLE", async () => {
    const planner = new DeterministicTestPlanner(() =>
      singleTargetPlan("ROOF-02"),
    );
    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    const initial = await orchestrator.planMission({
      missionId: "reg-10-rth-reserve",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Inspect East Shelter.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });

    await orchestrator.authorizeExecution({
      missionId: "reg-10-rth-reserve",
      routeId: initial.route!.routeId,
      approvalId: initial.approval!.approvalId,
      expectedEnvironmentVersion: 1,
    });

    // Advance onto RTH leg at ROOF-02
    for (let i = 0; i < 40; i += 1) {
      const snap = orchestrator.advanceSimulation("reg-10-rth-reserve", 0.5);
      if (snap.activeLeg === "return") break;
    }

    // Drop battery to 25% -> remaining RTH (~12%+) leaves < 20% required landing reserve
    const held = await orchestrator.applyEnvironmentEvent({
      missionId: "reg-10-rth-reserve",
      expectedEnvironmentVersion: 1,
      event: { type: "battery.changed", batteryPercent: 25 },
    });

    expect(held.status).toBe("safe_hold");
    expect(held.approval).toBeNull();
    expect(
      held.lastRejectedVerification?.violations.some(
        (v) => v.code === "ENERGY_INFEASIBLE",
      ),
    ).toBe(true);
  });

  it("enforces strict atomicity on invalid mutation events without incrementing environmentVersion or revoking approvals", async () => {
    const planner = new DeterministicTestPlanner(() =>
      singleTargetPlan("ROOF-02"),
    );
    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    const ready = await orchestrator.planMission({
      missionId: "reg-atomic-invalid",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Inspect East Shelter.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });

    const originalApprovalId = ready.approval!.approvalId;

    // Invalid unknown preset
    await expect(
      orchestrator.applyEnvironmentEvent({
        missionId: "reg-atomic-invalid",
        expectedEnvironmentVersion: 1,
        event: { type: "obstacle.spawned", obstacleId: "unknown-hazard-99" },
      }),
    ).rejects.toThrow(AppHttpError);

    // Invalid inverted AABB bounds (min > max)
    await expect(
      orchestrator.applyEnvironmentEvent({
        missionId: "reg-atomic-invalid",
        expectedEnvironmentVersion: 1,
        event: {
          type: "obstacle.spawned",
          obstacleId: "inverted-box",
          obstacle: {
            id: "inverted-box",
            label: "Bad Box",
            kind: "dynamic_hazard",
            bounds: {
              min: { x: 20, y: 0, z: 20 },
              max: { x: 5, y: 10, z: 5 },
            },
            colorHex: 0xff0000,
          },
        },
      }),
    ).rejects.toThrow(AppHttpError);

    const unchanged = orchestrator.getMissionSnapshot("reg-atomic-invalid");
    expect(unchanged.environmentVersion).toBe(1);
    expect(unchanged.status).toBe("ready");
    expect(unchanged.approval?.approvalId).toBe(originalApprovalId);
    expect(unchanged.approval?.revokedAt).toBeUndefined();
  });

  it("does not prematurely mark targets abandoned on failed repair attempt 1 so repair attempt 2 can still select them", async () => {
    const planner = new DeterministicTestPlanner((ctx): MissionPlan => {
      if (ctx.repairAttempt === 0) {
        return {
          missionStatus: "planned",
          targetOrder: ["ROOF-03", "ROOF-02"],
          searchPattern: "direct_inspection",
          preferredNodeSequence: [],
          abortedObjectives: [],
          decisionSummary: "Visit ROOF-03 and ROOF-02.",
        };
      }
      if (ctx.repairAttempt === 1) {
        // Attempt 1 mistakenly keeps blocked ROOF-03 and tries to abort reachable ROOF-02!
        return {
          missionStatus: "partial",
          targetOrder: ["ROOF-03"],
          searchPattern: "direct_inspection",
          preferredNodeSequence: [],
          abortedObjectives: ["ROOF-02"],
          decisionSummary: "Mistakenly tried ROOF-03 first.",
        };
      }
      // Attempt 2 switches to reachable ROOF-02 and aborts blocked ROOF-03
      return {
        missionStatus: "partial",
        targetOrder: ["ROOF-02"],
        searchPattern: "direct_inspection",
        preferredNodeSequence: [],
        abortedObjectives: ["ROOF-03"],
        decisionSummary: "Switched to reachable ROOF-02.",
      };
    });

    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    await orchestrator.planMission({
      missionId: "reg-repair-isolation",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Survey East Block.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });

    const recovered = await orchestrator.applyEnvironmentEvent({
      missionId: "reg-repair-isolation",
      expectedEnvironmentVersion: 1,
      event: { type: "obstacle.spawned", obstacleId: "debris-north-01" },
    });

    expect(planner.callCount).toBe(3); // 1 initial + 2 repair attempts
    expect(recovered.status).toBe("ready");
    expect(recovered.route?.targetIds).toEqual(["ROOF-02"]);
    expect(
      recovered.targets.find((t) => t.id === "ROOF-02")?.status,
    ).toBe("pending");
    expect(
      recovered.targets.find((t) => t.id === "ROOF-03")?.status,
    ).toBe("abandoned");
  });
});
