import { randomUUID } from "node:crypto";
import {
  FLOOD_SCENARIO,
  VERIFIER_POLICY_VERSION,
  VersionedNavigationEngine,
  cloneScenarioSnapshot,
  distance,
  equals,
  getScenarioDefinition,
  lerp,
  resolveMissionRoute,
  verifyRoute,
  type DroneState,
  type EnvironmentMutationEvent,
  type MissionConstraints,
  type MissionEvent,
  type MissionEventType,
  type MissionPlan,
  type MissionStatus,
  type RescueTarget,
  type ResolvedRoute,
  type RouteApproval,
  type RouteViolation,
  type ScenarioDefinition,
  type ScenarioObstacle,
  type Vector3,
  type VerificationReport,
} from "@aeromind/shared";
import { AppHttpError } from "../errors.js";
import type { MissionPlanner } from "../planner/gemini-planner.js";
import { PlannerProviderError } from "../planner/gemini-planner.js";
import { validateMissionPlanAgainstScenario } from "../planner/plan-validator.js";
import { ApprovalGate } from "./approval-gate.js";
import { assertLegalTransition } from "./state-machine.js";

export const MAX_GEMINI_REPAIR_ATTEMPTS = 2;

export type ReplanOutcome = "none" | "unchanged_valid" | "local_astar" | "ai_replan" | "safe_hold";

export type FlightProgress = {
  leg: "outbound" | "return";
  segmentIndex: number;
  segmentOffsetMeters: number;
  headingRad: number;
};

export type MissionSnapshot = {
  missionId: string;
  scenarioId: string;
  status: MissionStatus;
  instruction: string;
  constraints: MissionConstraints;
  environmentVersion: number;
  policyVersion: string;
  drone: DroneState;
  headingRad: number;
  windMetersPerSecond: number;
  obstacles: ScenarioObstacle[];
  targets: RescueTarget[];
  plan: MissionPlan | null;
  plannerModel: string | null;
  plannerLatencyMs: number | null;
  lastReplanOutcome: ReplanOutcome;
  repairAttemptsUsed: number;
  route: ResolvedRoute | null;
  verification: VerificationReport | null;
  lastRejectedVerification: VerificationReport | null;
  lastRejectedWaypoints: Vector3[] | null;
  approval: RouteApproval | null;
  events: MissionEvent[];
};

type MissionSession = {
  missionId: string;
  scenario: ScenarioDefinition;
  status: MissionStatus;
  instruction: string;
  constraints: MissionConstraints;
  environmentVersion: number;
  drone: DroneState;
  headingRad: number;
  windMetersPerSecond: number;
  obstacles: ScenarioObstacle[];
  targets: RescueTarget[];
  plan: MissionPlan | null;
  plannerModel: string | null;
  plannerLatencyMs: number | null;
  lastReplanOutcome: ReplanOutcome;
  repairAttemptsUsed: number;
  route: ResolvedRoute | null;
  executedRoute: ResolvedRoute | null;
  flightProgress: FlightProgress | null;
  verification: VerificationReport | null;
  lastRejectedVerification: VerificationReport | null;
  lastRejectedWaypoints: Vector3[] | null;
  approval: RouteApproval | null;
  sequenceCounter: number;
  events: MissionEvent[];
  navEngine: VersionedNavigationEngine;
  simTimer: ReturnType<typeof setInterval> | null;
  lockChain: Promise<void>;
};

export type EventSubscriber = (event: MissionEvent) => void;

export class MissionOrchestrator {
  private readonly sessions = new Map<string, MissionSession>();
  private readonly subscribers = new Map<string, Set<EventSubscriber>>();
  private readonly approvalGate = new ApprovalGate();
  private readonly enableAutoTicker: boolean;
  private readonly simulationTickMs: number;

  constructor(
    private readonly planner: MissionPlanner,
    options?: {
      enableAutoTicker?: boolean | undefined;
      simulationTickMs?: number | undefined;
    },
  ) {
    this.enableAutoTicker = options?.enableAutoTicker ?? true;
    this.simulationTickMs = options?.simulationTickMs ?? 150;
  }

  get plannerInfo(): {
    provider: string;
    model: string;
    configured: boolean;
  } {
    return {
      provider: this.planner.providerName,
      model: this.planner.modelName,
      configured: this.planner.isConfigured,
    };
  }

  subscribe(missionId: string, subscriber: EventSubscriber): () => void {
    let set = this.subscribers.get(missionId);
    if (!set) {
      set = new Set();
      this.subscribers.set(missionId, set);
    }
    set.add(subscriber);
    return () => {
      const active = this.subscribers.get(missionId);
      if (!active) return;
      active.delete(subscriber);
      if (active.size === 0) {
        this.subscribers.delete(missionId);
      }
    };
  }

  getMissionSnapshot(missionId: string): MissionSnapshot {
    const session = this.sessions.get(missionId);
    if (!session) {
      throw new AppHttpError(
        404,
        "MISSION_NOT_FOUND",
        `Mission "${missionId}" was not found.`,
      );
    }
    return this.toSnapshot(session);
  }

  getExistingEvents(missionId: string): MissionEvent[] {
    const session = this.sessions.get(missionId);
    return session ? session.events.map((e) => structuredClone(e)) : [];
  }

