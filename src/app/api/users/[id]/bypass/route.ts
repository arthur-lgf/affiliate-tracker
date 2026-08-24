import { NextResponse } from 'next/server';
import { requireApiAdmin } from '@/lib/api-auth';
import { MAX_NOTE } from '@/lib/approval';
import { storeResponse } from '@/lib/onboarding-api';
import { setBypass } from '@/lib/onboarding-store';
import { findUserById, usersEnabled } from '@/lib/users';

export const dynamic = 'force-dynamic';

/**
 * Waive the onboarding gate for one account, or put it back.
 *
 * Separate from the review route on purpose. Reviewing is a judgement about
 * paperwork that exists; this is a decision to proceed without it, and they are
 * recorded as two different things because the question an admin asks a month
 * later is "who is still outstanding", which needs both answers to stay
 * distinct.
 *
 * Nothing is emailed. The affiliate finds out by the app simply working, which
 * is the intended experience, and a message saying "you have been let in
 * without the checks" is not one anybody needs to receive.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiAdmin(request, 'Only an admin can waive onboarding.');
  if ('response' in gate) return gate.response;
  const { viewer } = gate;

  if (!usersEnabled()) {
    return NextResponse.json(
      { error: 'Accounts need a database. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 503 },
    );
  }

  const { id } = await context.params;

  let body: { on?: unknown; note?: unknown };
  try {
    body = (await request.json()) as { on?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const on = body.on === true;
  const note = typeof body.note === 'string' ? body.note : '';
  if (note.length > MAX_NOTE) {
    return NextResponse.json(
      { error: 'Please check the highlighted fields.', fields: { note: `Keep it under ${MAX_NOTE} characters.` } },
      { status: 422 },
    );
  }

  const account = await findUserById(id).catch(() => null);
  if (!account) return NextResponse.json({ error: 'No such account.' }, { status: 404 });
  if (account.role !== 'affiliate') {
    // An admin is never gated on onboarding, so waiving it for one would be a
    // column nothing reads.
    return NextResponse.json(
      { error: 'Only affiliate accounts go through onboarding.' },
      { status: 409 },
    );
  }

  try {
    const bypass = await setBypass(id, { on, note, by: viewer.username });
    return NextResponse.json({ ok: true, bypass });
  } catch (error) {
    return storeResponse(error);
  }
}
