import { NextResponse } from 'next/server';
import { visitTrackingEnabled } from '@/lib/config';
import { clientIp, referrer, userAgent } from '@/lib/request';
import { rateLimit } from '@/lib/ratelimit';
import { getStore, resolveLink } from '@/lib/store';
import { visitInputSchema } from '@/lib/validate';

export const dynamic = 'force-dynamic';

/**
 * A beacon body is two short keys. Anything larger is not one of ours, and
 * reading it before checking would let an unauthenticated caller hand this
 * process an arbitrarily large string to buffer and parse.
 */
const MAX_BODY_BYTES = 2_048;

/**
 * Page-view beacon for the landing pages. Deliberately forgiving: a visit we
 * fail to record must never affect the visitor, so every path returns 204.
 *
 * Every path returning 204 also means this endpoint tells an attacker nothing,
 * which is why the checks below can be strict without becoming an oracle.
 */
export async function POST(request: Request) {
  if (!visitTrackingEnabled()) return new NextResponse(null, { status: 204 });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 204 });
  }

  const ip = clientIp(request);
  const limit = rateLimit(`visit:${ip || 'shared'}`, { limit: 60, windowMs: 10 * 60_000 });
  if (!limit.ok) return new NextResponse(null, { status: 204 });

  try {
    // sendBeacon posts a Blob, so read as text and parse ourselves.
    const raw = await request.text();
    // content-length can lie, or be absent on a chunked body.
    if (raw.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 });

    const parsed = visitInputSchema.parse(JSON.parse(raw));

    // Only record a visit to a link that exists, exactly as /api/submissions
    // already does. Without this the endpoint is a public write primitive: a
    // loop against it invents traffic for any slug and tracking key the caller
    // names, and visits are the denominator of every conversion rate, every
    // per-person earnings figure and the whole "who is earning" table. Forging
    // them is forging somebody's performance review.
    const resolution = await resolveLink(parsed.slug, parsed.usr);
    if (resolution.status !== 'ok') return new NextResponse(null, { status: 204 });

    await getStore().addVisit({
      slug: parsed.slug,
      // The key is kept as sent rather than as resolved, so a stale ?usr= still
      // shows up as its own row — but only now that the slug is known to exist.
      usr: parsed.usr,
      referrer: referrer(request),
      userAgent: userAgent(request),
      ip,
    });
  } catch (error) {
    console.warn('[visits] skipped', error instanceof Error ? error.message : error);
  }

  return new NextResponse(null, { status: 204 });
}