  resetMission(missionId: string, scenarioId = FLOOD_SCENARIO.id): MissionSnapshot {
    const existing = this.sessions.get(missionId);
    if (existing?.simTimer) {
      clearInterval(existing.simTimer);
      existing.simTimer = null;
    }
    this.approvalGate.revokeMissionApprovals(missionId);

    const definition = getScenarioDefinition(scenarioId);
    if (!definition) {
      throw new AppHttpError(
        404,
        "SCENARIO_NOT_FOUND",
        `Scenario "${scenarioId}" does not exist.`,
      );
    }

    const fresh = this.createSession(missionId, definition);
    this.sessions.set(missionId, fresh);
    return this.toSnapshot(fresh);
  }

  async planMission(params: {
    missionId: string;
    scenarioId: string;
    instruction: string;
    constraints: MissionConstraints;
    expectedEnvironmentVersion: number;
    sceneImageDataUrl?: string | undefined;
  }): Promise<MissionSnapshot> {
    const definition = getScenarioDefinition(params.scenarioId);
    if (!definition) {
      throw new AppHttpError(
        404,
        "SCENARIO_NOT_FOUND",
        `Unknown scenario "${params.scenarioId}".`,
      );
    }

    let session = this.sessions.get(params.missionId);
    if (!session) {
      if (params.expectedEnvironmentVersion !== 1) {
        throw new AppHttpError(
          409,
          "STALE_ENVIRONMENT_VERSION",
          `New mission "${params.missionId}" starts at environment version 1 (received ${params.expectedEnvironmentVersion}).`,
        );
      }
      session = this.createSession(params.missionId, definition);
      this.sessions.set(params.missionId, session);
    }

    return this.runExclusive(session, async () => {
      if (params.expectedEnvironmentVersion !== session.environmentVersion) {
        throw new AppHttpError(
          409,
          "STALE_ENVIRONMENT_VERSION",
          `Expected environment version ${params.expectedEnvironmentVersion}, but current version is ${session.environmentVersion}.`,
        );
      }

      if (session.status === "executing") {
        throw new AppHttpError(
          409,
          "INVALID_STATE_TRANSITION",
          "Cannot start a new plan while simulation is actively executing; pause or wait first.",
        );
      }

      this.stopSimulationTicker(session);
      this.approvalGate.revokeMissionApprovals(session.missionId);
      session.approval = null;
      session.lastRejectedVerification = null;
      session.lastRejectedWaypoints = null;
      session.lastReplanOutcome = "none";
      session.repairAttemptsUsed = 0;
      session.instruction = params.instruction;
      session.constraints = { ...params.constraints };
      for (const target of session.targets) {
        if (target.status === "abandoned") {
          target.status = "pending";
        }
      }

      this.emitEvent(session, "mission.received", {
        instruction: params.instruction,
        constraints: params.constraints,
      });

      this.transition(session, "planning");
      this.emitEvent(session, "planning.started", {
        engine: "neural-planner",
      });

      await this.executePlanAndVerifyCycle(session, {
        isInitialRequest: true,
        sceneImageDataUrl: params.sceneImageDataUrl,
      });

      return this.toSnapshot(session);
    });
  }

  async verifyStoredRoute(params: {
    missionId: string;
    routeId: string;
    expectedEnvironmentVersion: number;
  }): Promise<{
    approved: boolean;
    violations: RouteViolation[];
    estimatedMissionEnergyPercent: number;
    estimatedReturnEnergyPercent: number;
    projectedLandingReservePercent: number;
    verification: VerificationReport;
    approval: RouteApproval | null;
    environmentVersion: number;
  }> {
    const session = this.requireSession(params.missionId);

    return this.runExclusive(session, async () => {
      if (params.expectedEnvironmentVersion !== session.environmentVersion) {
        throw new AppHttpError(
          409,
          "STALE_ENVIRONMENT_VERSION",
          `Expected environment version ${params.expectedEnvironmentVersion}, but current version is ${session.environmentVersion}.`,
        );
      }

      if (!session.route || session.route.routeId !== params.routeId) {
        throw new AppHttpError(
          404,
          "ROUTE_NOT_FOUND",
          `Route "${params.routeId}" does not exist on mission "${params.missionId}".`,
        );
      }

      this.emitEvent(session, "verification.started", {
        routeId: session.route.routeId,
      });

      const report = verifyRoute({
        routeId: session.route.routeId,
        environmentVersion: session.environmentVersion,
        waypoints: session.route.waypoints,
        returnWaypoints: session.route.returnWaypoints,
        inspectedTargetCount: session.route.targetIds.length,
        drone: session.drone,
        constraints: session.constraints,
        scenario: session.scenario,
        obstacles: session.obstacles,
        windMetersPerSecond: session.windMetersPerSecond,
        policyVersion: VERIFIER_POLICY_VERSION,
      });

      session.verification = report;

      if (report.approved) {
        if (session.status !== "ready" && session.status !== "executing") {
          this.transition(session, "ready");
        }
        const approval = this.approvalGate.issueApproval({
          missionId: session.missionId,
          routeId: session.route.routeId,
          environmentVersion: session.environmentVersion,
          policyVersion: VERIFIER_POLICY_VERSION,
          verification: report,
        });
        session.approval = approval;
        this.emitEvent(session, "verification.passed", {
          routeId: session.route.routeId,
          approvalId: approval.approvalId,
          projectedLandingReservePercent: report.projectedLandingReservePercent,
        });
      } else {
        this.approvalGate.revokeMissionApprovals(session.missionId);
        session.approval = null;
        session.lastRejectedVerification = report;
        session.lastRejectedWaypoints = [...session.route.waypoints];
        this.emitEvent(session, "verification.rejected", {
          routeId: session.route.routeId,
          violations: report.violations,
        });
      }

      return {
        approved: report.approved,
        violations: report.violations,
        estimatedMissionEnergyPercent: report.estimatedMissionEnergyPercent,
        estimatedReturnEnergyPercent: report.estimatedReturnEnergyPercent,
        projectedLandingReservePercent: report.projectedLandingReservePercent,
        verification: report,
        approval: session.approval,
        environmentVersion: session.environmentVersion,
      };
    });
  }

