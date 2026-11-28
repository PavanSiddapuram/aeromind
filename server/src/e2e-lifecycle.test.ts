import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  FLOOD_SCENARIO,
  equals,
  type MissionEvent,
  type MissionPlan,
} from "@aeromind/shared";
import { buildServerApp } from "./app.js";
import type {
  MissionPlanner,
  PlannerOutput,
  PlannerRequestContext,
} from "./planner/gemini-planner.js";

class E2EInjectedPlanner implements MissionPlanner {
  readonly providerName = "e2e-injected-planner";
  readonly isConfigured = true;
  readonly modelName = "e2e-planner";
  public callCount = 0;

  async proposeMissionPlan(_ctx: PlannerRequestContext): Promise<PlannerOutput> {
    this.callCount += 1;
    const plan: MissionPlan = {
      missionStatus: "planned",
      targetOrder: ["ROOF-02"],
      searchPattern: "direct_inspection",
      preferredNodeSequence: [],
      abortedObjectives: ["ROOF-01", "ROOF-03", "ROOF-04"],
      decisionSummary:
        "Prioritize urgent eastern rooftop shelter ROOF-02 and return home within reserve.",
    };
    return {
      rawOutput: plan,
      modelName: this.modelName,
      latencyMs: 5,
    };
  }
}

describe("End-to-End HTTP + SSE Mission Lifecycle Validation", () => {
  let activeApp: FastifyInstance | null = null;

  afterEach(async () => {
    if (activeApp) {
      await activeApp.close();
      activeApp = null;
    }
  });

  it("executes fresh mission -> plan -> verify -> execute -> mid-flight obstacle -> approval revocation -> local A* recovery -> re-authorize -> RTH completion with live SSE audit stream", async () => {
    const planner = new E2EInjectedPlanner();
    const { app, orchestrator } = await buildServerApp({
      planner,
      enableAutoTicker: false,
      serveStaticWeb: false,
    });
    activeApp = app;

    const missionId = "mission-e2e-001";
    const streamedEvents: MissionEvent[] = [];
    const unsubscribe = orchestrator.subscribe(missionId, (evt) => {
      streamedEvents.push(evt);
    });

    // 1. Submit mission plan request
    const planRes = await app.inject({
      method: "POST",
      url: "/api/mission/plan",
      payload: {
        missionId,
        scenarioId: FLOOD_SCENARIO.id,
        instruction: "Survey the eastern block shelter rooftop first.",
        constraints: { maxAltitudeMeters: 40, minLandingReservePercent: 20 },
        expectedEnvironmentVersion: 1,
      },
    });
    expect(planRes.statusCode).toBe(200);
    const v1Mission = planRes.json().mission;
    expect(v1Mission.status).toBe("ready");
    expect(v1Mission.environmentVersion).toBe(1);
    expect(v1Mission.approval).not.toBeNull();
    expect(v1Mission.route.nodeIds).toContain("N-SOUTH-CORRIDOR");

    // 2. Independently invoke /api/mission/verify
    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/mission/verify",
      payload: {
        missionId,
        routeId: v1Mission.route.routeId,
        expectedEnvironmentVersion: 1,
      },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().approved).toBe(true);
    const v1ApprovalId = verifyRes.json().approval.approvalId as string;

    // 3. Authorize and start execution
    const execV1Res = await app.inject({
      method: "POST",
      url: "/api/mission/execute",
      payload: {
        missionId,
        routeId: v1Mission.route.routeId,
        approvalId: v1ApprovalId,
        expectedEnvironmentVersion: 1,
      },
    });
    expect(execV1Res.statusCode).toBe(200);
    expect(execV1Res.json().status).toBe("executing");

    // Advance flight 2 seconds so drone is mid-air between nodes
    const midFlight = orchestrator.advanceSimulation(missionId, 2.0);
    expect(midFlight.status).toBe("executing");
    expect(
      equals(midFlight.drone.position, FLOOD_SCENARIO.homeBase.hoverPosition),
    ).toBe(false);

    // 4. Inject dynamic obstacle (crane-01) blocking South Central Corridor
    const eventRes = await app.inject({
      method: "POST",
      url: "/api/mission/event",
      payload: {
        missionId,
        expectedEnvironmentVersion: 1,
        event: {
          type: "obstacle.spawned",
          obstacleId: "crane-01",
        },
      },
    });
    expect(eventRes.statusCode).toBe(200);
    const v2Mission = eventRes.json().mission;

    // Verify revocation, local A* recovery (0 extra AI calls), and new v2 approval
    expect(planner.callCount).toBe(1);
    expect(v2Mission.environmentVersion).toBe(2);
    expect(v2Mission.lastReplanOutcome).toBe("local_astar");
    expect(v2Mission.status).toBe("ready");
    expect(v2Mission.route.nodeIds).toContain("N-NORTH-CORRIDOR");
    expect(v2Mission.approval.environmentVersion).toBe(2);
    expect(
      v2Mission.lastRejectedVerification.violations.some(
        (v: { code: string }) => v.code === "OBSTACLE_COLLISION",
      ),
    ).toBe(true);

    // Attempting to execute with old v1 approval or v1 version fails closed (409)
    const staleExec = await app.inject({
      method: "POST",
      url: "/api/mission/execute",
      payload: {
        missionId,
        routeId: v1Mission.route.routeId,
        approvalId: v1ApprovalId,
        expectedEnvironmentVersion: 1,
      },
    });
    expect(staleExec.statusCode).toBe(409);

    // 5. Authorize new v2 route approval and fly outbound + RTH to completion
    const execV2Res = await app.inject({
      method: "POST",
      url: "/api/mission/execute",
      payload: {
        missionId,
        routeId: v2Mission.route.routeId,
        approvalId: v2Mission.approval.approvalId,
        expectedEnvironmentVersion: 2,
      },
    });
    expect(execV2Res.statusCode).toBe(200);
    expect(execV2Res.json().status).toBe("executing");

    const finalSnap = orchestrator.advanceSimulation(missionId, 60.0);
    expect(finalSnap.status).toBe("completed");
    expect(
      finalSnap.targets.find((t) => t.id === "ROOF-02")?.status,
    ).toBe("visited");
    expect(
      equals(
        finalSnap.drone.position,
        FLOOD_SCENARIO.homeBase.hoverPosition,
        1e-3,
      ),
    ).toBe(true);
    expect(finalSnap.drone.batteryPercent).toBeGreaterThanOrEqual(20);

    unsubscribe();

    // 6. Verify complete monotonic event sequence
    expect(streamedEvents.length).toBeGreaterThanOrEqual(14);
    for (let i = 1; i < streamedEvents.length; i += 1) {
      expect(streamedEvents[i]!.sequence).toBe(
        streamedEvents[i - 1]!.sequence + 1,
      );
    }
    const eventTypes = streamedEvents.map((e) => e.type);
    expect(eventTypes).toContain("mission.received");
    expect(eventTypes).toContain("plan.generated");
    expect(eventTypes).toContain("simulation.paused");
    expect(eventTypes).toContain("environment.changed");
    expect(eventTypes).toContain("verification.rejected");
    expect(eventTypes).toContain("replanning.started");
    expect(eventTypes).toContain("verification.passed");
    expect(eventTypes[eventTypes.length - 1]).toBe("simulation.completed");
  });
});
