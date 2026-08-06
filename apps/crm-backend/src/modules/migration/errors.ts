export class MigrationError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MigrationError";
    this.code = code;
  }
}

export function toSafeMigrationError(error: unknown): Readonly<{ code: string; message: string }> {
  if (error instanceof MigrationError) {
    return { code: error.code, message: error.message };
  }

  return {
    code: "MIGRATION_INTERNAL_ERROR",
    message: "Migration command failed without exposing source data",
  };
}
