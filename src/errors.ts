export enum SelfMemoryErrorCode {
  MEMORY_NOT_FOUND = "MEMORY_NOT_FOUND",
  PROFILE_NOT_FOUND = "PROFILE_NOT_FOUND",
  VALIDATION_FAILED = "VALIDATION_FAILED",
  CONTENT_TOO_LARGE = "CONTENT_TOO_LARGE",
  FACET_LIMIT_REACHED = "FACET_LIMIT_REACHED",
  RATE_LIMITED = "RATE_LIMITED",
  DUPLICATE_DETECTED = "DUPLICATE_DETECTED",
  UPDATE_FAILED = "UPDATE_FAILED",
  IMPORT_FAILED = "IMPORT_FAILED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export class SelfMemoryError extends Error {
  public readonly code: SelfMemoryErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: SelfMemoryErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SelfMemoryError";
    this.code = code;
    this.details = details;
  }

  public toJSON(): { code: string; message: string; details?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function memoryNotFound(id: string): SelfMemoryError {
  return new SelfMemoryError(
    SelfMemoryErrorCode.MEMORY_NOT_FOUND,
    `Self memory not found: ${id}`,
    { id },
  );
}

export function contentTooLarge(field: string, length: number, maxLength: number): SelfMemoryError {
  return new SelfMemoryError(
    SelfMemoryErrorCode.CONTENT_TOO_LARGE,
    `${field} exceeds maximum length of ${maxLength} characters (got ${length})`,
    { field, length, max_length: maxLength },
  );
}

export function updateFailed(id: string): SelfMemoryError {
  return new SelfMemoryError(
    SelfMemoryErrorCode.UPDATE_FAILED,
    `Failed to update self memory: ${id}`,
    { id },
  );
}

export function validationFailed(message: string): SelfMemoryError {
  return new SelfMemoryError(
    SelfMemoryErrorCode.VALIDATION_FAILED,
    message,
  );
}
