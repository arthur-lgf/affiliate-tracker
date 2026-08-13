import { visitTrackingEnabled } from './config';
import { rateLimit } from './ratelimit';
import { clientIp, referrer, userAgent } from './request';
import { getStore } from './store';

/**
 * Record a click server-side.
 *
 * With the capture form off there is no page left to run the browser beacon
 * from — the visitor is redirected before anything renders — so the visit has to
 * be written here or Visits stops counting entirely, which is the one number the
 * whole dashboard is built on.
 *
 * Never throws. A visit we failed to record must not cost the visitor their
 * click: the redirect matters more than the analytics.
 */
export async function logVisit(
  request: { headers: Headers },
  { slug, usr }: { slug: string; usr: string },
): Promise<void> {
  if (!visitTrackingEnabled()) return;

  const ip = clientIp(request);
  // Same budget as the beacon endpoint. A hammered link is logged up to the cap
  // and then quietly dropped rather than filling the sheet with one bot's clicks.
  const limit = rateLimit(`visit:${ip || 'unknown'}`, { limit: 60, windowMs: 10 * 60_000 });
  if (!limit.ok) return;

  try {
    await getStore().addVisit({
      slug,
      usr,
      referrer: referrer(request),
      userAgent: userAgent(request),
      ip,
    });
  } catch (error) {
    console.warn('[visits] not recorded', error instanceof Error ? error.message : error);
  }
}
