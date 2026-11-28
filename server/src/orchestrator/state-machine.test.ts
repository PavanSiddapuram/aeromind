import { describe, expect, it } from "vitest";
import { AppHttpError } from "../errors.js";
import { assertLegalTransition, canTransition } from "./state-machine.js";

describe("Mission state machine legal transition rules", () => {
  it("allows legal lifecycle transitions across planning, verification, execution, pause, and recovery", () => {
    expect(canTransition("idle", "planning")).toBe(true);
    expect(canTransition("planning", "resolving")).toBe(true);
    expect(canTransition("resolving", "verifying")).toBe(true);
    expect(canTransition("verifying", "ready")).toBe(true);
    expect(canTransition("ready", "executing")).toBe(true);
    expect(canTransition("executing", "paused")).toBe(true);
    expect(canTransition("paused", "verifying")).toBe(true);
    expect(canTransition("paused", "repairing")).toBe(true);
    expect(canTransition("repairing", "safe_hold")).toBe(true);
    expect(canTransition("executing", "completed")).toBe(true);
  });

  it("rejects illegal direct shortcuts that bypass planning or verification", () => {
    expect(canTransition("idle", "executing")).toBe(false);
    expect(canTransition("planning", "executing")).toBe(false);
    expect(canTransition("resolving", "ready")).toBe(false);
    expect(canTransition("safe_hold", "executing")).toBe(false);
    expect(canTransition("failed", "executing")).toBe(false);

    expect(() => assertLegalTransition("idle", "executing")).toThrow(
      AppHttpError,
    );
    expect(() => assertLegalTransition("safe_hold", "executing")).toThrow(
      AppHttpError,
    );
  });
});
