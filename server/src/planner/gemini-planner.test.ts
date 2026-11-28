import { describe, expect, it } from "vitest";
import { FLOOD_SCENARIO } from "@aeromind/shared";
import { redactSecrets } from "../errors.js";
import { GeminiMissionPlanner, PlannerProviderError } from "./gemini-planner.js";

describe("GeminiMissionPlanner adapter & secret redaction unit tests", () => {
  it("reports isConfigured=false and fails closed with MISSING_CREDENTIALS when API key is empty", async () => {
    const planner = new GeminiMissionPlanner({
      apiKey: "",
      modelName: "gemini-3.8-flash",
    });

    expect(planner.isConfigured).toBe(false);
    expect(planner.modelName).toBe("gemini-3.8-flash");

    await expect(
      planner.proposeMissionPlan({
        missionId: "m-no-key",
        instruction: "Survey rooftops.",
        constraints: FLOOD_SCENARIO.defaultConstraints,
        drone: FLOOD_SCENARIO.initialDrone,
        windMetersPerSecond: FLOOD_SCENARIO.windMetersPerSecond,
        targets: FLOOD_SCENARIO.targets,
        nodes: FLOOD_SCENARIO.nodes,
        obstacles: FLOOD_SCENARIO.obstacles,
        noFlyZones: FLOOD_SCENARIO.noFlyZones,
        energyConfig: FLOOD_SCENARIO.energyConfig,
        repairAttempt: 0,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof PlannerProviderError &&
        err.code === "MISSING_CREDENTIALS",
    );
  });

  it("redacts both AIza* and AQ.* API key patterns from error messages", () => {
    const raw =
      "Failed with keys AIzaSyDummyKeyValue1234567890 and AQ.Ab8DummyExpressKey1234567890";
    const cleaned = redactSecrets(raw);
    expect(cleaned).not.toContain("AIzaSyDummyKeyValue1234567890");
    expect(cleaned).not.toContain("AQ.Ab8DummyExpressKey1234567890");
    expect(cleaned).toContain("[REDACTED_API_KEY]");
  });
});
