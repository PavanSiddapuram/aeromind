import { describe, expect, it } from "vitest";
import { FLOOD_SCENARIO, type MissionPlan } from "@aeromind/shared";
import { AppHttpError } from "../errors.js";
import type {
  MissionPlanner,
  PlannerOutput,
  PlannerRequestContext,
} from "../planner/gemini-planner.js";
import { PlannerProviderError } from "../planner/gemini-planner.js";
import { MissionOrchestrator } from "./mission-orchestrator.js";

class ScriptedPlanner implements MissionPlanner {
  readonly providerName = "scripted-test-planner";
  readonly isConfigured = true;
  readonly modelName = "scripted-v1";
  public callCount = 0;
  public contexts: PlannerRequestContext[] = [];

  constructor(
    private readonly handler: (
      ctx: PlannerRequestContext,
      callIndex: number,
    ) => Promise<unknown> | unknown,
  ) {}

  async proposeMissionPlan(
    context: PlannerRequestContext,
  ): Promise<PlannerOutput> {
    const idx = this.callCount;
    this.callCount += 1;
    this.contexts.push(context);
    const rawOutput = await this.handler(context, idx);
    return {
      rawOutput,
      modelName: this.modelName,
      latencyMs: 4,
    };
  }
}

describe("MissionOrchestrator, state machine, and approval gate", () => {
  it("completes plan -> verify -> authorize -> execute -> completed lifecycle", async () => {
    const validPlan: MissionPlan = {
      missionStatus: "planned",
      targetOrder: ["ROOF-02"],
      searchPattern: "direct_inspection",
      preferredNodeSequence: [],
      abortedObjectives: [],
      decisionSummary: "Inspect East Shelter rooftop first.",
    };

    const planner = new ScriptedPlanner(() => validPlan);
    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    const planned = await orchestrator.planMission({
      missionId: "m-lifecycle",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Check East Shelter rooftop.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });

    expect(planned.status).toBe("ready");
    expect(planned.approval).not.toBeNull();
    expect(planned.route).not.toBeNull();

    const executing = await orchestrator.authorizeExecution({
      missionId: "m-lifecycle",
      routeId: planned.route!.routeId,
      approvalId: planned.approval!.approvalId,
      expectedEnvironmentVersion: 1,
    });
    expect(executing.status).toBe("executing");

    // Replaying a consumed approval must fail closed
    await expect(
      orchestrator.authorizeExecution({
        missionId: "m-lifecycle",
        routeId: planned.route!.routeId,
        approvalId: planned.approval!.approvalId,
        expectedEnvironmentVersion: 1,
      }),
    ).rejects.toThrow(AppHttpError);

    // Advance deterministic flight simulation to completion
    const done = orchestrator.advanceSimulation("m-lifecycle", 60);
    expect(done.status).toBe("completed");
    expect(
      done.targets.find((t) => t.id === "ROOF-02")?.status,
    ).toBe("visited");
    expect(done.drone.batteryPercent).toBeGreaterThanOrEqual(
      FLOOD_SCENARIO.defaultConstraints.minLandingReservePercent,
    );
  });

  it("performs deterministic local A* reroute on crane-01 spawn WITHOUT calling Gemini again", async () => {
    const planner = new ScriptedPlanner(
      (): MissionPlan => ({
        missionStatus: "planned",
        targetOrder: ["ROOF-02"],
        searchPattern: "direct_inspection",
        preferredNodeSequence: [],
        abortedObjectives: [],
        decisionSummary: "Direct route to East Shelter.",
      }),
    );
    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    const initial = await orchestrator.planMission({
      missionId: "m-local-reroute",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Survey East Shelter.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });

    const staleApprovalId = initial.approval!.approvalId;
    const staleRouteId = initial.route!.routeId;
    expect(planner.callCount).toBe(1);

    // Start flying for 2 seconds so drone is mid-segment between nodes!
    await orchestrator.authorizeExecution({
      missionId: "m-local-reroute",
      routeId: staleRouteId,
      approvalId: staleApprovalId,
      expectedEnvironmentVersion: 1,
    });
    orchestrator.advanceSimulation("m-local-reroute", 2);

    // Spawn crane-01 blocking the southern corridor
    const mutated = await orchestrator.applyEnvironmentEvent({
      missionId: "m-local-reroute",
      expectedEnvironmentVersion: 1,
      event: {
        type: "obstacle.spawned",
        obstacleId: "crane-01",
      },
    });

    // Must NOT have called Gemini again!
    expect(planner.callCount).toBe(1);
    expect(mutated.environmentVersion).toBe(2);
    expect(mutated.lastReplanOutcome).toBe("local_astar");
    expect(mutated.status).toBe("ready");
    expect(mutated.lastRejectedVerification?.approved).toBe(false);
    expect(
      mutated.lastRejectedVerification?.violations.some(
        (v) => v.code === "OBSTACLE_COLLISION" && v.entityId === "crane-01",
      ),
    ).toBe(true);
    expect(mutated.route?.nodeIds).toContain("N-NORTH-CORRIDOR");
    expect(mutated.approval?.environmentVersion).toBe(2);

    // Stale approval/version must be rejected
    await expect(
      orchestrator.authorizeExecution({
        missionId: "m-local-reroute",
        routeId: staleRouteId,
        approvalId: staleApprovalId,
        expectedEnvironmentVersion: 1,
      }),
    ).rejects.toThrow(AppHttpError);
  });

  it("escalates to Gemini mission replanning when all paths to a target are blocked (debris-north-01)", async () => {
    const planner = new ScriptedPlanner((ctx): MissionPlan => {
      if (ctx.repairAttempt === 0) {
        return {
          missionStatus: "planned",
          targetOrder: ["ROOF-03", "ROOF-02"],
          searchPattern: "perimeter_scan",
          preferredNodeSequence: [],
          abortedObjectives: [],
          decisionSummary: "Inspect East School then East Shelter.",
        };
      }
      // On repair, drop blocked ROOF-03 and keep ROOF-02
      return {
        missionStatus: "partial",
        targetOrder: ["ROOF-02"],
        searchPattern: "direct_inspection",
        preferredNodeSequence: [],
        abortedObjectives: ["ROOF-03"],
        decisionSummary:
          "Aborted blocked East School (ROOF-03); proceeding to East Shelter (ROOF-02).",
      };
    });

    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    await orchestrator.planMission({
      missionId: "m-gemini-repair",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Survey East Block rooftops.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });
    expect(planner.callCount).toBe(1);

    const recovered = await orchestrator.applyEnvironmentEvent({
      missionId: "m-gemini-repair",
      expectedEnvironmentVersion: 1,
      event: {
        type: "obstacle.spawned",
        obstacleId: "debris-north-01",
      },
    });

    expect(planner.callCount).toBe(2);
    expect(recovered.lastReplanOutcome).toBe("ai_replan");
    expect(recovered.status).toBe("ready");
    expect(recovered.plan?.missionStatus).toBe("partial");
    expect(recovered.plan?.abortedObjectives).toContain("ROOF-03");
    expect(recovered.approval?.environmentVersion).toBe(2);
  });

  it("caps Gemini repair attempts at 2 and enters safe_hold when battery drop makes planner proposals infeasible", async () => {
    const planner = new ScriptedPlanner((): MissionPlan => ({
      missionStatus: "planned",
      targetOrder: ["ROOF-02", "ROOF-03", "ROOF-01", "ROOF-04"],
      searchPattern: "grid_scan",
      preferredNodeSequence: [],
      abortedObjectives: [],
      decisionSummary: "Stubbornly insists on all 4 targets.",
    }));

    const orchestrator = new MissionOrchestrator(planner, {
      enableAutoTicker: false,
    });

    await orchestrator.planMission({
      missionId: "m-retry-cap",
      scenarioId: FLOOD_SCENARIO.id,
      instruction: "Visit every rooftop.",
      constraints: FLOOD_SCENARIO.defaultConstraints,
      expectedEnvironmentVersion: 1,
    });
    expect(planner.callCount).toBe(1);

    // Drop battery to 38% so 4 targets is impossible and planner refuses to shed targets
    const held = await orchestrator.applyEnvironmentEvent({
      missionId: "m-retry-cap",
      expectedEnvironmentVersion: 1,
      event: {
        type: "battery.changed",
        batteryPercent: 38,
        reason: "Cell voltage sag",
      },
    });

    // 1 initial + max 2 repair attempts = 3 total calls
    expect(planner.callCount).toBe(3);
    expect(held.repairAttemptsUsed).toBe(2);
    expect(held.status).toBe("safe_hold");
    expect(held.approval).toBeNull();
  });

  it("fails closed into safe_hold on Gemini timeout without issuing approval", async () => {
    const timeoutPlanner = new ScriptedPlanner(() => {
      throw new PlannerProviderError(
        "PROVIDER_TIMEOUT",
        "Gemini timed out with key AIzaSySecretKey1234567890abcd",
      );
    });
    const orchestrator = new MissionOrchestrator(timeoutPlanner, {
      enableAutoTicker: false,
    });

    await expect(
      orchestrator.planMission({
        missionId: "m-timeout",
        scenarioId: FLOOD_SCENARIO.id,
        instruction: "Survey rooftops.",
        constraints: FLOOD_SCENARIO.defaultConstraints,
        expectedEnvironmentVersion: 1,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof AppHttpError &&
        err.statusCode === 503 &&
        !err.message.includes("AIzaSySecretKey")
      );
    });

    const snap = orchestrator.getMissionSnapshot("m-timeout");
    expect(snap.status).toBe("safe_hold");
    expect(snap.approval).toBeNull();
  });
});
