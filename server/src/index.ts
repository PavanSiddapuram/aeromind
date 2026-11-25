import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import sensible from "@fastify/sensible";
import Fastify from "fastify";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "..", "..");
dotenv.config({ path: join(repositoryRoot, ".env") });

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["req.headers.authorization", "req.headers.cookie"],
  },
  requestTimeout: 30_000,
  bodyLimit: 2 * 1024 * 1024,
});

await app.register(cors, {
  origin: process.env.WEB_ORIGIN
    ? process.env.WEB_ORIGIN.split(",").map((value) => value.trim())
    : false,
});
await app.register(sensible);

// In production the Vite build is copied to apps/web/dist. During local development,
// Vite serves the UI separately and proxies /api to this process.
const webRoot = join(repositoryRoot, "apps", "web", "dist");
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, {
    root: webRoot,
    prefix: "/",
  });
  app.get("/", async (_request, reply) => reply.sendFile("index.html"));
}

app.get("/api/health", async () => ({
  status: "ok",
  service: "aeromind-api",
  environment: process.env.NODE_ENV ?? "development",
  timestamp: new Date().toISOString(),
}));

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error, "API failed to start");
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error, "Graceful shutdown failed");
    process.exit(1);
  }
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
