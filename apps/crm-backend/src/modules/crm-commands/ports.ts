import type { CrmCaseDetail, CrmEmployerDetail, CrmReferralDetail, CrmTaskDetail } from "../crm/contracts.js";
import type { CrmAccessScope, CrmActorContext, CrmMutationResult } from "../crm/ports.js";
import type {
  CreateEmployerBody,
  CreateReferralBody,
  CreateTaskBody,
  TransitionReferralBody,
  UpdateCaseBody,
  UpdateTaskBody,
} from "./contracts.js";

export interface IdempotentCrmResult<T> {
  readonly value: T;
  readonly replayed: boolean;
}

export interface CrmCommandContext {
  readonly actor: CrmActorContext;
  readonly access: CrmAccessScope;
}

export interface CrmCreateCommand<T> extends CrmCommandContext {
  readonly input: T;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface CrmUpdateCommand<T> extends CrmCommandContext {
  readonly resourceId: string;
  readonly expectedVersion: number;
  readonly input: T;
}

export interface CrmCommandRepositoryPort {
  updateCase(command: CrmUpdateCommand<UpdateCaseBody>): Promise<CrmMutationResult<CrmCaseDetail>>;
  createEmployer(
    command: CrmCreateCommand<CreateEmployerBody>,
  ): Promise<IdempotentCrmResult<CrmEmployerDetail>>;
  createReferral(
    command: CrmCreateCommand<CreateReferralBody>,
  ): Promise<IdempotentCrmResult<CrmReferralDetail>>;
  transitionReferral(
    command: CrmUpdateCommand<TransitionReferralBody>,
  ): Promise<CrmMutationResult<CrmReferralDetail>>;
  createTask(command: CrmCreateCommand<CreateTaskBody>): Promise<IdempotentCrmResult<CrmTaskDetail>>;
  updateTask(command: CrmUpdateCommand<UpdateTaskBody>): Promise<CrmMutationResult<CrmTaskDetail>>;
}
