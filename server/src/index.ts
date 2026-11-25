import "dotenv/config";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify from "fastify";

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
    : true,
});
await app.register(sensible);

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
