import { NextResponse } from 'next/server';
import { requireApiAdmin } from '@/lib/api-auth';
import { formatTin } from '@/lib/mask';
import { revealAccountNumber, revealTin } from '@/lib/onboarding-store';
import { storeResponse } from '@/lib/onboarding-api';

export const dynamic = 'force-dynamic';

/**
 * Unseal one number, once, on purpose.
 *
 * A POST rather than a GET, and that is not pedantry: a GET is something a
 * browser will prefetch, a proxy will cache, a history will keep and a link
 * will repeat. Unsealing a Social Security number should happen because
 * somebody pressed a button, and only then.
 *
 * One number per request, named explicitly. There is no "give me everything"
 * shape here — a page listing twenty affiliates cannot become twenty decrypted
 * SSNs by accident, because it would have to ask twenty times and each one is
 * a deliberate act.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const gate = await requireApiAdmin(request, 'Only an admin can reveal these.');
  if ('response' in gate) return gate.response;

  const { userId } = await context.params;

  let what = '';
  try {
    what = String(((await request.json()) as { what?: unknown })?.what ?? '');
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  try {
    if (what === 'tin') {
      const found = await revealTin(userId);
      if (!found) return NextResponse.json({ error: 'No W-9 on file.' }, { status: 404 });
      return secret({ value: formatTin(found.tin, found.type), kind: found.type });
    }

    if (what === 'account') {
      const number = await revealAccountNumber(userId);
      if (!number) return NextResponse.json({ error: 'No bank details on file.' }, { status: 404 });
      return secret({ value: number, kind: 'account' });
    }

    return NextResponse.json({ error: 'Nothing by that name.' }, { status: 400 });
  } catch (error) {
    return storeResponse(error);
  }
}

function secret(body: { value: string; kind: string }): NextResponse {
  return NextResponse.json(body, {
    headers: {
      // Belt and braces on top of POST: nothing between here and the browser
      // should keep a copy.
      'cache-control': 'no-store, no-cache, must-revalidate, private',
    },
  });
}