  async authorizeExecution(params: {
    missionId: string;
    routeId: string;
    approvalId: string;
    expectedEnvironmentVersion: number;
  }): Promise<MissionSnapshot> {
    const session = this.requireSession(params.missionId);

    return this.runExclusive(session, async () => {
      if (!session.route || session.route.routeId !== params.routeId) {
        throw new AppHttpError(
          404,
          "ROUTE_NOT_FOUND",
          `Route "${params.routeId}" was not found for mission "${params.missionId}".`,
        );
      }

      const consumedApproval = this.approvalGate.authorizeExecution({
        missionId: session.missionId,
        routeId: params.routeId,
        approvalId: params.approvalId,
        expectedEnvironmentVersion: params.expectedEnvironmentVersion,
        currentEnvironmentVersion: session.environmentVersion,
        currentPolicyVersion: VERIFIER_POLICY_VERSION,
        missionStatus: session.status,
      });

      session.approval = consumedApproval;
      session.executedRoute = structuredClone(session.route);
      session.flightProgress = {
        leg: "outbound",
        segmentIndex: 0,
        segmentOffsetMeters: 0,
        headingRad: session.headingRad,
      };

      this.emitEvent(session, "execution.authorized", {
        routeId: session.route.routeId,
        approvalId: consumedApproval.approvalId,
      });

      this.transition(session, "executing");
      this.emitEvent(session, "simulation.started", {
        routeId: session.route.routeId,
        waypointCount: session.route.waypoints.length,
      });

      if (this.enableAutoTicker) {
        this.startSimulationTicker(session);
      }

      return this.toSnapshot(session);
    });
  }

  async applyEnvironmentEvent(params: {
    missionId: string;
    expectedEnvironmentVersion: number;
    event: EnvironmentMutationEvent;
    autoReplan?: boolean | undefined;
    sceneImageDataUrl?: string | undefined;
  }): Promise<MissionSnapshot> {
    const session = this.requireSession(params.missionId);

    return this.runExclusive(session, async () => {
      if (params.expectedEnvironmentVersion !== session.environmentVersion) {
        throw new AppHttpError(
          409,
          "STALE_ENVIRONMENT_VERSION",
          `Expected environment version ${params.expectedEnvironmentVersion}, but current version is ${session.environmentVersion}.`,
        );
      }

      const wasExecuting = session.status === "executing";
      const hadPlan = session.plan !== null;

      // INV-07: Pause execution immediately, bump environmentVersion, revoke prior approvals.
      this.stopSimulationTicker(session);
      if (wasExecuting) {
        this.transition(session, "paused");
        this.emitEvent(session, "simulation.paused", {
          reason: params.event.type,
          dronePosition: { ...session.drone.position },
          batteryPercent: session.drone.batteryPercent,
        });
      } else if (session.status === "ready") {
        this.transition(session, "paused");
      }

      session.environmentVersion += 1;
      session.navEngine.invalidate();
      const revokedCount = this.approvalGate.revokeMissionApprovals(
        session.missionId,
      );
      if (session.approval) {
        session.approval = this.approvalGate.getApproval(
          session.approval.approvalId,
        );
      }

      this.applyMutationToSession(session, params.event);

      this.emitEvent(session, "environment.changed", {
        mutation: params.event,
        revokedApprovals: revokedCount,
        batteryPercent: session.drone.batteryPercent,
      });

      const shouldReplan = (params.autoReplan ?? true) && hadPlan;
      if (!shouldReplan) {
        return this.toSnapshot(session);
      }

      await this.reVerifyAndRecoverAfterMutation(session, {
        mutationType: params.event.type,
        sceneImageDataUrl: params.sceneImageDataUrl,
      });

      return this.toSnapshot(session);
    });
  }

  /**
   * Deterministic simulation step (used both by the server interval ticker and by unit tests).
   */
  advanceSimulation(missionId: string, deltaSeconds: number): MissionSnapshot {
    const session = this.requireSession(missionId);
    this.stepSessionSimulation(session, deltaSeconds);
    return this.toSnapshot(session);
  }

  shutdownAll(): void {
    for (const session of this.sessions.values()) {
      this.stopSimulationTicker(session);
    }
  }

