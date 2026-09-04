import { NextResponse } from 'next/server';
import { unauthorized, viewerFromRequest } from '@/lib/api-auth';
import { isDay } from '@/lib/payout';
import { confirmReceipt } from '@/lib/payout-store';
import { StoreConfigError } from '@/lib/store/errors';

/**
 * The affiliate's own half of a payslip: saying the money arrived.
 *
 * The one thing on a payout row that is not written by an admin, and the reason
 * it has a route of its own rather than an action on the admin one. Whose
 * payslip it is comes from the session and is never read from the body: an
 * account confirming somebody else's payment would be recording a fact about a
 * bank transfer it has no way of knowing anything about.
 *
 * There is nothing to confirm until a payment has been recorded, and the store
 * enforces that inside the query rather than trusting this route to have
 * checked. What this route adds is a sentence saying so, because "nothing
 * happened" is not an answer anybody can act on.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();
  if (!viewer.id) {
    // The environment admin has no database row, so it has no payslips either.
    return NextResponse.json({ error: 'This account has no payslips of its own.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (body.action !== 'confirm') {
    return NextResponse.json({ error: 'No such action.', hint: 'Expected confirm.' }, { status: 400 });
  }

  const periodStart = typeof body.periodStart === 'string' ? body.periodStart : '';
  if (!isDay(periodStart)) {
    return NextResponse.json({ error: 'That is not a pay period.' }, { status: 400 });
  }

  try {
    const done = await confirmReceipt(viewer.id, periodStart);
    if (!done) {
      return NextResponse.json(
        {
          error: 'There is no payment recorded for that period yet.',
          hint: 'You can confirm it once the payment shows here.',
        },
        { status: 409 },
      );
    }
  } catch (error) {
    if (error instanceof StoreConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'That did not save.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
