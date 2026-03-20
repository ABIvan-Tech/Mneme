export enum SelfMemoryErrorCode {
  MEMORY_NOT_FOUND = "MEMORY_NOT_FOUND",
  MEMORY_ALREADY_ARCHIVED = "MEMORY_ALREADY_ARCHIVED",
  MEMORY_NOT_ARCHIVED = "MEMORY_NOT_ARCHIVED",
  MEMORY_ALREADY_DELETED = "MEMORY_ALREADY_DELETED",
  THREAD_NOT_FOUND = "THREAD_NOT_FOUND",
  CONSOLIDATION_SOURCE_NOT_FOUND = "CONSOLIDATION_SOURCE_NOT_FOUND",
  CONSOLIDATION_SOURCE_DELETED = "CONSOLIDATION_SOURCE_DELETED",
  PROFILE_HISTORY_NOT_FOUND = "PROFILE_HISTORY_NOT_FOUND",
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

export function memoryAlreadyArchived(id: string): SelfMemoryError {
  return new SelfMemoryError(
    SelfMemoryErrorCode.MEMORY_ALREADY_ARCHIVED,
    `Self memory is already archived: ${id}`,
    { id },
  );
}

export function memoryNotArchived(id: string): SelfMemoryError {
  return new SelfMemoryError(
    SelfMemoryErrorCode.MEMORY_NOT_ARCHIVED,
    `Self memory is not archived: ${id}`,
    { id },
  );
}

export function memoryAlreadyDeleted(id: string): SelfMemoryError {
  return new SelfMemoryError(
    SelfMemoryErrorCode.MEMORY_ALREADY_DELETED,
    `Self memory is already deleted: ${id}`,
    { id },
  );
}

export function threadNotFound(threadId: string): SelfMemoryError {
  return new SelfMemoryError(
    SelfMemoryErrorCode.THREAD_NOT_FOUND,
    `Thread not found: ${threadId}`,
    { thread_id: threadId },
  );
}

export function consolidationSourceNotFound(sourceIds: string[]): SelfMemoryError {
  return new SelfMemoryError(
    SelfMemoryErrorCode.CONSOLIDATION_SOURCE_NOT_FOUND,
    "One or more consolidation source memories were not found",
    { source_ids: sourceIds },
  );
}

export function consolidationSourceDeleted(sourceIds: string[]): SelfMemoryError {
  return new SelfMemoryError(
    SelfMemoryErrorCode.CONSOLIDATION_SOURCE_DELETED,
    "One or more consolidation source memories are deleted",
    { source_ids: sourceIds },
  );
}

export function profileHistoryNotFound(snapshotId: string): SelfMemoryError {
  return new SelfMemoryError(
    SelfMemoryErrorCode.PROFILE_HISTORY_NOT_FOUND,
    `Profile history snapshot not found: ${snapshotId}`,
    { snapshot_id: snapshotId },
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
