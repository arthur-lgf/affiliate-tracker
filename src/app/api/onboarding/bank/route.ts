import { NextResponse } from 'next/server';
import { actorFor, invalid, jsonBody, storeResponse, str } from '@/lib/onboarding-api';
import { bankProblems } from '@/lib/onboarding';
import { saveBank } from '@/lib/onboarding-store';
import { secretsConfigured } from '@/lib/secret-box';

export const dynamic = 'force-dynamic';

/**
 * Step 4: the ACH destination.
 *
 * Upserts, so this is also "change my bank" — people move banks, and the
 * alternative is an admin editing a row by hand.
 */
export async function POST(request: Request) {
  const gate = await actorFor(request, 'bank');
  if ('response' in gate) return gate.response;
  const { viewer } = gate;

  if (!secretsConfigured()) {
    return NextResponse.json(
      {
        error:
          'This deployment cannot accept bank details yet: ONBOARDING_SECRET_KEY is not set. ' +
          'Tell your admin — nothing you typed has been stored.',
      },
      { status: 503 },
    );
  }

  const body = await jsonBody(request);
  if (body && typeof body === 'object' && 'response' in body) {
    return (body as { response: NextResponse }).response;
  }

  const input = {
    accountName: str(body, 'accountName'),
    bankName: str(body, 'bankName'),
    accountNumber: str(body, 'accountNumber'),
  };

  const problems = bankProblems(input);
  if (Object.keys(problems).length > 0) return invalid(problems);

  try {
    await saveBank(viewer.id, input);
  } catch (error) {
    return storeResponse(error);
  }

  return NextResponse.json({ ok: true, next: '/' });
}