  private async executePlanAndVerifyCycle(
    session: MissionSession,
    options: {
      isInitialRequest: boolean;
      priorViolations?: RouteViolation[] | undefined;
      unreachableInfo?: string | undefined;
      sceneImageDataUrl?: string | undefined;
    },
  ): Promise<void> {
    let priorPlan: MissionPlan | undefined = session.plan ?? undefined;
    let priorViolations: RouteViolation[] | undefined = options.priorViolations;
    let unreachableInfo: string | undefined = options.unreachableInfo;

    const maxAttempts = options.isInitialRequest
      ? 1 + MAX_GEMINI_REPAIR_ATTEMPTS
      : MAX_GEMINI_REPAIR_ATTEMPTS;

    for (let index = 0; index < maxAttempts; index += 1) {
      const repairAttempt = options.isInitialRequest ? index : index + 1;
      if (repairAttempt > 0) {
        session.repairAttemptsUsed = repairAttempt;
        if (session.status !== "repairing") {
          this.transition(session, "repairing");
        }
        this.emitEvent(session, "replanning.started", {
          mode: "ai_replan",
          repairAttempt,
          maxRepairAttempts: MAX_GEMINI_REPAIR_ATTEMPTS,
          priorViolations: priorViolations ?? [],
          unreachableInfo: unreachableInfo ?? null,
        });
      }

      let plannerOutput;
      try {
        const requestCtx: Parameters<MissionPlanner["proposeMissionPlan"]>[0] = {
          missionId: session.missionId,
          instruction: session.instruction,
          constraints: session.constraints,
          drone: session.drone,
          windMetersPerSecond: session.windMetersPerSecond,
          targets: session.targets,
          nodes: session.scenario.nodes,
          obstacles: session.obstacles,
          noFlyZones: session.scenario.noFlyZones,
          energyConfig: session.scenario.energyConfig,
          repairAttempt,
          priorPlan,
          priorViolations,
          unreachableInfo,
          sceneImageDataUrl: index === 0 ? options.sceneImageDataUrl : undefined,
        };
        plannerOutput = await this.planner.proposeMissionPlan(requestCtx);
      } catch (error) {
        // INV-03: Gemini timeout / outage -> safe_hold, zero approval.
        this.enterSafeHold(
          session,
          error instanceof Error ? error.message : "Planner unavailable",
        );
        if (options.isInitialRequest && error instanceof PlannerProviderError) {
          throw new AppHttpError(
            503,
            error.code,
            error.message,
            { missionId: session.missionId, status: session.status },
          );
        }
        return;
      }

      session.plannerModel = plannerOutput.modelName;
      session.plannerLatencyMs = plannerOutput.latencyMs;

      const validation = validateMissionPlanAgainstScenario(
        plannerOutput.rawOutput,
        {
          targets: session.targets,
          nodes: session.scenario.nodes,
        },
      );

      if (!validation.ok) {
        // Fail closed on malformed JSON or hallucinated/domain-invalid IDs.
        this.approvalGate.revokeMissionApprovals(session.missionId);
        session.approval = null;

        if (options.isInitialRequest && index === 0) {
          this.transition(session, "failed");
          this.emitEvent(session, "mission.failed", {
            reason: validation.reason,
            issues: validation.issues,
          });
          throw new AppHttpError(
            422,
            validation.reason === "DOMAIN_INVALID"
              ? "DOMAIN_INVALID_PLAN"
              : "MALFORMED_PLANNER_OUTPUT",
            `Planner output rejected: ${validation.issues.join("; ")}`,
            { issues: validation.issues },
          );
        }

        priorViolations = [
          {
            code: "INVALID_WAYPOINT",
            message: `Invalid revised plan: ${validation.issues.join("; ")}`,
          },
        ];
        continue;
      }

      const plan = validation.plan;
      session.plan = plan;
      priorPlan = plan;

      for (const abortedId of plan.abortedObjectives) {
        const target = session.targets.find((t) => t.id === abortedId);
        if (target && target.status === "pending") {
          target.status = "abandoned";
        }
      }

      this.emitEvent(session, "plan.generated", {
        latencyMs: plannerOutput.latencyMs,
        missionStatus: plan.missionStatus,
        targetOrder: plan.targetOrder,
        abortedObjectives: plan.abortedObjectives,
        decisionSummary: plan.decisionSummary,
      });

      if (plan.missionStatus === "aborted") {
        this.enterSafeHold(
          session,
          `Planner aborted mission objectives: ${plan.decisionSummary}`,
        );
        return;
      }

      this.transition(session, "resolving");
      const routeId = `route-v${session.environmentVersion}-${randomUUID().slice(0, 8)}`;
      const resolved = resolveMissionRoute({
        routeId,
        environmentVersion: session.environmentVersion,
        scenario: session.scenario,
        obstacles: session.obstacles,
        targets: session.targets,
        drone: session.drone,
        constraints: session.constraints,
        targetOrder: plan.targetOrder,
        preferredNodeSequence: plan.preferredNodeSequence,
        useAdvisorySequence: true,
        engine: session.navEngine,
      });

      if (!resolved.ok) {
        unreachableInfo = resolved.message;
        priorViolations = undefined;
        continue;
      }

      session.route = resolved.route;
      this.emitEvent(session, "route.resolved", {
        routeId: resolved.route.routeId,
        nodeIds: resolved.route.nodeIds,
        distanceMeters: Number(resolved.route.distanceMeters.toFixed(2)),
        returnDistanceMeters: Number(
          resolved.route.returnDistanceMeters.toFixed(2),
        ),
      });

      this.transition(session, "verifying");
      this.emitEvent(session, "verification.started", {
        routeId: resolved.route.routeId,
      });

      const report = verifyRoute({
        routeId: resolved.route.routeId,
        environmentVersion: session.environmentVersion,
        waypoints: resolved.route.waypoints,
        returnWaypoints: resolved.route.returnWaypoints,
        inspectedTargetCount: resolved.route.targetIds.length,
        drone: session.drone,
        constraints: session.constraints,
        scenario: session.scenario,
        obstacles: session.obstacles,
        windMetersPerSecond: session.windMetersPerSecond,
        policyVersion: VERIFIER_POLICY_VERSION,
      });

      session.verification = report;

      if (report.approved) {
        this.transition(session, "ready");
        const approval = this.approvalGate.issueApproval({
          missionId: session.missionId,
          routeId: resolved.route.routeId,
          environmentVersion: session.environmentVersion,
          policyVersion: VERIFIER_POLICY_VERSION,
          verification: report,
        });
        session.approval = approval;
        if (repairAttempt > 0 || !options.isInitialRequest) {
          session.lastReplanOutcome = "ai_replan";
        }
        this.emitEvent(session, "verification.passed", {
          routeId: resolved.route.routeId,
          approvalId: approval.approvalId,
          projectedLandingReservePercent: Number(
            report.projectedLandingReservePercent.toFixed(2),
          ),
        });
        return;
      }

      session.lastRejectedVerification = report;
      session.lastRejectedWaypoints = [...resolved.route.waypoints];
      this.emitEvent(session, "verification.rejected", {
        routeId: resolved.route.routeId,
        violations: report.violations,
      });

      priorViolations = report.violations;
      unreachableInfo = undefined;
    }

    // Exhausted repair budget -> safe hold, never unverified execution.
    this.enterSafeHold(
      session,
      `No verified route found within ${MAX_GEMINI_REPAIR_ATTEMPTS} repair attempts.`,
    );
  }

