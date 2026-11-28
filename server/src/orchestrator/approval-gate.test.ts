import { describe, expect, it } from "vitest";
import { VERIFIER_POLICY_VERSION, type VerificationReport } from "@aeromind/shared";
import { AppHttpError } from "../errors.js";
import { ApprovalGate } from "./approval-gate.js";

function makeReport(overrides?: Partial<VerificationReport>): VerificationReport {
  return {
    routeId: "route-1",
    environmentVersion: 1,
    policyVersion: VERIFIER_POLICY_VERSION,
    approved: true,
    violations: [],
    estimatedMissionEnergyPercent: 20,
    estimatedReturnEnergyPercent: 18,
    projectedLandingReservePercent: 58,
    energy: {
      missionTravelPercent: 14,
      missionClimbPercent: 2,
      missionWindPercent: 0,
      missionOperationPercent: 4,
      estimatedMissionEnergyPercent: 20,
      estimatedReturnEnergyPercent: 18,
      requiredReservePercent: 20,
      availableBatteryPercent: 96,
      projectedLandingReservePercent: 58,
      feasible: true,
    },
    verifiedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ApprovalGate invariants (INV-01, INV-02, INV-08)", () => {
  it("refuses to mint an approval for an unapproved or version-mismatched verification report", () => {
    const gate = new ApprovalGate();

    expect(() =>
      gate.issueApproval({
        missionId: "m-1",
        routeId: "route-1",
        environmentVersion: 1,
        policyVersion: VERIFIER_POLICY_VERSION,
        verification: makeReport({ approved: false }),
      }),
    ).toThrow(AppHttpError);

    expect(() =>
      gate.issueApproval({
        missionId: "m-1",
        routeId: "route-1",
        environmentVersion: 2,
        policyVersion: VERIFIER_POLICY_VERSION,
        verification: makeReport({ environmentVersion: 1 }),
      }),
    ).toThrow(AppHttpError);
  });

  it("enforces single-use consumption, route binding, version binding, and revocation", () => {
    const gate = new ApprovalGate();
    const approval = gate.issueApproval({
      missionId: "m-1",
      routeId: "route-1",
      environmentVersion: 1,
      policyVersion: VERIFIER_POLICY_VERSION,
      verification: makeReport(),
    });

    // Wrong routeId rejected
    expect(() =>
      gate.authorizeExecution({
        missionId: "m-1",
        routeId: "route-other",
        approvalId: approval.approvalId,
        expectedEnvironmentVersion: 1,
        currentEnvironmentVersion: 1,
        currentPolicyVersion: VERIFIER_POLICY_VERSION,
        missionStatus: "ready",
      }),
    ).toThrow(AppHttpError);

    // Wrong missionStatus rejected
    expect(() =>
      gate.authorizeExecution({
        missionId: "m-1",
        routeId: "route-1",
        approvalId: approval.approvalId,
        expectedEnvironmentVersion: 1,
        currentEnvironmentVersion: 1,
        currentPolicyVersion: VERIFIER_POLICY_VERSION,
        missionStatus: "paused",
      }),
    ).toThrow(AppHttpError);

    // Valid consumption succeeds once
    const consumed = gate.authorizeExecution({
      missionId: "m-1",
      routeId: "route-1",
      approvalId: approval.approvalId,
      expectedEnvironmentVersion: 1,
      currentEnvironmentVersion: 1,
      currentPolicyVersion: VERIFIER_POLICY_VERSION,
      missionStatus: "ready",
    });
    expect(consumed.consumedAt).toBeDefined();

    // Second replay attempt fails closed
    expect(() =>
      gate.authorizeExecution({
        missionId: "m-1",
        routeId: "route-1",
        approvalId: approval.approvalId,
        expectedEnvironmentVersion: 1,
        currentEnvironmentVersion: 1,
        currentPolicyVersion: VERIFIER_POLICY_VERSION,
        missionStatus: "ready",
      }),
    ).toThrow(AppHttpError);
  });

  it("revokes active approvals when the environment mutates", () => {
    const gate = new ApprovalGate();
    const approval = gate.issueApproval({
      missionId: "m-rev",
      routeId: "route-1",
      environmentVersion: 1,
      policyVersion: VERIFIER_POLICY_VERSION,
      verification: makeReport(),
    });

    expect(gate.revokeMissionApprovals("m-rev")).toBe(1);

    expect(() =>
      gate.authorizeExecution({
        missionId: "m-rev",
        routeId: "route-1",
        approvalId: approval.approvalId,
        expectedEnvironmentVersion: 2,
        currentEnvironmentVersion: 2,
        currentPolicyVersion: VERIFIER_POLICY_VERSION,
        missionStatus: "ready",
      }),
    ).toThrow(AppHttpError);
  });
});
