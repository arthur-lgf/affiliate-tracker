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

/**
 * The request was understood and refused on its content: nothing chosen, the
 * same card twice, a card that is not theirs or not old enough. 422 rather
 * than 409, because nothing collided; asking again with the same input will
 * be refused again. Raised today by lib/payout-request-store.ts, from the
 * errors create_payout_request raises.
 */
export class StoreValidationError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'StoreValidationError';
  }
}

export function statusForError(error: unknown): number {
  if (
    error instanceof StoreConflictError ||
    error instanceof StoreNotFoundError ||
    error instanceof StoreConfigError ||
    error instanceof StoreValidationError
  ) {
    return error.status;
  }
  return 500;
}
