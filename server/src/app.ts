import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { FLOOD_SCENARIO } from "@aeromind/shared";
import { AppHttpError, redactSecrets } from "./errors.js";
import { MissionOrchestrator } from "./orchestrator/mission-orchestrator.js";
import {
  GeminiMissionPlanner,
  type MissionPlanner,
} from "./planner/gemini-planner.js";

const PlanRequestSchema = z
  .object({
    missionId: z.string().trim().min(1).max(80),
    scenarioId: z.string().trim().min(1).max(80),
    instruction: z.string().trim().min(3).max(1500),
    constraints: z
      .object({
        maxAltitudeMeters: z.number().finite().min(10).max(120),
        minLandingReservePercent: z.number().finite().min(5).max(80),
      })
      .strict(),
    expectedEnvironmentVersion: z.number().int().min(1),
    sceneImageDataUrl: z.string().max(1_400_000).optional(),
  })
  .strict();

// Server-authoritative verify request: rejects client-injected waypoints/approved flags.
const VerifyRequestSchema = z
  .object({
    missionId: z.string().trim().min(1).max(80),
    routeId: z.string().trim().min(1).max(120),
    expectedEnvironmentVersion: z.number().int().min(1),
  })
  .strict();

const ExecuteRequestSchema = z
  .object({
    missionId: z.string().trim().min(1).max(80),
    routeId: z.string().trim().min(1).max(120),
    approvalId: z.string().trim().min(1).max(120),
    expectedEnvironmentVersion: z.number().int().min(1),
  })
  .strict();

const Vector3Schema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  })
  .strict();

const AABBSchema = z
  .object({
    min: Vector3Schema,
    max: Vector3Schema,
  })
  .strict();

const MutationEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("obstacle.spawned"),
      obstacleId: z.string().trim().min(1).max(80),
      obstacle: z
        .object({
          id: z.string().trim().min(1).max(80),
          label: z.string().trim().min(1).max(120),
          kind: z.enum(["building", "dynamic_hazard"]),
          bounds: AABBSchema,
          colorHex: z.number().int().nonnegative(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("battery.changed"),
      batteryPercent: z.number().finite().min(0).max(100),
      reason: z.string().max(200).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("target.discovered"),
      targetId: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({
      type: z.literal("wind.changed"),
      windMetersPerSecond: z.number().finite().min(0).max(35),
    })
    .strict(),
]);

const EnvironmentEventRequestSchema = z
  .object({
    missionId: z.string().trim().min(1).max(80),
    expectedEnvironmentVersion: z.number().int().min(1),
    event: MutationEventSchema,
    autoReplan: z.boolean().optional(),
    sceneImageDataUrl: z.string().max(1_400_000).optional(),
  })
  .strict();

function parseBodyOrThrow<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((i) => `${i.path.join(".") || "<body >"}: ${i.message}`)
      .join("; ");
    throw new AppHttpError(400, "INVALID_REQUEST", summary);
  }
  return parsed.data;
}

export type BuildAppOptions = {
  planner?: MissionPlanner | undefined;
  orchestrator?: MissionOrchestrator | undefined;
  enableAutoTicker?: boolean | undefined;
  rateLimitMaxPerMinute?: number | undefined;
  serveStaticWeb?: boolean | undefined;
};

