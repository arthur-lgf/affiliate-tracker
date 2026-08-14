/**
 * Small in-memory sliding-window limiter. Good enough to blunt form spam on a
 * single instance; swap for Redis if this ever runs on more than one node.
 *
 * Two things it deliberately does NOT pretend to be:
 *
 *   - Shared. Each server instance, and each Edge isolate, keeps its own map,
 *     so the real ceiling is the configured limit times the number of live
 *     instances. It raises the cost of an attack; it does not cap it.
 *   - Unbounded. The key usually contains a client IP, and an attacker who can
 *     influence that value could otherwise make this map grow until the process
 *     runs out of memory. Hence MAX_BUCKETS below.
 */

type Bucket = { hits: number[]; windowMs: number; last: number };

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

const SWEEP_EVERY_MS = 60_000;

/**
 * Well past what a busy single instance needs, and small enough that the map
 * cannot become the thing that takes the process down.
 */
const MAX_BUCKETS = 20_000;

/**
 * Drop buckets that can no longer refuse anything.
 *
 * Each bucket remembers its own window. Sweeping every bucket against whichever
 * window the current caller happened to pass — which is what this did — would
 * let a caller with a 10-second window prune the hits of a caller with a
 * 10-minute one, quietly resetting the limit that matters most.
 */
function sweep(force = false) {
  const now = Date.now();
  if (!force && now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < bucket.windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): { ok: boolean; retryAfterSeconds: number } {
  sweep();

  const now = Date.now();
  const existing = buckets.get(key);
  const bucket: Bucket = existing ?? { hits: [], windowMs, last: now };
  // A key reused with a different window keeps the stricter of the two, so a
  // caller cannot widen someone else's window by colliding with their key.
  bucket.windowMs = Math.max(bucket.windowMs, windowMs);
  bucket.last = now;
  bucket.hits = bucket.hits.filter((t) => now - t < bucket.windowMs);

  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0]!;
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowMs - (now - oldest)) / 1000)),
    };
  }

  if (!existing && buckets.size >= MAX_BUCKETS) {
    // Under pressure, sweep first — most of the map is usually expired.
    sweep(true);
    if (buckets.size >= MAX_BUCKETS) {
      // Still full. Refusing the request is the safe answer: the alternative is
      // to stop counting, which is exactly what an attacker filling this map
      // would be trying to achieve.
      return { ok: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    }
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, retryAfterSeconds: 0 };
}

/** Only for tests, which need a clean map between cases. */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweep = Date.now();
}
