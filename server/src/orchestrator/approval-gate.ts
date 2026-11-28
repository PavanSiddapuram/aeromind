import { randomUUID } from "node:crypto";
import type {
  MissionStatus,
  RouteApproval,
  VerificationReport,
} from "@aeromind/shared";
import { AppHttpError } from "../errors.js";

export class ApprovalGate {
  private readonly approvals = new Map<string, RouteApproval>();

  issueApproval(params: {
    missionId: string;
    routeId: string;
    environmentVersion: number;
    policyVersion: string;
    verification: VerificationReport;
    now?: (() => string) | undefined;
  }): RouteApproval {
    const {
      missionId,
      routeId,
      environmentVersion,
      policyVersion,
      verification,
      now,
    } = params;

    // INV-01 & INV-02: Never issue approval unless deterministic verification passed
    // for the exact route, environment version, and policy version.
    if (
      !verification.approved ||
      verification.violations.length > 0 ||
      verification.routeId !== routeId ||
      verification.environmentVersion !== environmentVersion ||
      verification.policyVersion !== policyVersion
    ) {
      throw new AppHttpError(
        409,
        "UNVERIFIED_ROUTE",
        "Cannot issue execution approval for an unverified or version-mismatched route.",
      );
    }

    // Revoke any prior unconsumed approvals for this mission before issuing a new one.
    this.revokeMissionApprovals(
      missionId,
      now ? now() : new Date().toISOString(),
    );

    const approvedAt = now ? now() : new Date().toISOString();
    const approval: RouteApproval = {
      approvalId: `appr-${randomUUID().slice(0, 12)}`,
      missionId,
      routeId,
      environmentVersion,
      policyVersion,
      approvedAt,
    };

    this.approvals.set(approval.approvalId, approval);
    return { ...approval };
  }

  revokeMissionApprovals(missionId: string, timestamp = new Date().toISOString()): number {
    let revokedCount = 0;
    for (const approval of this.approvals.values()) {
      if (approval.missionId === missionId && !approval.revokedAt) {
        approval.revokedAt = timestamp;
        revokedCount += 1;
      }
    }
    return revokedCount;
  }

  getApproval(approvalId: string): RouteApproval | null {
    const found = this.approvals.get(approvalId);
    return found ? { ...found } : null;
  }

  authorizeExecution(params: {
    missionId: string;
    routeId: string;
    approvalId: string;
    expectedEnvironmentVersion: number;
    currentEnvironmentVersion: number;
    currentPolicyVersion: string;
    missionStatus: MissionStatus;
    now?: (() => string) | undefined;
  }): RouteApproval {
    const {
      missionId,
      routeId,
      approvalId,
      expectedEnvironmentVersion,
      currentEnvironmentVersion,
      currentPolicyVersion,
      missionStatus,
      now,
    } = params;

    if (expectedEnvironmentVersion !== currentEnvironmentVersion) {
      throw new AppHttpError(
        409,
        "STALE_ENVIRONMENT_VERSION",
        `Expected environment version ${expectedEnvironmentVersion}, but current version is ${currentEnvironmentVersion}.`,
      );
    }

    if (missionStatus !== "ready") {
      throw new AppHttpError(
        409,
        "INVALID_STATE_TRANSITION",
        `Mission cannot execute while in "${missionStatus}" state; must be "ready".`,
      );
    }

    const approval = this.approvals.get(approvalId);
    if (!approval || approval.missionId !== missionId) {
      throw new AppHttpError(
        409,
        "APPROVAL_NOT_FOUND",
        `Approval "${approvalId}" does not exist for mission "${missionId}".`,
      );
    }

    if (approval.revokedAt) {
      throw new AppHttpError(
        409,
        "APPROVAL_REVOKED",
        "The environment changed after this route was verified; approval has been revoked.",
      );
    }

    if (approval.consumedAt) {
      throw new AppHttpError(
        409,
        "APPROVAL_ALREADY_CONSUMED",
        "This route approval has already been consumed.",
      );
    }

    if (approval.routeId !== routeId) {
      throw new AppHttpError(
        409,
        "APPROVAL_ROUTE_MISMATCH",
        `Approval is bound to route "${approval.routeId}", not "${routeId}".`,
      );
    }

    if (approval.environmentVersion !== currentEnvironmentVersion) {
      throw new AppHttpError(
        409,
        "STALE_ENVIRONMENT_VERSION",
        `Approval is bound to environment version ${approval.environmentVersion}, but current version is ${currentEnvironmentVersion}.`,
      );
    }

    if (approval.policyVersion !== currentPolicyVersion) {
      throw new AppHttpError(
        409,
        "STALE_POLICY_VERSION",
        `Approval policy "${approval.policyVersion}" does not match "${currentPolicyVersion}".`,
      );
    }

    if (approval.expiresAt && Date.parse(approval.expiresAt) < Date.now()) {
      throw new AppHttpError(
        409,
        "APPROVAL_EXPIRED",
        "This route approval has expired.",
      );
    }

    approval.consumedAt = now ? now() : new Date().toISOString();
    return { ...approval };
  }
}