export async function buildServerApp(
  options: BuildAppOptions = {},
): Promise<{
  app: FastifyInstance;
  orchestrator: MissionOrchestrator;
}> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(moduleDirectory, "..", "..");

  const planner = options.planner ?? new GeminiMissionPlanner();
  const orchestrator =
    options.orchestrator ??
    new MissionOrchestrator(planner, {
      enableAutoTicker: options.enableAutoTicker ?? true,
    });

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    requestTimeout: 60_000,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: process.env.WEB_ORIGIN
      ? process.env.WEB_ORIGIN.split(",").map((value) => value.trim())
      : false,
  });
  await app.register(sensible);

  // Simple sliding-window per-IP rate guard for Gemini-backed endpoints.
  const rateLimitMax = options.rateLimitMaxPerMinute ?? 30;
  const recentPlanCalls = new Map<string, number[]>();
  const checkPlanRateLimit = (ip: string) => {
    const now = Date.now();
    const windowStart = now - 60_000;
    const timestamps = (recentPlanCalls.get(ip) ?? []).filter(
      (t) => t > windowStart,
    );
    if (timestamps.length >= rateLimitMax) {
      throw new AppHttpError(
        429,
        "RATE_LIMITED",
        "Too many mission planning requests; please wait a moment and retry.",
      );
    }
    timestamps.push(now);
    recentPlanCalls.set(ip, timestamps);
  };

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppHttpError) {
      request.log.warn(
        { errCode: error.code, statusCode: error.statusCode },
        error.message,
      );
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: redactSecrets(error.message),
          requestId: request.id,
        },
        ...(error.details && typeof error.details === "object"
          ? error.details
          : {}),
      });
    }

    const fastifyErr = error as { statusCode?: number; message?: string };
    const statusCode =
      fastifyErr.statusCode && fastifyErr.statusCode >= 400 && fastifyErr.statusCode < 500
        ? fastifyErr.statusCode
        : 500;
    const safeMessage = redactSecrets(
      fastifyErr.message ?? "Unexpected server error",
    );

    request.log.error({ statusCode }, safeMessage);
    return reply.status(statusCode).send({
      error: {
        code: statusCode === 400 ? "INVALID_REQUEST" : "INTERNAL_SERVER_ERROR",
        message: safeMessage,
        requestId: request.id,
      },
    });
  });

  app.get("/api/health", async () => ({
    status: "ok",
    service: "aeromind-api",
    environment: process.env.NODE_ENV ?? "development",
    planner: orchestrator.plannerInfo,
    timestamp: new Date().toISOString(),
  }));

  app.get("/api/scenario", async () => ({
    scenario: FLOOD_SCENARIO,
  }));

  app.get<{ Params: { missionId: string } }>(
    "/api/mission/:missionId",
    async (request) => {
      return orchestrator.getMissionSnapshot(request.params.missionId);
    },
  );

  app.post<{ Params: { missionId: string } }>(
    "/api/mission/:missionId/reset",
    async (request) => {
      return orchestrator.resetMission(request.params.missionId);
    },
  );

  app.post("/api/mission/plan", async (request) => {
    checkPlanRateLimit(request.ip);
    const payload = parseBodyOrThrow(PlanRequestSchema, request.body);
    const snapshot = await orchestrator.planMission(payload);
    return {
      missionId: snapshot.missionId,
      status: snapshot.status,
      eventStream: `/api/mission/${snapshot.missionId}/events`,
      mission: snapshot,
    };
  });

  app.post("/api/mission/verify", async (request) => {
    const payload = parseBodyOrThrow(VerifyRequestSchema, request.body);
    return orchestrator.verifyStoredRoute(payload);
  });

  app.post("/api/mission/event", async (request) => {
    const payload = parseBodyOrThrow(
      EnvironmentEventRequestSchema,
      request.body,
    );
    const snapshot = await orchestrator.applyEnvironmentEvent(payload);
    return {
      missionId: snapshot.missionId,
      status: snapshot.status,
      environmentVersion: snapshot.environmentVersion,
      mission: snapshot,
    };
  });

  app.post("/api/mission/execute", async (request) => {
    const payload = parseBodyOrThrow(ExecuteRequestSchema, request.body);
    const snapshot = await orchestrator.authorizeExecution(payload);
    return {
      missionId: snapshot.missionId,
      status: snapshot.status,
      environmentVersion: snapshot.environmentVersion,
      mission: snapshot,
    };
  });

  app.get<{ Params: { missionId: string } }>(
    "/api/mission/:missionId/events",
    async (request, reply) => {
      const { missionId } = request.params;
      request.raw.setTimeout(0);
      reply.raw.socket?.setTimeout(0);
      reply.hijack();

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const writeSse = (event: unknown, eventId?: string) => {
        if (reply.raw.writableEnded) return;
        if (eventId) {
          reply.raw.write(`id: ${eventId}\n`);
        }
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // Replay buffered events in monotonic sequence order on connect/reconnect.
      for (const existing of orchestrator.getExistingEvents(missionId)) {
        writeSse(existing, existing.eventId);
      }

      const unsubscribe = orchestrator.subscribe(missionId, (liveEvent) => {
        writeSse(liveEvent, liveEvent.eventId);
      });

      const keepAlive = setInterval(() => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(": keepalive\n\n");
        }
      }, 15_000);
      keepAlive.unref?.();

      request.raw.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
    },
  );

  if (options.serveStaticWeb ?? true) {
    const webRoot = join(repositoryRoot, "apps", "web", "dist");
    if (existsSync(webRoot)) {
      await app.register(fastifyStatic, {
        root: webRoot,
        prefix: "/",
      });
      app.get("/", async (_request, reply) => reply.sendFile("index.html"));
    }
  }

  app.addHook("onClose", async () => {
    orchestrator.shutdownAll();
  });

  return { app, orchestrator };
}
