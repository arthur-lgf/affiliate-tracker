/** Errors both store adapters raise, mapped to HTTP status codes by the API routes. */

export class StoreConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'StoreConflictError';
  }
}

export class StoreNotFoundError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = 'StoreNotFoundError';
  }
}

export class StoreConfigError extends Error {
  readonly status = 500;
  constructor(message: string) {
    super(message);
    this.name = 'StoreConfigError';
  }
}

export function statusForError(error: unknown): number {
  if (
    error instanceof StoreConflictError ||
    error instanceof StoreNotFoundError ||
    error instanceof StoreConfigError
  ) {
    return error.status;
  }
  return 500;
}
