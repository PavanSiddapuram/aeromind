import { z } from "zod";
import type {
  MissionPlan,
  NavigationNode,
  RescueTarget,
} from "@aeromind/shared";

export const MissionPlanSchema = z
  .object({
    missionStatus: z.enum(["planned", "partial", "aborted"]),
    targetOrder: z.array(z.string().min(1).max(64)).max(16),
    searchPattern: z.enum([
      "perimeter_scan",
      "grid_scan",
      "direct_inspection",
    ]),
    preferredNodeSequence: z.array(z.string().min(1).max(64)).max(32),
    abortedObjectives: z.array(z.string().min(1).max(64)).max(16),
    decisionSummary: z.string().trim().min(1).max(1200),
  })
  .strict();

export type PlanValidationResult =
  | {
      ok: true;
      plan: MissionPlan;
    }
  | {
      ok: false;
      reason: "MALFORMED_OUTPUT" | "DOMAIN_INVALID";
      issues: string[];
    };

export function validateMissionPlanAgainstScenario(
  rawInput: unknown,
  context: {
    targets: RescueTarget[];
    nodes: NavigationNode[];
  },
): PlanValidationResult {
  let parsedJson: unknown = rawInput;

  if (typeof rawInput === "string") {
    let trimmed = rawInput.trim();
    if (trimmed.startsWith("```")) {
      trimmed = trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
    }
    if (!trimmed) {
      return {
        ok: false,
        reason: "MALFORMED_OUTPUT",
        issues: ["Planner returned an empty response body."],
      };
    }
    try {
      parsedJson = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        reason: "MALFORMED_OUTPUT",
        issues: ["Planner output is not valid JSON."],
      };
    }
  }

  const schemaCheck = MissionPlanSchema.safeParse(parsedJson);
  if (!schemaCheck.success) {
    const issues = schemaCheck.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
    );
    return {
      ok: false,
      reason: "MALFORMED_OUTPUT",
      issues,
    };
  }

  const candidate = schemaCheck.data;
  const issues: string[] = [];

  const allTargetsById = new Map(context.targets.map((t) => [t.id, t]));
  const knownNodeIds = new Set(context.nodes.map((n) => n.id));

  const seenTargets = new Set<string>();
  for (const targetId of candidate.targetOrder) {
    if (seenTargets.has(targetId)) {
      issues.push(`Duplicate target ID in targetOrder: ${targetId}`);
      continue;
    }
    seenTargets.add(targetId);

    const target = allTargetsById.get(targetId);
    if (!target) {
      issues.push(`Unknown target ID in targetOrder: ${targetId}`);
    } else if (target.status !== "pending") {
      issues.push(
        `Target ${targetId} is not pending (current status: ${target.status}).`,
      );
    }
  }

  const seenAborted = new Set<string>();
  for (const abortedId of candidate.abortedObjectives) {
    if (seenAborted.has(abortedId)) {
      issues.push(`Duplicate target ID in abortedObjectives: ${abortedId}`);
      continue;
    }
    seenAborted.add(abortedId);

    if (!allTargetsById.has(abortedId)) {
      issues.push(`Unknown target ID in abortedObjectives: ${abortedId}`);
    }
    if (seenTargets.has(abortedId)) {
      issues.push(
        `Target ${abortedId} cannot appear in both targetOrder and abortedObjectives.`,
      );
    }
  }

  for (const nodeId of candidate.preferredNodeSequence) {
    if (!knownNodeIds.has(nodeId)) {
      issues.push(`Unknown navigation node ID in preferredNodeSequence: ${nodeId}`);
    }
  }

  if (
    (candidate.missionStatus === "planned" ||
      candidate.missionStatus === "partial") &&
    candidate.targetOrder.length === 0
  ) {
    issues.push(
      `missionStatus "${candidate.missionStatus}" requires at least one target in targetOrder.`,
    );
  }

  if (
    candidate.missionStatus === "aborted" &&
    candidate.targetOrder.length > 0
  ) {
    issues.push(
      'missionStatus "aborted" must have an empty targetOrder array.',
    );
  }

  if (issues.length > 0) {
    return {
      ok: false,
      reason: "DOMAIN_INVALID",
      issues,
    };
  }

  return {
    ok: true,
    plan: candidate,
  };
}
