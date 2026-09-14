import { NextResponse } from 'next/server';
import { requireApiAdmin } from '@/lib/api-auth';
import { dayOf } from '@/lib/payout';
import {
  asBody,
  cancelledRefusal,
  noSuchRequest,
  readPayment,
  readPayoutAction,
  readRequestId,
  stateRefusal,
  storeFailure,
  type Refusal,
} from '@/lib/payout-api';
import {
  cancelPayoutRequest,
  clearPayment,
  readPayoutRequest,
  recordPayment,
  removeProof,
  saveProof,
} from '@/lib/payout-request-store';
import { checkReceiptUpload } from '@/lib/receipt-file';

/**
 * Recording what was paid against a request, and the receipt for it.
 *
 * Admin only. Every action names a request by id, and the request row is its
 * own authority: what was asked for, by whom and when are all fixed on it, so
 * there is no schedule to re-derive and nothing in the body is believed about
 * the request beyond which one it is.
 *
 * Five actions rather than one save, for the same reason the settings route has
 * three: a whole-object write from a page left open since this morning can put
 * back a figure somebody has since corrected.
 *
 * A cancelled request is guarded twice. Once up front, from the row just read,
 * so the usual case gets a plain sentence before anything is validated. And
 * again inside each write, because a cancel can land between that read and the
 * update: every store write here refuses to touch a cancelled row and reports
 * whether it matched, and matching nothing gets the same 409. That second
 * guard is also what keeps payout_requests_paid_pair_check true, since a paid
 * status can never be written onto a cancelled request.
 *
 * A receipt is checked by its bytes as well as its label before it is stored
 * (lib/receipt-file.ts). The rules themselves are in lib/payout-api.ts, with
 * their checks.
 */

export const dynamic = 'force-dynamic';

function refuse(refusal: Refusal): NextResponse {
  const { status, ...body } = refusal;
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  const gate = await requireApiAdmin(request, 'Only an admin can record a payment.');
  if ('response' in gate) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = asBody(await request.json());
  } catch {
    return refuse({ status: 400, error: 'Expected a JSON body.' });
  }

  // Before the request is read, so a body that could never do anything costs
  // no query.
  const action = readPayoutAction(body.action);
  if (!action) {
    return refuse({
      status: 400,
      error: 'No such action.',
      hint: 'Expected pay, clear, proof, remove-proof or cancel.',
    });
  }

  const id = readRequestId(body.requestId);
  if (!id.ok) return refuse(id.refusal);

  const by = gate.viewer.username;

  try {
    const found = await readPayoutRequest(id.id);
    if (!found) return refuse(noSuchRequest());

    const refused = stateRefusal(action, found.status);
    if (refused) return refuse(refused);

    if (action === 'cancel') {
      // The function re-checks the status under a row lock, so a payment
      // recorded a moment ago comes back as LG006 and a 409, not a cancelled
      // paid request.
      await cancelPayoutRequest(id.id, by);
      return NextResponse.json({ ok: true });
    }

    if (action === 'pay') {
      const payment = readPayment(body, dayOf(new Date().toISOString()), found.requestedAt);
      if (!payment.ok) return refuse(payment.refusal);
      const matched = await recordPayment(id.id, { ...payment.payment, by });
      return matched ? NextResponse.json({ ok: true }) : refuse(cancelledRefusal(action));
    }

    if (action === 'clear') {
      const matched = await clearPayment(id.id);
      return matched ? NextResponse.json({ ok: true }) : refuse(cancelledRefusal(action));
    }

    if (action === 'proof') {
      const upload = checkReceiptUpload({ name: body.name, type: body.type, data: body.data });
      if (!upload.ok) return refuse({ status: 422, error: upload.error, hint: upload.hint });
      const matched = await saveProof(id.id, { ...upload.receipt, by });
      return matched ? NextResponse.json({ ok: true }) : refuse(cancelledRefusal(action));
    }

    const matched = await removeProof(id.id);
    return matched ? NextResponse.json({ ok: true }) : refuse(cancelledRefusal(action));
  } catch (error) {
    const refusal = storeFailure(error, 'That did not save.', { showUnknown: true });
    if (refusal.status >= 500) console.error(`payouts: ${action}`, error);
    return refuse(refusal);
  }
}
