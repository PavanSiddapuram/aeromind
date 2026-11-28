import { describe, expect, it } from "vitest";
import { FLOOD_SCENARIO } from "@aeromind/shared";
import { validateMissionPlanAgainstScenario } from "./plan-validator.js";

const context = {
  targets: FLOOD_SCENARIO.targets.map((t) => ({ ...t })),
  nodes: FLOOD_SCENARIO.nodes,
};

describe("validateMissionPlanAgainstScenario unit tests", () => {
  it("accepts a valid JSON string or object referencing known IDs", () => {
    const validJson = JSON.stringify({
      missionStatus: "planned",
      targetOrder: ["ROOF-02", "ROOF-03"],
      searchPattern: "direct_inspection",
      preferredNodeSequence: ["N-EAST-SOUTH"],
      abortedObjectives: ["ROOF-01"],
      decisionSummary: "Prioritize eastern rooftops.",
    });

    const res = validateMissionPlanAgainstScenario(validJson, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.targetOrder).toEqual(["ROOF-02", "ROOF-03"]);
    }
  });

  it("strips optional markdown json code fences while parsing strictly", () => {
    const fenced = [
      "```json",
      JSON.stringify({
        missionStatus: "partial",
        targetOrder: ["ROOF-02"],
        searchPattern: "perimeter_scan",
        preferredNodeSequence: [],
        abortedObjectives: ["ROOF-04"],
        decisionSummary: "Partial scan.",
      }),
      "```",
    ].join("\n");

    const res = validateMissionPlanAgainstScenario(fenced, context);
    expect(res.ok).toBe(true);
  });

  it("rejects empty or non-JSON strings with MALFORMED_OUTPUT", () => {
    expect(validateMissionPlanAgainstScenario("", context)).toMatchObject({
      ok: false,
      reason: "MALFORMED_OUTPUT",
    });
    expect(
      validateMissionPlanAgainstScenario("{invalid json", context),
    ).toMatchObject({
      ok: false,
      reason: "MALFORMED_OUTPUT",
    });
  });

  it("rejects objects with unrecognized keys or invalid enums", () => {
    const extraKey = {
      missionStatus: "planned",
      targetOrder: ["ROOF-02"],
      searchPattern: "direct_inspection",
      preferredNodeSequence: [],
      abortedObjectives: [],
      decisionSummary: "Summary.",
      waypoints: [{ x: 1, y: 2, z: 3 }],
    };

    const res = validateMissionPlanAgainstScenario(extraKey, context);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("MALFORMED_OUTPUT");
    }
  });

  it("rejects duplicate target IDs in targetOrder", () => {
    const dup = validateMissionPlanAgainstScenario(
      {
        missionStatus: "planned",
        targetOrder: ["ROOF-02", "ROOF-02"],
        searchPattern: "direct_inspection",
        preferredNodeSequence: [],
        abortedObjectives: [],
        decisionSummary: "Duplicate target.",
      },
      context,
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.reason).toBe("DOMAIN_INVALID");
    }
  });

  it("rejects non-pending (visited or abandoned) targets in targetOrder", () => {
    const visitedCtx = {
      nodes: FLOOD_SCENARIO.nodes,
      targets: FLOOD_SCENARIO.targets.map((t) =>
        t.id === "ROOF-02" ? { ...t, status: "visited" as const } : { ...t },
      ),
    };

    const res = validateMissionPlanAgainstScenario(
      {
        missionStatus: "planned",
        targetOrder: ["ROOF-02"],
        searchPattern: "direct_inspection",
        preferredNodeSequence: [],
        abortedObjectives: [],
        decisionSummary: "Tries already visited target.",
      },
      visitedCtx,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("DOMAIN_INVALID");
      expect(res.issues.join(" ")).toContain("not pending");
    }
  });

  it("rejects overlap between targetOrder and abortedObjectives", () => {
    const res = validateMissionPlanAgainstScenario(
      {
        missionStatus: "partial",
        targetOrder: ["ROOF-02"],
        searchPattern: "direct_inspection",
        preferredNodeSequence: [],
        abortedObjectives: ["ROOF-02"],
        decisionSummary: "Contradictory plan.",
      },
      context,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("DOMAIN_INVALID");
    }
  });

  it("rejects unknown target IDs in abortedObjectives and unknown node IDs in preferredNodeSequence", () => {
    const res = validateMissionPlanAgainstScenario(
      {
        missionStatus: "partial",
        targetOrder: ["ROOF-02"],
        searchPattern: "direct_inspection",
        preferredNodeSequence: ["N-UNKNOWN"],
        abortedObjectives: ["ROOF-UNKNOWN"],
        decisionSummary: "Hallucinated IDs.",
      },
      context,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("DOMAIN_INVALID");
      expect(res.issues.length).toBe(2);
    }
  });

  it("enforces missionStatus vs targetOrder cardinality invariants", () => {
    const emptyPlanned = validateMissionPlanAgainstScenario(
      {
        missionStatus: "planned",
        targetOrder: [],
        searchPattern: "direct_inspection",
        preferredNodeSequence: [],
        abortedObjectives: [],
        decisionSummary: "Empty planned.",
      },
      context,
    );
    expect(emptyPlanned.ok).toBe(false);

    const nonEmptyAborted = validateMissionPlanAgainstScenario(
      {
        missionStatus: "aborted",
        targetOrder: ["ROOF-02"],
        searchPattern: "direct_inspection",
        preferredNodeSequence: [],
        abortedObjectives: [],
        decisionSummary: "Aborted with targets.",
      },
      context,
    );
    expect(nonEmptyAborted.ok).toBe(false);
  });
});
