/**
 * One retry with a short backoff, for operations that are NOT idempotent.
 *
 * Appending a lead row is the motivating case: if the append reached Google and
 * only the response was lost, retrying writes the lead twice. So the default
 * predicate retries only failures where the request demonstrably never landed —
 * connection-level errors, and 429 (rate limited, nothing was written). A 5xx is
 * deliberately NOT retried: the write may well have succeeded.
 */

const CONNECTION_ERRORS = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
]);

function httpStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.response?.status === 'number') return candidate.response.status;
  if (typeof candidate.code === 'number') return candidate.code;
  return null;
}

/** True when the request provably never reached the server (or was rejected before any write). */
export function isSafeToRetry(error: unknown): boolean {
  const status = httpStatus(error);
  if (status !== null) return status === 429;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CONNECTION_ERRORS.has(code);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    attempts = 2,
    delayMs = 350,
    shouldRetry = isSafeToRetry,
  }: { attempts?: number; delayMs?: number; shouldRetry?: (error: unknown) => boolean } = {},
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i >= attempts - 1 || !shouldRetry(error)) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw lastError;
}