  private async reVerifyAndRecoverAfterMutation(
    session: MissionSession,
    options: {
      mutationType: EnvironmentMutationEvent["type"];
      sceneImageDataUrl?: string | undefined;
    },
  ): Promise<void> {
    const remainingTargetIds = (session.plan?.targetOrder ?? []).filter((id) => {
      const target = session.targets.find((t) => t.id === id);
      return target?.status === "pending";
    });

    // 1. If a new priority target was discovered, mission-level priorities changed -> invoke Gemini replan.
    if (options.mutationType === "target.discovered") {
      await this.executePlanAndVerifyCycle(session, {
        isInitialRequest: false,
        unreachableInfo:
          "A new high-priority rescue target was discovered; re-evaluate targetOrder within battery reserve.",
        sceneImageDataUrl: options.sceneImageDataUrl,
      });
      return;
    }

    // 2. Re-verify the remaining segment of the existing route against the mutated environment.
    let priorViolations: RouteViolation[] | undefined;
    if (session.route) {
      const remainingWaypoints = this.extractRemainingWaypoints(session);
      this.transition(session, "verifying");
      this.emitEvent(session, "verification.started", {
        routeId: session.route.routeId,
        reason: "environment_mutation_recheck",
      });

      const currentReport = verifyRoute({
        routeId: session.route.routeId,
        environmentVersion: session.environmentVersion,
        waypoints: remainingWaypoints,
        returnWaypoints: session.route.returnWaypoints,
        inspectedTargetCount: remainingTargetIds.length,
        drone: session.drone,
        constraints: session.constraints,
        scenario: session.scenario,
        obstacles: session.obstacles,
        windMetersPerSecond: session.windMetersPerSecond,
        policyVersion: VERIFIER_POLICY_VERSION,
      });

      session.verification = currentReport;

      if (currentReport.approved) {
        const refreshedRoute: ResolvedRoute = {
          ...session.route,
          routeId: `route-v${session.environmentVersion}-${randomUUID().slice(0, 8)}`,
          waypoints: remainingWaypoints,
          targetIds: remainingTargetIds,
          environmentVersion: session.environmentVersion,
        };
        const refreshedReport = verifyRoute({
          routeId: refreshedRoute.routeId,
          environmentVersion: session.environmentVersion,
          waypoints: refreshedRoute.waypoints,
          returnWaypoints: refreshedRoute.returnWaypoints,
          inspectedTargetCount: remainingTargetIds.length,
          drone: session.drone,
          constraints: session.constraints,
          scenario: session.scenario,
          obstacles: session.obstacles,
          windMetersPerSecond: session.windMetersPerSecond,
          policyVersion: VERIFIER_POLICY_VERSION,
        });
        if (refreshedReport.approved) {
          session.route = refreshedRoute;
          session.verification = refreshedReport;
          this.transition(session, "ready");
          session.approval = this.approvalGate.issueApproval({
            missionId: session.missionId,
            routeId: refreshedRoute.routeId,
            environmentVersion: session.environmentVersion,
            policyVersion: VERIFIER_POLICY_VERSION,
            verification: refreshedReport,
          });
          session.lastReplanOutcome = "unchanged_valid";
          this.emitEvent(session, "verification.passed", {
            routeId: refreshedRoute.routeId,
            approvalId: session.approval.approvalId,
            replanOutcome: "unchanged_valid",
          });
          return;
        }
      }

      session.lastRejectedVerification = currentReport;
      session.lastRejectedWaypoints = remainingWaypoints;
      priorViolations = currentReport.violations;
      this.emitEvent(session, "verification.rejected", {
        routeId: session.route.routeId,
        violations: currentReport.violations,
      });
    }

    // 3. Attempt deterministic local A* reroute FIRST without calling Gemini (SYSTEM_DESIGN §10.5).
    this.transition(session, "repairing");
    this.emitEvent(session, "replanning.started", {
      mode: "local_astar",
      remainingTargets: remainingTargetIds,
    });

    const localRouteId = `route-local-v${session.environmentVersion}-${randomUUID().slice(0, 8)}`;
    const localResolved = resolveMissionRoute({
      routeId: localRouteId,
      environmentVersion: session.environmentVersion,
      scenario: session.scenario,
      obstacles: session.obstacles,
      targets: session.targets,
      drone: session.drone,
      constraints: session.constraints,
      targetOrder: remainingTargetIds,
      useAdvisorySequence: false,
      engine: session.navEngine,
    });

    if (localResolved.ok) {
      this.emitEvent(session, "route.resolved", {
        routeId: localResolved.route.routeId,
        mode: "local_astar",
        nodeIds: localResolved.route.nodeIds,
        distanceMeters: Number(localResolved.route.distanceMeters.toFixed(2)),
      });

      this.transition(session, "verifying");
      this.emitEvent(session, "verification.started", {
        routeId: localResolved.route.routeId,
      });

      const localReport = verifyRoute({
        routeId: localResolved.route.routeId,
        environmentVersion: session.environmentVersion,
        waypoints: localResolved.route.waypoints,
        returnWaypoints: localResolved.route.returnWaypoints,
        inspectedTargetCount: remainingTargetIds.length,
        drone: session.drone,
        constraints: session.constraints,
        scenario: session.scenario,
        obstacles: session.obstacles,
        windMetersPerSecond: session.windMetersPerSecond,
        policyVersion: VERIFIER_POLICY_VERSION,
      });

      if (localReport.approved) {
        session.route = localResolved.route;
        session.verification = localReport;
        this.transition(session, "ready");
        session.approval = this.approvalGate.issueApproval({
          missionId: session.missionId,
          routeId: localResolved.route.routeId,
          environmentVersion: session.environmentVersion,
          policyVersion: VERIFIER_POLICY_VERSION,
          verification: localReport,
        });
        session.lastReplanOutcome = "local_astar";
        this.emitEvent(session, "verification.passed", {
          routeId: localResolved.route.routeId,
          approvalId: session.approval.approvalId,
          replanOutcome: "local_astar",
          projectedLandingReservePercent: Number(
            localReport.projectedLandingReservePercent.toFixed(2),
          ),
        });
        return;
      }

      session.lastRejectedVerification = localReport;
      session.lastRejectedWaypoints = [...localResolved.route.waypoints];
      priorViolations = localReport.violations;
      this.emitEvent(session, "verification.rejected", {
        routeId: localResolved.route.routeId,
        violations: localReport.violations,
      });
    }

    // 4. Local reroute was unreachable or energy-infeasible -> invoke bounded Gemini replanning (max 2 attempts).
    await this.executePlanAndVerifyCycle(session, {
      isInitialRequest: false,
      priorViolations,
      unreachableInfo: localResolved.ok ? undefined : localResolved.message,
      sceneImageDataUrl: options.sceneImageDataUrl,
    });
  }

