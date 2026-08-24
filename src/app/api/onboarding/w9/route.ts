import { NextResponse } from 'next/server';
import { actorFor, bool, invalid, jsonBody, nextPath, noteSubmission, storeResponse, str } from '@/lib/onboarding-api';
import { keepsTin, w9Problems, type W9Classification, type W9Input } from '@/lib/onboarding';
import { readW9, saveW9 } from '@/lib/onboarding-store';
import { secretsConfigured } from '@/lib/secret-box';

export const dynamic = 'force-dynamic';

/** Which revision of the form was rendered to them. Stored on the row so a
 *  reissued W-9 never silently reinterprets an old certification. */
const FORM_REVISION = 'Rev. March 2024';

const CLASSIFICATIONS = new Set<W9Classification>([
  'individual',
  'c_corp',
  's_corp',
  'partnership',
  'trust_estate',
  'llc',
  'other',
]);

export async function POST(request: Request) {
  const gate = await actorFor(request, 'w9');
  if ('response' in gate) return gate.response;
  const { viewer, meta, state, approval, bypass } = gate;

  /*
   * Refused before the body is even read. Without a key there is nowhere safe
   * to put a Social Security number, and the only alternatives are storing one
   * in the clear or pretending to have stored it — so the honest answer is to
   * say so and collect nothing.
   */
  if (!secretsConfigured()) {
    return NextResponse.json(
      {
        error:
          'This deployment cannot accept taxpayer details yet: ONBOARDING_SECRET_KEY is not set. ' +
          'Tell your admin. Nothing you typed has been stored.',
      },
      { status: 503 },
    );
  }

  const body = await jsonBody(request);
  if (body && typeof body === 'object' && 'response' in body) {
    return (body as { response: NextResponse }).response;
  }

  const rawClassification = str(body, 'classification') as W9Classification;
  const input: W9Input = {
    line1Name: str(body, 'line1Name'),
    line2Business: str(body, 'line2Business'),
    classification: CLASSIFICATIONS.has(rawClassification) ? rawClassification : '',
    llcCode: str(body, 'llcCode').toUpperCase(),
    otherText: str(body, 'otherText'),
    foreignPartners: bool(body, 'foreignPartners'),
    exemptPayeeCode: str(body, 'exemptPayeeCode'),
    fatcaCode: str(body, 'fatcaCode'),
    address: str(body, 'address'),
    cityStateZip: str(body, 'cityStateZip'),
    accountNumbers: str(body, 'accountNumbers'),
    tinType: str(body, 'tinType') === 'ein' ? 'ein' : str(body, 'tinType') === 'ssn' ? 'ssn' : '',
    tin: str(body, 'tin'),
    signaturePng: str(body, 'signaturePng'),
    certified: bool(body, 'certified'),
  };

  /*
   * Read from the database, never from the body. "There is already a number on
   * file, so this blank field means keep it" is a claim that decides whether a
   * taxpayer number gets written, and a browser does not get to make it.
   */
  let tinOnFile: 'ssn' | 'ein' | null = null;
  if (state.w9) {
    try {
      tinOnFile = (await readW9(viewer.id))?.tinType ?? null;
    } catch (error) {
      return storeResponse(error);
    }
  }

  const problems = w9Problems(input, { tinOnFile });
  if (Object.keys(problems).length > 0) return invalid(problems);

  if (input.signaturePng.length > 600_000) {
    return invalid({ signaturePng: 'That signature is too large. Clear it and sign again.' });
  }

  try {
    await saveW9(
      viewer.id,
      {
        ...input,
        // Narrowed by the validation above, which the type system cannot see.
        classification: input.classification as W9Classification,
        tinType: input.tinType as 'ssn' | 'ein',
        // Empty on purpose keeps the sealed number; empty for any other reason
        // was rejected two lines up.
        tin: keepsTin(input, { tinOnFile }) ? '' : input.tin,
      },
      meta,
      FORM_REVISION,
    );
  } catch (error) {
    return storeResponse(error);
  }

  await noteSubmission(viewer.id, state, 'w9');

  return NextResponse.json({ ok: true, next: nextPath(state, 'w9', approval, bypass) });
}
