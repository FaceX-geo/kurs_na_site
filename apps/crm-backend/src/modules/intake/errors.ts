export interface IntakeValidationIssue {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export class IntakeError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly issues: readonly IntakeValidationIssue[];

  constructor(
    statusCode: number,
    code: string,
    message: string,
    issues: readonly IntakeValidationIssue[] = [],
  ) {
    super(message);
    this.name = "IntakeError";
    this.statusCode = statusCode;
    this.code = code;
    this.issues = issues;
  }
}

export function validationError(issues: readonly IntakeValidationIssue[]): IntakeError {
  return new IntakeError(422, "validation_error", "Validation failed", issues);
}