  private extractRemainingWaypoints(session: MissionSession): Vector3[] {
    if (!session.route) {
      return [{ ...session.drone.position }, { ...session.drone.position }];
    }
    const startIdx =
      session.flightProgress?.leg === "outbound"
        ? session.flightProgress.segmentIndex + 1
        : session.route.waypoints.length - 1;
    const tail = session.route.waypoints
      .slice(Math.max(1, startIdx))
      .map((p) => ({ ...p }));
    if (tail.length === 0) {
      const end =
        session.route.waypoints[session.route.waypoints.length - 1] ??
        session.drone.position;
      return [{ ...session.drone.position }, { ...end }];
    }
    return [{ ...session.drone.position }, ...tail];
  }

  private applyMutationToSession(
    session: MissionSession,
    event: EnvironmentMutationEvent,
  ): void {
    switch (event.type) {
      case "obstacle.spawned": {
        const preset =
          event.obstacle ??
          session.scenario.chaosObstaclePresets[event.obstacleId];
        if (!preset) {
          throw new AppHttpError(
            400,
            "UNKNOWN_OBSTACLE_PRESET",
            `Unknown obstacleId "${event.obstacleId}" and no explicit obstacle bounds supplied.`,
          );
        }
        const filtered = session.obstacles.filter((o) => o.id !== preset.id);
        session.obstacles = [...filtered, structuredClone(preset)];
        break;
      }
      case "battery.changed": {
        if (
          !Number.isFinite(event.batteryPercent) ||
          event.batteryPercent < 0 ||
          event.batteryPercent > 100
        ) {
          throw new AppHttpError(
            400,
            "INVALID_BATTERY_VALUE",
            "batteryPercent must be between 0 and 100.",
          );
        }
        session.drone = {
          ...session.drone,
          batteryPercent: event.batteryPercent,
        };
        break;
      }
      case "target.discovered": {
        const preset =
          event.target ??
          session.scenario.discoverableTargetPresets[event.targetId];
        if (!preset) {
          throw new AppHttpError(
            400,
            "UNKNOWN_TARGET_PRESET",
            `Unknown discoverable targetId "${event.targetId}".`,
          );
        }
        const existingIdx = session.targets.findIndex(
          (t) => t.id === preset.id,
        );
        if (existingIdx >= 0) {
          session.targets[existingIdx] = {
            ...structuredClone(preset),
            status: "pending",
          };
        } else {
          session.targets.push({
            ...structuredClone(preset),
            status: "pending",
          });
        }
        break;
      }
      case "wind.changed": {
        if (
          !Number.isFinite(event.windMetersPerSecond) ||
          event.windMetersPerSecond < 0 ||
          event.windMetersPerSecond > 35
        ) {
          throw new AppHttpError(
            400,
            "INVALID_WIND_VALUE",
            "windMetersPerSecond must be between 0 and 35.",
          );
        }
        session.windMetersPerSecond = event.windMetersPerSecond;
        break;
      }
    }
  }

