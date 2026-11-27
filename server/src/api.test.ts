import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { MissionPlan } from "@aeromind/shared";
import { buildServerApp } from "./app.js";
import {
  PlannerProviderError,
  type MissionPlanner,
  type PlannerOutput,
  type PlannerRequestContext,
} from "./planner/gemini-planner.js";

class MockPlanner implements MissionPlanner {
  readonly providerName = "mock-planner";
  readonly isConfigured = true;
  readonly modelName = "mock-gemini";

  constructor(
    private readonly responder: (ctx: PlannerRequestContext) => unknown,
  ) {}

  async proposeMissionPlan(ctx: PlannerRequestContext): Promise<PlannerOutput> {
    return {
      rawOutput: this.responder(ctx),
      modelName: this.modelName,
      latencyMs: 3,
    };
  }
}

describe("Fastify REST & SSE API contract tests", () => {
  let activeApp: FastifyInstance | null = null;

  afterEach(async () => {
    if (activeApp) {
      await activeApp.close();
      activeApp = null;
    }
  });

  it("GET /api/health returns 200 without leaking secrets", async () => {
    process.env.GEMINI_API_KEY = "AIzaSySuperSecretTestValue123456";
    const { app } = await buildServerApp({
      enableAutoTicker: false,
      serveStaticWeb: false,
    });
    activeApp = app;

    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("AIzaSySuperSecretTestValue123456");
    const json = res.json() as { status: string; planner: { configured: boolean } };
    expect(json.status).toBe("ok");
    expect(json.planner.configured).toBe(true);
    delete process.env.GEMINI_API_KEY;
  });

  it("returns 400 on malformed request bodies and client tampering attempts on /api/mission/verify", async () => {
    const planner = new MockPlanner(
      (): MissionPlan => ({
        missionStatus: "planned",
        targetOrder: ["ROOF-02"],
        searchPattern: "direct_inspection",
        preferredNodeSequence: [],
        abortedObjectives: [],
        decisionSummary: "Valid plan.",
      }),
    );
    const { app } = await buildServerApp({
      planner,
      enableAutoTicker: false,
      serveStaticWeb: false,
    });
    activeApp = app;

    const badPlanReq = await app.inject({
      method: "POST",
      url: "/api/mission/plan",
      payload: { missionId: "" },
    });
    expect(badPlanReq.statusCode).toBe(400);

    // Client tries to inject approved: true or custom waypoints into /api/mission/verify
    const tamperedVerify = await app.inject({
      method: "POST",
      url: "/api/mission/verify",
      payload: {
        missionId: "m-1",
        routeId: "r-1",
        expectedEnvironmentVersion: 1,
        approved: true,
        waypoints: [{ x: 0, y: 10, z: 0 }],
      },
    });
    expect(tamperedVerify.statusCode).toBe(400);
  });

  it("returns 404 for unknown mission and unknown scenario", async () => {
    const { app } = await buildServerApp({
      enableAutoTicker: false,
      serveStaticWeb: false,
    });
    activeApp = app;

    const unknownMission = await app.inject({
      method: "GET",
      url: "/api/mission/does-not-exist",
    });
    expect(unknownMission.statusCode).toBe(404);

    const unknownScenario = await app.inject({
      method: "POST",
      url: "/api/mission/plan",
      payload: {
        missionId: "m-404",
        scenarioId: "mars-crater-99",
        instruction: "Survey craters.",
        constraints: { maxAltitudeMeters: 40, minLandingReservePercent: 20 },
        expectedEnvironmentVersion: 1,
      },
    });
    expect(unknownScenario.statusCode).toBe(404);
  });

  it("returns 422 when Gemini returns hallucinated target or node IDs, and fails closed", async () => {
    const hallucinatingPlanner = new MockPlanner(() => ({
      missionStatus: "planned",
      targetOrder: ["ROOF-999-HALLUCINATED"],
      searchPattern: "direct_inspection",
      preferredNodeSequence: ["N-FAKE-NODE"],
      abortedObjectives: [],
      decisionSummary: "Invented IDs.",
    }));

    const { app } = await buildServerApp({
      planner: hallucinatingPlanner,
      enableAutoTicker: false,
      serveStaticWeb: false,
    });
    activeApp = app;

    const res = await app.inject({
      method: "POST",
      url: "/api/mission/plan",
      payload: {
        missionId: "m-422",
        scenarioId: "flood-block-a",
        instruction: "Inspect eastern rooftops.",
        constraints: { maxAltitudeMeters: 40, minLandingReservePercent: 20 },
        expectedEnvironmentVersion: 1,
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DOMAIN_INVALID_PLAN");

    const stateRes = await app.inject({
      method: "GET",
      url: "/api/mission/m-422",
    });
    expect(stateRes.json().status).toBe("failed");
    expect(stateRes.json().approval).toBeNull();
  });

  it("returns 422 on malformed non-JSON model output and 503 safe_hold on provider failure", async () => {
    let failWithTimeout = false;
    const flakyPlanner = new MockPlanner(() => {
      if (failWithTimeout) {
        throw new PlannerProviderError(
          "PROVIDER_TIMEOUT",
          "Request timed out with secret AIzaSyHidden12345678901234",
        );
      }
      return "{truncated json";
    });

    const { app } = await buildServerApp({
      planner: flakyPlanner,
      enableAutoTicker: false,
      serveStaticWeb: false,
    });
    activeApp = app;

    const malformedRes = await app.inject({
      method: "POST",
      url: "/api/mission/plan",
      payload: {
        missionId: "m-malformed",
        scenarioId: "flood-block-a",
        instruction: "Survey rooftops.",
        constraints: { maxAltitudeMeters: 40, minLandingReservePercent: 20 },
        expectedEnvironmentVersion: 1,
      },
    });
    expect(malformedRes.statusCode).toBe(422);
    expect(malformedRes.json().error.code).toBe("MALFORMED_PLANNER_OUTPUT");

    failWithTimeout = true;
    const timeoutRes = await app.inject({
      method: "POST",
      url: "/api/mission/plan",
      payload: {
        missionId: "m-timeout-api",
        scenarioId: "flood-block-a",
        instruction: "Survey rooftops.",
        constraints: { maxAltitudeMeters: 40, minLandingReservePercent: 20 },
        expectedEnvironmentVersion: 1,
      },
    });
    expect(timeoutRes.statusCode).toBe(503);
    expect(timeoutRes.body).not.toContain("AIzaSyHidden");
  });

  it("returns 409 on stale environment version and streams monotonic SSE events without altering mission state on disconnect", async () => {
    const planner = new MockPlanner(
      (): MissionPlan => ({
        missionStatus: "planned",
        targetOrder: ["ROOF-02"],
        searchPattern: "direct_inspection",
        preferredNodeSequence: [],
        abortedObjectives: [],
        decisionSummary: "Survey East Shelter.",
      }),
    );

    const { app } = await buildServerApp({
      planner,
      enableAutoTicker: false,
      serveStaticWeb: false,
    });
    activeApp = app;

    const planRes = await app.inject({
      method: "POST",
      url: "/api/mission/plan",
      payload: {
        missionId: "m-sse",
        scenarioId: "flood-block-a",
        instruction: "Survey East Shelter.",
        constraints: { maxAltitudeMeters: 40, minLandingReservePercent: 20 },
        expectedEnvironmentVersion: 1,
      },
    });
    expect(planRes.statusCode).toBe(200);

    // Send stale environment version (99 != 1)
    const staleEventRes = await app.inject({
      method: "POST",
      url: "/api/mission/event",
      payload: {
        missionId: "m-sse",
        expectedEnvironmentVersion: 99,
        event: { type: "obstacle.spawned", obstacleId: "crane-01" },
      },
    });
    expect(staleEventRes.statusCode).toBe(409);
    expect(staleEventRes.json().error.code).toBe("STALE_ENVIRONMENT_VERSION");

    // Verify monotonic sequence numbers in buffered SSE / state events
    const stateBefore = await app.inject({
      method: "GET",
      url: "/api/mission/m-sse",
    });
    const events = stateBefore.json().events as { sequence: number }[];
    expect(events.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]!.sequence).toBe(events[i - 1]!.sequence + 1);
    }

    // Bind ephemeral port briefly to test real HTTP SSE connect + client abort
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const abortController = new AbortController();
    const sseResponse = await fetch(`${address}/api/mission/m-sse/events`, {
      signal: abortController.signal,
    });
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get("content-type")).toContain(
      "text/event-stream",
    );

    const reader = sseResponse.body?.getReader();
    const firstChunk = await reader?.read();
    const text = new TextDecoder().decode(firstChunk?.value);
    expect(text).toContain('"sequence":1');

    // Disconnect SSE client and confirm mission state is still "ready"
    abortController.abort();
    const stateAfter = await app.inject({
      method: "GET",
      url: "/api/mission/m-sse",
    });
    expect(stateAfter.json().status).toBe("ready");
    expect(stateAfter.json().approval).not.toBeNull();
  });

  it("serves built Vite frontend assets at GET / when serveStaticWeb is enabled", async () => {
    const { app } = await buildServerApp({
      enableAutoTicker: false,
      serveStaticWeb: true,
    });
    activeApp = app;

    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('<div id="root"></div>');
  });
});
