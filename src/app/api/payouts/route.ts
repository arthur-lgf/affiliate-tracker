import { NextResponse } from 'next/server';
import { requireApiAdmin } from '@/lib/api-auth';
import { listOnboarding } from '@/lib/onboarding-store';
import { anchorFor, dayOf, hasAnchor, isDay, periodAt, type Period } from '@/lib/payout';
import {
  clearPayment,
  recordPayment,
  removeProof,
  saveProof,
  type PeriodRef,
} from '@/lib/payout-store';
import { StoreConfigError } from '@/lib/store/errors';

/**
 * Recording what was paid, and the receipt for it.
 *
 * Admin only, and everything that decides a figure is re-derived here rather
 * than believed. The cycle in particular: a body naming a window is checked
 * against the schedule that account actually has, so a payment cannot be
 * recorded against a period that is not one of theirs. That is not suspicion of
 * the form, which computes it correctly; it is that the window is the primary
 * key, and a wrong one would file a real payment where nobody looks for it and
 * leave the real cycle reading as unpaid forever.
 *
 * Four actions rather than one save, for the same reason the settings route has
 * three: a whole-object write from a page left open since this morning can put
 * back a figure somebody has since corrected.
 */

export const dynamic = 'force-dynamic';

/** What a receipt may be. A payment is evidenced by a scan or a PDF; anything
 *  else arriving here is somebody testing what this endpoint accepts. */
const PROOF_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

/*
 * Two and a half megabytes of file, a little over three of base64. Comfortably
 * a phone photo of a transfer screen or a bank PDF, and comfortably under the
 * body limit a serverless platform will accept.
 */
const MAX_PROOF_BYTES = 2_500_000;

function bad(error: string, hint?: string, status = 422): NextResponse {
  return NextResponse.json(hint ? { error, hint } : { error }, { status });
}

function fields(problems: Record<string, string>): NextResponse {
  return NextResponse.json({ error: 'Please check the highlighted fields.', fields: problems }, { status: 422 });
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

function storeResponse(error: unknown): NextResponse {
  if (error instanceof StoreConfigError) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'That did not save.' },
    { status: 500 },
  );
}

/**
 * The cycle this body is talking about, or a refusal.
 *
 * Reads the account's own anchor and asks the schedule which window contains
 * the day that was sent. If that is not the window the body claims, the body is
 * wrong about somebody's calendar and nothing is written.
 */
async function periodFor(
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ ref: PeriodRef; period: Period } | { response: NextResponse }> {
  if (!isDay(periodStart) || !isDay(periodEnd)) {
    return { response: bad('That is not a pay period.') };
  }

  let people;
  try {
    people = await listOnboarding();
  } catch (error) {
    return { response: storeResponse(error) };
  }

  const person = people.find((row) => row.userId === userId);
  if (!person) return { response: bad('No such affiliate account.', undefined, 404) };

  const anchor = anchorFor({
    agreementSignedAt: person.agreementSignedAt,
    bypassedAt: person.bypass.at,
    createdAt: person.createdAt,
  });
  if (!hasAnchor(anchor)) {
    return {
      response: bad(
        'This account has no payout schedule yet.',
        'It starts when they sign the agreement, or when an admin waives it.',
      ),
    };
  }

  const period = periodAt(anchor.day, periodStart);
  if (!period || period.from !== periodStart || period.to !== periodEnd) {
    return {
      response: bad(
        'That pay period is not one of theirs.',
        'Reload the page: their schedule is counted from the day they signed.',
      ),
    };
  }

  return { ref: { userId, periodStart: period.from, periodEnd: period.to }, period };
}

export async function POST(request: Request) {
  const gate = await requireApiAdmin(request, 'Only an admin can record a payment.');
  if ('response' in gate) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return bad('Expected a JSON body.', undefined, 400);
  }

  const action = str(body, 'action');
  const userId = str(body, 'userId');
  if (!userId) return bad('Which affiliate?', undefined, 400);

  const found = await periodFor(userId, str(body, 'periodStart'), str(body, 'periodEnd'));
  if ('response' in found) return found.response;
  const { ref, period } = found;

  try {
    if (action === 'pay') {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return fields({ amount: 'What was sent.' });
      }
      if (amount > 1_000_000) {
        return fields({
          amount: 'That is larger than any payout this app has made. Check the figure.',
        });
      }

      /*
       * A payment is something that happened. Recording one for next Tuesday
       * would put a date on somebody's payslip that no money matches, and
       * "we will pay you" is not what this page is for.
       */
      const today = dayOf(new Date().toISOString());
      const paidOn = str(body, 'paidOn') || today;
      if (!isDay(paidOn) || paidOn > today) {
        return fields({ paidOn: 'The day it was sent. It cannot be in the future.' });
      }
      // Before the cycle opened, so it cannot be a payment for this one.
      if (paidOn < period.from) {
        return fields({ paidOn: `This period did not start until ${period.from}.` });
      }

      await recordPayment(ref, {
        amount: Math.round(amount * 100) / 100,
        paidOn,
        reference: str(body, 'reference'),
        note: str(body, 'note'),
        by: gate.viewer.username,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === 'clear') {
      await clearPayment(ref);
      return NextResponse.json({ ok: true });
    }

    if (action === 'proof') {
      const type = str(body, 'type');
      const data = str(body, 'data');
      if (!PROOF_TYPES.includes(type)) {
        return bad(
          'That file type cannot be attached.',
          'A photo or a screenshot (PNG, JPEG or WebP), or a PDF.',
        );
      }
      if (!data.startsWith(`data:${type};base64,`)) {
        return bad('That receipt did not arrive in one piece.', 'Try attaching it again.');
      }
      // Base64 is four characters per three bytes, so this is the size of the
      // file rather than the size of the string carrying it.
      const bytes = Math.floor((data.length - data.indexOf(',') - 1) * 0.75);
      if (bytes > MAX_PROOF_BYTES) {
        return bad(
          'That receipt is too large.',
          'Up to about 2.5 MB. A screenshot or a PDF of the transfer is plenty.',
        );
      }

      await saveProof(ref, {
        name: str(body, 'name') || 'receipt',
        type,
        data,
        by: gate.viewer.username,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === 'remove-proof') {
      await removeProof(ref);
      return NextResponse.json({ ok: true });
    }
  } catch (error) {
    return storeResponse(error);
  }

  return bad('No such action.', 'Expected pay, clear, proof or remove-proof.', 400);
}
