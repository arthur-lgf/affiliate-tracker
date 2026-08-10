import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { clientIp, referrer, userAgent } from '@/lib/request';
import { rateLimit } from '@/lib/ratelimit';
import { withRetry } from '@/lib/retry';
import { getStore, resolveLink, statusForError } from '@/lib/store';
import { destinationUrl } from '@/lib/url';
import { fieldErrors, submissionInputSchema } from '@/lib/validate';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ip = clientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  let input;
  try {
    input = submissionInputSchema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Please check the highlighted fields.', fields: fieldErrors(error) },
        { status: 422 },
      );
    }
    throw error;
  }

  // When the IP is unknown (no proxy headers) every visitor would otherwise
  // share a single bucket, so one busy campaign would lock everyone else out.
  // Fall back to a much looser per-campaign cap instead of a shared per-IP one.
  const limit = ip
    ? rateLimit(`submit:ip:${ip}`, { limit: 12, windowMs: 10 * 60_000 })
    : rateLimit(`submit:anon:${input.slug}`, { limit: 240, windowMs: 10 * 60_000 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many submissions from this connection. Please try again shortly.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  let resolved;
  try {
    resolved = await resolveLink(input.slug, input.usr);
  } catch (error) {
    return NextResponse.json(
      { error: 'We could not reach our records. Please try again in a moment.' },
      { status: statusForError(error) },
    );
  }

  if (resolved.status === 'missing') {
    return NextResponse.json({ error: 'This link no longer exists.' }, { status: 404 });
  }
  if (resolved.status === 'paused') {
    return NextResponse.json({ error: 'This offer is no longer accepting sign-ups.' }, { status: 410 });
  }

  const { link } = resolved;
  // Only a key that exists in the Links tab is ever appended to the merchant
  // URL — a visitor must not be able to inject an arbitrary value into it.
  const attributionKey = resolved.assigned ? input.usr : link.usr;
  const destination = destinationUrl(link, attributionKey);

  // Honeypot: accept and forward without writing a row. Logged because browser
  // autofill can fill hidden fields, and a silently discarded real lead would
  // otherwise be invisible.
  if (input.company.trim() !== '') {
    console.warn('[submissions] honeypot drop', {
      slug: link.slug,
      usr: input.usr,
      email: input.email,
    });
    return NextResponse.json({ ok: true, redirectUrl: destination });
  }

  if (link.requirePhone && input.phone.replace(/\D/g, '').length < 7) {
    return NextResponse.json(
      {
        error: 'Please check the highlighted fields.',
        fields: { phone: 'Please enter a valid phone number' },
      },
      { status: 422 },
    );
  }

  try {
    const submission = await withRetry(() =>
      getStore().addSubmission({
        slug: link.slug,
        // The raw key is kept so an unknown or stale ?usr= shows up in the
        // dashboard rather than being quietly folded into the house row.
        usr: input.usr,
        assignee: resolved.assigned ? link.assignee : '',
        campaign: link.campaign,
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        destination,
        referrer: referrer(request),
        userAgent: userAgent(request),
        ip,
      }),
    );

    return NextResponse.json({ ok: true, id: submission.id, redirectUrl: destination });
  } catch (error) {
    // Better to ask the visitor to retry than to forward a lead we never saved.
    console.error('[submissions] write failed', error);
    return NextResponse.json(
      { error: 'We could not save your details. Please try again.' },
      { status: 502 },
    );
  }
}
