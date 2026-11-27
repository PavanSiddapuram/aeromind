import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FLOOD_SCENARIO } from "@aeromind/shared";
import { MissionOrchestrator } from "../orchestrator/mission-orchestrator.js";
import { GeminiMissionPlanner } from "./gemini-planner.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "..", "..", "..");
dotenv.config({ path: join(repositoryRoot, ".env") });

const planner = new GeminiMissionPlanner();
if (!planner.isConfigured) {
  console.error(
    "SMOKE_SKIP: GEMINI_API_KEY is empty in .env or environment. Add GEMINI_API_KEY to run the live Gemini smoke test.",
  );
  process.exit(2);
}

const orchestrator = new MissionOrchestrator(planner, {
  enableAutoTicker: false,
});

const snapshot = await orchestrator.planMission({
  missionId: "smoke-live-001",
  scenarioId: FLOOD_SCENARIO.id,
  instruction: "Survey the eastern block and prioritize rooftop targets.",
  constraints: FLOOD_SCENARIO.defaultConstraints,
  expectedEnvironmentVersion: 1,
});

console.log(
  JSON.stringify(
    {
      ok: snapshot.status === "ready" && snapshot.approval !== null,
      model: snapshot.plannerModel,
      latencyMs: snapshot.plannerLatencyMs,
      status: snapshot.status,
      plan: snapshot.plan,
      routeNodeIds: snapshot.route?.nodeIds ?? [],
      projectedLandingReservePercent:
        snapshot.verification?.projectedLandingReservePercent ?? null,
      approvalId: snapshot.approval?.approvalId ?? null,
    },
    null,
    2,
  ),
);
