import type { BusinessRole } from "./business-role-registry.js";
import type { SessionListQuery } from "./session-contracts.js";

export interface RequestContext {
  readonly requestId: string;
}

export interface InviteUserInput {
  readonly email: string;
  readonly givenName: string;
  readonly surname: string;
  readonly middleName?: string;
  readonly reason: string;
}

export interface ProvisionSpecialistInput {
  readonly employeeProfileId: string;
  readonly email: string;
  readonly reason: string;
}

export interface ProvisionedSpecialistReceipt {
  readonly id: string;
  readonly auditEventId: string;
  readonly operationId: "ProvisionSpecialist";
  readonly requestId: string;
  readonly userId: string;
  readonly employeeProfileId: string;
  readonly businessRole: "SPECIALIST";
  readonly expiresAt: string;
  readonly occurredAt: string;
  readonly credentialDelivery: "queued_internal";
}

export interface ProvisionSpecialistResult {
  readonly receipt: ProvisionedSpecialistReceipt;
  readonly replayed: boolean;
}

export interface ProvisionableEmployeeItem {
  readonly employeeProfileId: string;
  readonly personId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly employeeNumber: string | null;
  readonly organizationUnitId: string | null;
  readonly employmentState: "active";
  readonly createdAt: string;
}

export interface EmployeeListQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly search?: string;
}

export interface CredentialTokenInput {
  readonly token: string;
  readonly password: string;
}

export interface MfaChallengeInput {
  readonly challengeId: string;
  readonly challengeToken: string;
}

export interface ConfirmTotpInput extends MfaChallengeInput {
  readonly code: string;
}

export interface RecoverMfaInput extends MfaChallengeInput {
  readonly recoveryCode: string;
}

export interface ChangePasswordInput {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly mfaCode?: string;
}

export interface FreshAuthInput {
  readonly password: string;
  readonly mfaCode: string;
}

export interface VersionedReasonInput {
  readonly expectedVersion: number;
  readonly reason: string;
  readonly approvalRequestId?: string;
  readonly transferRef?: string;
}

export type RoleScopeType = "self" | "assigned" | "team" | "department" | "direction" | "project" | "all";

export interface RoleChangeInput {
  readonly roleCode?: string;
  readonly scopeType: RoleScopeType;
  readonly scopeId?: string;
  readonly expectedVersion: number;
  readonly reason: string;
  readonly previewFingerprint: string;
  readonly approvalRequestId?: string;
  readonly nominationRef?: string;
  readonly transferRef?: string;
}

export interface RolePreviewInput {
  readonly operationKey:
    | "assign_platform"
    | "assign_crm"
    | "revoke_crm"
    | "assign_project"
    | "revoke_project"
    | "assign_initial_crm_admin"
    | "assign_initial_project_admin"
    | "assign_crm_admin"
    | "assign_project_admin"
    | "revoke_platform"
    | "revoke_crm_admin"
    | "revoke_project_admin"
    | "assign_migration"
    | "revoke_migration"
    | "assign_audit"
    | "revoke_audit";
  readonly roleCode?: string;
  readonly scopeType: RoleScopeType;
  readonly scopeId?: string;
  readonly expectedVersion: number;
}

export interface EffectiveRoleAssignment {
  readonly id: string | null;
  readonly roleCode: string;
  readonly domain: string;
  readonly privileged: boolean;
  readonly scopeType: RoleScopeType;
  readonly scopeId: string | null;
  readonly validFrom: string | null;
  readonly version: number | null;
}

export interface EffectiveAccessPreview {
  readonly userId: string;
  readonly accountVersion: number;
  readonly policyVersion: string;
  readonly domain: "platform" | "crm" | "project" | "migration" | "audit";
  readonly operationKey: RolePreviewInput["operationKey"];
  readonly operationId: string;
  readonly action: "assign" | "revoke";
  readonly roleCode: string;
  readonly scopeType: RoleScopeType;
  readonly scopeId: string | null;
  readonly currentAssignments: readonly EffectiveRoleAssignment[];
  readonly proposedAssignments: readonly EffectiveRoleAssignment[];
  readonly currentPermissions: readonly string[];
  readonly proposedPermissions: readonly string[];
  readonly addedPermissions: readonly string[];
  readonly removedPermissions: readonly string[];
  readonly requiresApproval: boolean;
  readonly approverRole: string | null;
  readonly previewFingerprint: string;
}

export interface ReasonInput {
  readonly reason: string;
}

export interface UserListQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly search?: string;
  readonly accountState?: "active" | "disabled" | "archived";
  readonly mfaState?: "not_enrolled" | "enrollment_required" | "enrolled" | "recovery_required";
}

export interface UserBusinessIdentity {
  readonly employeeProfileId: string | null;
  readonly businessRole: BusinessRole | null;
}

export interface ApprovalListQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly state?: "pending" | "approved" | "rejected" | "expired" | "executed" | "cancelled";
}

export interface AdminSessionListQuery extends SessionListQuery {
  readonly reason: string;
}

export interface DecideApprovalInput {
  readonly decision: "approve" | "reject";
  readonly expectedVersion: number;
  readonly reason: string;
}

export interface AdminOperationResult {
  readonly status: "completed" | "approval_required";
  readonly resourceId: string;
  readonly version?: number;
  readonly approval?: {
    readonly id: string;
    readonly expiresAt: string;
  };
}
