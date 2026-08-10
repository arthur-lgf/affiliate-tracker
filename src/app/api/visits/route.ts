import { NextResponse } from 'next/server';
import { visitTrackingEnabled } from '@/lib/config';
import { clientIp, referrer, userAgent } from '@/lib/request';
import { rateLimit } from '@/lib/ratelimit';
import { getStore } from '@/lib/store';
import { visitInputSchema } from '@/lib/validate';

export const dynamic = 'force-dynamic';

/**
 * Page-view beacon for the landing pages. Deliberately forgiving: a visit we
 * fail to record must never affect the visitor, so every path returns 204.
 */
export async function POST(request: Request) {
  if (!visitTrackingEnabled()) return new NextResponse(null, { status: 204 });

  const ip = clientIp(request);
  const limit = rateLimit(`visit:${ip || 'unknown'}`, { limit: 60, windowMs: 10 * 60_000 });
  if (!limit.ok) return new NextResponse(null, { status: 204 });

  try {
    // sendBeacon posts a Blob, so read as text and parse ourselves.
    const raw = await request.text();
    const parsed = visitInputSchema.parse(JSON.parse(raw));

    await getStore().addVisit({
      slug: parsed.slug,
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
