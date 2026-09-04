import { NextResponse } from 'next/server';
import { requireApiSelfOrAdmin } from '@/lib/api-auth';
import { isDay } from '@/lib/payout';
import { readProof } from '@/lib/payout-store';
import { StoreConfigError } from '@/lib/store/errors';

/**
 * The receipt for one payment, handed back as the file it is.
 *
 * A route of its own because it is the one thing in the payout API that reads
 * the bytes. Every other query names its columns and leaves the file behind, so
 * a page drawing two dozen rows cannot accidentally carry two dozen bank
 * statements to the browser.
 *
 * An admin, or the person the payment was made to. The affiliate needs it as
 * much as anybody: it is the evidence they were paid, and a payslip that says
 * "receipt attached" without letting them open it is a payslip telling somebody
 * about a document they cannot see.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user') ?? '';
  const periodStart = url.searchParams.get('period') ?? '';

  // Checked against the id in the query rather than against "is signed in": an
  // affiliate who types somebody else's id into this URL is refused.
  const gate = await requireApiSelfOrAdmin(request, userId, 'That payment is not yours.');
  if ('response' in gate) return gate.response;

  if (!isDay(periodStart)) {
    return NextResponse.json({ error: 'That is not a pay period.' }, { status: 400 });
  }

  let proof;
  try {
    proof = await readProof(userId, periodStart);
  } catch (error) {
    if (error instanceof StoreConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not read the receipt.' },
      { status: 500 },
    );
  }

  if (!proof) {
    return NextResponse.json({ error: 'No receipt is attached to that payment.' }, { status: 404 });
  }

  const comma = proof.data.indexOf(',');
  const base64 = comma === -1 ? '' : proof.data.slice(comma + 1);
  if (!base64) {
    return NextResponse.json({ error: 'That receipt could not be read back.' }, { status: 500 });
  }

  const bytes = Buffer.from(base64, 'base64');
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'content-type': proof.type || 'application/octet-stream',
      /*
       * Inline: the point of opening a receipt is to look at it, and a PDF or a
       * photo of a transfer is something people check at a glance rather than
       * collect. The filename is still given, so saving it keeps its own name.
       */
      'content-disposition': `inline; filename="${proof.name.replace(/["\\]/g, '')}"`,
      'content-length': String(bytes.length),
      // Somebody's bank details are not something to leave in a shared cache,
      // and the file can be replaced the moment a better scan turns up.
      'cache-control': 'private, no-store',
    },
  });
}