  private enterSafeHold(session: MissionSession, reason: string): void {
    this.stopSimulationTicker(session);
    this.approvalGate.revokeMissionApprovals(session.missionId);
    session.approval = null;
    session.lastReplanOutcome = "safe_hold";
    this.transition(session, "safe_hold");
    this.emitEvent(session, "mission.safe_hold", {
      reason,
      dronePosition: { ...session.drone.position },
      batteryPercent: session.drone.batteryPercent,
    });
  }

  private startSimulationTicker(session: MissionSession): void {
    this.stopSimulationTicker(session);
    session.simTimer = setInterval(() => {
      this.stepSessionSimulation(session, this.simulationTickMs / 1000);
    }, this.simulationTickMs);
    session.simTimer.unref?.();
  }

  private stopSimulationTicker(session: MissionSession): void {
    if (session.simTimer) {
      clearInterval(session.simTimer);
      session.simTimer = null;
    }
  }

  private stepSessionSimulation(
    session: MissionSession,
    deltaSeconds: number,
  ): void {
    if (
      session.status !== "executing" ||
      !session.executedRoute ||
      !session.flightProgress ||
      deltaSeconds <= 0
    ) {
      return;
    }

    let remainingMoveMeters =
      session.drone.speedMetersPerSecond * deltaSeconds;
    const energyCfg = session.scenario.energyConfig;
    const windMultiplier =
      1 + session.windMetersPerSecond * energyCfg.windFactorPerMeterPerSecond;

    while (remainingMoveMeters > 1e-6 && session.status === "executing") {
      const activePolyline =
        session.flightProgress.leg === "outbound"
          ? session.executedRoute.waypoints
          : session.executedRoute.returnWaypoints;

      if (
        session.flightProgress.segmentIndex >= activePolyline.length - 1
      ) {
        if (session.flightProgress.leg === "outbound") {
          session.flightProgress.leg = "return";
          session.flightProgress.segmentIndex = 0;
          session.flightProgress.segmentOffsetMeters = 0;
          continue;
        } else {
          // Completed return-to-home leg!
          this.stopSimulationTicker(session);
          this.transition(session, "completed");
          this.emitEvent(session, "simulation.completed", {
            finalBatteryPercent: Number(
              session.drone.batteryPercent.toFixed(2),
            ),
            visitedTargets: session.targets
              .filter((t) => t.status === "visited")
              .map((t) => t.id),
          });
          return;
        }
      }

      const segStart = activePolyline[session.flightProgress.segmentIndex];
      const segEnd = activePolyline[session.flightProgress.segmentIndex + 1];
      if (!segStart || !segEnd) break;

      const segLength = distance(segStart, segEnd);
      if (segLength <= 1e-6) {
        this.markReachedTargetAtPoint(session, segEnd);
        session.flightProgress.segmentIndex += 1;
        session.flightProgress.segmentOffsetMeters = 0;
        continue;
      }

      const dx = segEnd.x - segStart.x;
      const dz = segEnd.z - segStart.z;
      if (Math.hypot(dx, dz) > 1e-4) {
        session.headingRad = Math.atan2(dx, dz);
      }

      const remainingOnSegment =
        segLength - session.flightProgress.segmentOffsetMeters;
      const stepMeters = Math.min(remainingMoveMeters, remainingOnSegment);
      const prevT = session.flightProgress.segmentOffsetMeters / segLength;
      const nextOffset =
        session.flightProgress.segmentOffsetMeters + stepMeters;
      const nextT = Math.min(1, nextOffset / segLength);

      const prevPos = lerp(segStart, segEnd, prevT);
      const nextPos = lerp(segStart, segEnd, nextT);
      const climbed = Math.max(0, nextPos.y - prevPos.y);

      const stepDrain =
        stepMeters * energyCfg.travelPercentPerMeter * windMultiplier +
        climbed * energyCfg.climbPercentPerMeter;

      session.drone = {
        ...session.drone,
        position: nextPos,
        altitudeMeters: nextPos.y,
        batteryPercent: Math.max(0, session.drone.batteryPercent - stepDrain),
      };

      remainingMoveMeters -= stepMeters;

      if (nextOffset >= segLength - 1e-6) {
        if (session.flightProgress.leg === "outbound") {
          this.markReachedTargetAtPoint(session, segEnd);
        }
        session.flightProgress.segmentIndex += 1;
        session.flightProgress.segmentOffsetMeters = 0;
      } else {
        session.flightProgress.segmentOffsetMeters = nextOffset;
      }
    }
  }

