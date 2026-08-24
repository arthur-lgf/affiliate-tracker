import { NextResponse } from 'next/server';
import { requireApiSelfOrAdmin } from '@/lib/api-auth';
import { renderAgreementPdf } from '@/lib/pdf/agreement-pdf';
import { renderW9Pdf } from '@/lib/pdf/w9-pdf';
import { readAgreement, readW9, revealTin } from '@/lib/onboarding-store';
import { findUserById } from '@/lib/users';
import { storeResponse } from '@/lib/onboarding-api';

export const dynamic = 'force-dynamic';

/**
 * Download signed paperwork as a PDF.
 *
 * An admin, or the affiliate it belongs to. The second half of that is not a
 * relaxation of the first: a W-9 and a signed agreement are the two documents
 * a person is most likely to be asked for by somebody else — an accountant, a
 * lender, their own records — and the copy they signed should not be something
 * they have to ask us to send them.
 *
 * Generated on demand from the stored fields rather than saved as a blob when
 * they signed. A stored file is a file that can be out of step with the row it
 * came from; this way a correction to the record is a correction to every copy
 * of it, and there is no bucket to keep in sync.
 *
 * The W-9 is the one place in the application where a plaintext taxpayer number
 * is deliberately produced. It goes straight into the page image and is never
 * returned as JSON, logged, or held beyond the request. The affiliate reading
 * their own copy is reading their own number back, which is the one case where
 * that needs no ceremony at all.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string; doc: string }> },
) {
  const { userId, doc } = await context.params;
  const gate = await requireApiSelfOrAdmin(
    request,
    userId,
    'That paperwork belongs to somebody else.',
  );
  if ('response' in gate) return gate.response;
  if (doc !== 'agreement.pdf' && doc !== 'w9.pdf') {
    return NextResponse.json({ error: 'No such document.' }, { status: 404 });
  }

  const account = await findUserById(userId).catch(() => null);
  if (!account) return NextResponse.json({ error: 'No such account.' }, { status: 404 });

  /** `arthur-w9.pdf`, not `download.pdf`: these land in a folder with others. */
  const stem = (account.username || 'affiliate').replace(/[^a-z0-9._-]+/gi, '-');

  try {
    if (doc === 'agreement.pdf') {
      const record = await readAgreement(userId);
      if (!record) {
        return NextResponse.json({ error: 'That agreement has not been signed.' }, { status: 404 });
      }
      return pdfResponse(await renderAgreementPdf(record), `${stem}-affiliate-agreement.pdf`);
    }

    const form = await readW9(userId);
    if (!form) {
      return NextResponse.json({ error: 'That W-9 has not been filed.' }, { status: 404 });
    }
    const tin = await revealTin(userId);
    return pdfResponse(await renderW9Pdf(form, tin?.tin ?? ''), `${stem}-w9.pdf`);
  } catch (error) {
    return storeResponse(error);
  }
}

function pdfResponse(bytes: Uint8Array, filename: string): NextResponse {
  // Uint8Array rather than Buffer, and a fresh ArrayBuffer slice, so the body
  // is exactly the bytes and not a view into a larger pooled buffer.
  const body = new Uint8Array(bytes).slice().buffer as ArrayBuffer;
  return new NextResponse(body, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}"`,
      // Never cached anywhere: one of these has a Social Security number on it.
      'cache-control': 'no-store, no-cache, must-revalidate, private',
    },
  });
}
