import type { MissionStatus } from "@aeromind/shared";
import { AppHttpError } from "../errors.js";

export const LEGAL_MISSION_TRANSITIONS: Record<
  MissionStatus,
  readonly MissionStatus[]
> = {
  idle: ["planning"],
  planning: ["resolving", "repairing", "safe_hold", "aborted", "failed"],
  resolving: ["verifying", "repairing", "safe_hold", "failed"],
  verifying: ["ready", "repairing", "safe_hold", "failed"],
  repairing: ["resolving", "verifying", "ready", "safe_hold", "aborted", "failed"],
  ready: ["executing", "paused", "verifying", "repairing", "planning", "safe_hold"],
  executing: ["paused", "completed", "safe_hold", "failed"],
  paused: ["verifying", "resolving", "repairing", "ready", "planning", "safe_hold", "aborted", "failed"],
  completed: ["planning", "idle"],
  safe_hold: ["planning", "idle"],
  aborted: ["planning", "idle"],
  failed: ["planning", "idle"],
};

export function canTransition(from: MissionStatus, to: MissionStatus): boolean {
  if (from === to) return true;
  return LEGAL_MISSION_TRANSITIONS[from].includes(to);
}

export function assertLegalTransition(
  from: MissionStatus,
  to: MissionStatus,
): void {
  if (!canTransition(from, to)) {
    throw new AppHttpError(
      409,
      "INVALID_STATE_TRANSITION",
      `Illegal mission state transition from "${from}" to "${to}".`,
    );
  }
}