  private markReachedTargetAtPoint(
    session: MissionSession,
    point: Vector3,
  ): void {
    if (!session.executedRoute) return;
    for (const targetId of session.executedRoute.targetIds) {
      const target = session.targets.find((t) => t.id === targetId);
      if (
        target &&
        target.status === "pending" &&
        equals(target.position, point, 0.25)
      ) {
        target.status = "visited";
        session.drone = {
          ...session.drone,
          batteryPercent: Math.max(
            0,
            session.drone.batteryPercent -
              session.scenario.energyConfig.inspectionOperationPercent,
          ),
        };
      }
    }
  }

  private createSession(
    missionId: string,
    definition: ScenarioDefinition,
  ): MissionSession {
    const cloned = cloneScenarioSnapshot(definition);
    return {
      missionId,
      scenario: cloned,
      status: "idle",
      instruction: "",
      constraints: { ...cloned.defaultConstraints },
      environmentVersion: 1,
      drone: { ...cloned.initialDrone },
      headingRad: 0,
      windMetersPerSecond: cloned.windMetersPerSecond,
      obstacles: cloned.obstacles.map((o) => structuredClone(o)),
      targets: cloned.targets.map((t) => structuredClone(t)),
      plan: null,
      plannerModel: null,
      plannerLatencyMs: null,
      lastReplanOutcome: "none",
      repairAttemptsUsed: 0,
      route: null,
      executedRoute: null,
      flightProgress: null,
      verification: null,
      lastRejectedVerification: null,
      lastRejectedWaypoints: null,
      approval: null,
      sequenceCounter: 0,
      events: [],
      navEngine: new VersionedNavigationEngine(),
      simTimer: null,
      lockChain: Promise.resolve(),
    };
  }

  private requireSession(missionId: string): MissionSession {
    const session = this.sessions.get(missionId);
    if (!session) {
      throw new AppHttpError(
        404,
        "MISSION_NOT_FOUND",
        `Mission "${missionId}" does not exist.`,
      );
    }
    return session;
  }

  private transition(session: MissionSession, next: MissionStatus): void {
    assertLegalTransition(session.status, next);
    session.status = next;
  }

  private emitEvent<TPayload>(
    session: MissionSession,
    type: MissionEventType,
    payload: TPayload,
  ): MissionEvent<TPayload> {
    session.sequenceCounter += 1;
    const event: MissionEvent<TPayload> = {
      eventId: `evt-${session.sequenceCounter}-${randomUUID().slice(0, 8)}`,
      missionId: session.missionId,
      sequence: session.sequenceCounter,
      occurredAt: new Date().toISOString(),
      type,
      environmentVersion: session.environmentVersion,
      payload,
    };
    session.events.push(event);
    if (session.events.length > 250) {
      session.events.shift();
    }

    const listeners = this.subscribers.get(session.missionId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // Listener errors never affect authoritative mission execution.
        }
      }
    }
    return event;
  }

  private async runExclusive<T>(
    session: MissionSession,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = session.lockChain;
    let release!: () => void;
    session.lockChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private toSnapshot(session: MissionSession): MissionSnapshot {
    return {
      missionId: session.missionId,
      scenarioId: session.scenario.id,
      status: session.status,
      instruction: session.instruction,
      constraints: structuredClone(session.constraints),
      environmentVersion: session.environmentVersion,
      policyVersion: VERIFIER_POLICY_VERSION,
      drone: structuredClone(session.drone),
      headingRad: session.headingRad,
      windMetersPerSecond: session.windMetersPerSecond,
      obstacles: session.obstacles.map((o) => structuredClone(o)),
      targets: session.targets.map((t) => structuredClone(t)),
      plan: session.plan ? structuredClone(session.plan) : null,
      plannerModel: session.plannerModel,
      plannerLatencyMs: session.plannerLatencyMs,
      lastReplanOutcome: session.lastReplanOutcome,
      repairAttemptsUsed: session.repairAttemptsUsed,
      route: session.route ? structuredClone(session.route) : null,
      verification: session.verification
        ? structuredClone(session.verification)
        : null,
      lastRejectedVerification: session.lastRejectedVerification
        ? structuredClone(session.lastRejectedVerification)
        : null,
      lastRejectedWaypoints: session.lastRejectedWaypoints
        ? structuredClone(session.lastRejectedWaypoints)
        : null,
      approval: session.approval ? structuredClone(session.approval) : null,
      events: session.events.map((e) => structuredClone(e)),
    };
  }
}
