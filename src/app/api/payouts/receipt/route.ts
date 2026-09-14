import { NextResponse } from 'next/server';
import { unauthorized, viewerFromRequest } from '@/lib/api-auth';
import { mayReadReceipt, noSuchRequest, readRowId, storeFailure, type Refusal } from '@/lib/payout-api';
import { readPayoutRequestOwner, readPayoutRequestProof } from '@/lib/payout-request-store';
import { receiptHeaders, receiptPayload } from '@/lib/receipt-file';

/**
 * The receipt for one payment request, handed back as the file it is.
 *
 *   GET /api/payouts/receipt?request=<id>
 *
 * A route of its own because it is the one thing in the payout API that reads
 * the bytes. Every other query names its columns and leaves the file behind, so
 * a page drawing two dozen rows cannot accidentally carry two dozen bank
 * statements to the browser.
 *
 * Checked before it reads, in three steps. The id in the URL is a small
 * sequential number that says nothing about whose request it is, so the route
 * first asks who owns it, with a query that selects the owner and nothing
 * else; then decides from that whether this viewer may see it; and only then
 * reads the file. An affiliate typing somebody else's id is refused without
 * that receipt ever leaving the database, and is told the same thing as for an
 * id that was never issued.
 *
 * An admin, or the person the payment was made to. The affiliate needs it as
 * much as anybody: it is the evidence they were paid, and a payslip that says
 * "receipt attached" without letting them open it is a payslip telling somebody
 * about a document they cannot see.
 *
 * Served with nosniff, and with the stored type only when it is a receipt type
 * and the bytes still open the way it says (lib/receipt-file.ts). Anything
 * else is downloaded as plain bytes, never rendered inside this app.
 */

export const dynamic = 'force-dynamic';

function refuse(refusal: Refusal): NextResponse {
  const { status, ...body } = refusal;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();

  // An id that cannot be one is simply not found, the same as one that does
  // not exist, and costs no query.
  const id = readRowId(new URL(request.url).searchParams.get('request'));
  if (!id) return refuse(noSuchRequest());

  let proof: Awaited<ReturnType<typeof readPayoutRequestProof>>;
  try {
    const owner = await readPayoutRequestOwner(id);
    if (!owner) return refuse(noSuchRequest());

    // Somebody else's request gets the answer a missing one gets. The ids are
    // sequential, so a 403 of its own would let any signed-in affiliate walk
    // them and learn which exist, and so how many requests there are. The
    // payslip page answers the same way, for the same reason.
    if (!mayReadReceipt(viewer, owner.userId)) return refuse(noSuchRequest());

    proof = await readPayoutRequestProof(id);
  } catch (error) {
    const refusal = storeFailure(error, 'Could not read the receipt.');
    if (refusal.status >= 500) console.error('reading a receipt', error);
    return refuse(refusal);
  }

  if (!proof) {
    return refuse({ status: 404, error: 'No receipt is attached to that payment.' });
  }

  const base64 = receiptPayload(proof.data);
  const bytes = base64 ? Buffer.from(base64, 'base64') : Buffer.alloc(0);
  if (bytes.length === 0) {
    return refuse({ status: 500, error: 'That receipt could not be read back.' });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: receiptHeaders({ name: proof.name, type: proof.type, bytes }),
  });
}
