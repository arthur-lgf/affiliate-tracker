import { NextResponse } from 'next/server';
import { AGREEMENT_VERSION } from '@/lib/agreement';
import { actorFor, bool, invalid, jsonBody, nextPath, noteSubmission, storeResponse, str } from '@/lib/onboarding-api';
import { agreementProblems } from '@/lib/onboarding';
import { tidyAddress } from '@/lib/address';
import { saveAgreement } from '@/lib/onboarding-store';

export const dynamic = 'force-dynamic';

/**
 * Step 2: the signed agreement.
 *
 * The version is stamped from the server's copy of the text, never from the
 * body. A browser claiming to have signed version '1999-01' would otherwise be
 * a browser choosing which wording it is bound by.
 */
export async function POST(request: Request) {
  const gate = await actorFor(request, 'agreement');
  if ('response' in gate) return gate.response;
  const { viewer, meta, state, approval, bypass } = gate;

  const body = await jsonBody(request);
  if (body && typeof body === 'object' && 'response' in body) {
    return (body as { response: NextResponse }).response;
  }

  const input = {
    affiliateName: str(body, 'affiliateName'),
    affiliateEmail: str(body, 'affiliateEmail'),
    /* The parts, tidied on arrival. The one line the document prints is
       composed from them when the row is written, never sent by the browser:
       a body that could supply both could supply an address that disagrees
       with itself. */
    address: tidyAddress({
      line1: str(body, 'addressLine1'),
      line2: str(body, 'addressLine2'),
      city: str(body, 'addressCity'),
      state: str(body, 'addressState'),
      postalCode: str(body, 'addressPostalCode'),
    }),
    effectiveDate: str(body, 'effectiveDate'),
    signaturePng: str(body, 'signaturePng'),
    affirmed: bool(body, 'affirmed'),
  };

  const problems = agreementProblems(input);
  if (Object.keys(problems).length > 0) return invalid(problems);

  // A signature is a few tens of kilobytes of PNG. A megabyte of it is not a
  // signature, it is somebody testing what this endpoint accepts.
  if (input.signaturePng.length > 600_000) {
    return invalid({ signaturePng: 'That signature is too large. Clear it and sign again.' });
  }

  try {
    await saveAgreement(viewer.id, input, meta, AGREEMENT_VERSION);
  } catch (error) {
    return storeResponse(error);
  }

  await noteSubmission(viewer.id, state, 'agreement');

  return NextResponse.json({ ok: true, next: nextPath(state, 'agreement', approval, bypass) });
}
