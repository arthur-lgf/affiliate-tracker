import { NextResponse } from 'next/server';
import { forbidden, realViewer, unauthorized } from '@/lib/api-auth';
import {
  clearedViewAsCookieOptions,
  createViewAsToken,
  readViewAsToken,
  viewAsCookieOptions,
  VIEW_AS_COOKIE,
} from '@/lib/impersonation';
import { cookieValue } from '@/lib/viewer-core';
import { isSecureRequest } from '@/lib/request';
import { findUserById, usersEnabled } from '@/lib/users';

export const dynamic = 'force-dynamic';

/**
 * Start "view as client".
 *
 * Reasons about the REAL viewer, not the borrowed one. While a ticket is active
 * the ordinary resolver reports an affiliate, and without this an admin already
 * looking as Sam could hop straight to Dana without being themselves in
 * between — which is the shape of a privilege ladder even when both ends are
 * affiliates.
 */
export async function POST(request: Request) {
  const viewer = await realViewer(request);
  if (!viewer) return unauthorized();
  if (viewer.role !== 'admin') return forbidden('Only an administrator can view as a client.');
  // Read from the cookie, not from viewer.actingAs: realViewer() resolves from
  // the session alone and always reports actingAs: null, so a check on the field
  // would never fire and an admin could hop straight from one target to the next
  // with no 'end' between the two audit lines.
  const active = await readViewAsToken(
    cookieValue(request.headers.get('cookie'), VIEW_AS_COOKIE),
  );
  if (active) {
    return forbidden(`You are already viewing as ${active.user}. Stop that first, then start a new one.`);
  }
  if (!usersEnabled()) return forbidden('Viewing as a client needs the accounts database.');

  let body: { userId?: unknown };
  try {
    body = (await request.json()) as { userId?: unknown };
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!userId) return NextResponse.json({ error: 'Which account?' }, { status: 400 });

  const target = await findUserById(userId);
  if (!target) return NextResponse.json({ error: 'That account no longer exists.' }, { status: 404 });

  // Three refusals rather than one: they mean different things, and the person
  // clicking deserves to know which.
  if (target.role === 'admin') {
    return forbidden('Administrators cannot be viewed as. There is nothing there you cannot already see.');
  }
  if (!target.active) {
    return forbidden('That account is disabled, so it has no view to show.');
  }
  if (!target.usr) {
    return forbidden('That account has no tracking key, so there is nothing to scope its view to.');
  }

  let token: string;
  try {
    token = await createViewAsToken({
      by: viewer.id,
      byName: viewer.username,
      uid: target.id,
      user: target.username,
      usr: target.usr,
    });
  } catch {
    // Reachable only with accounts configured but nothing to sign with. A
    // refusal names the problem; a 500 would not.
    return forbidden('Sign-in is not fully configured, so no view-as session can be issued.');
  }

  /*
   * The audit line.
   *
   * While looking, an admin can do everything that affiliate can do, and what
   * they do is stored as that affiliate's own action — an agreement signed this
   * way is indistinguishable from one the affiliate signed. This line is what
   * anyone comes back to when a row is questioned later, so it is written before
   * the cookie is handed out rather than after.
   */
  console.info(
    '[view-as] start',
    JSON.stringify({
      admin: viewer.username,
      adminId: viewer.id,
      target: target.username,
      targetId: target.id,
      usr: target.usr,
      at: new Date().toISOString(),
    }),
  );

  const response = NextResponse.json({ ok: true, username: target.username, usr: target.usr });
  response.cookies.set(VIEW_AS_COOKIE, token, viewAsCookieOptions(isSecureRequest(request)));
  return response;
}

/**
 * Stop looking.
 *
 * Deliberately ungated. Clearing this cookie can only ever return somebody to
 * being themselves, which is the safe direction, and an admin stuck inside a
 * borrowed account that has since been disabled is exactly who needs it to work.
 */
export async function DELETE(request: Request) {
  const viewer = await realViewer(request);

  console.info(
    '[view-as] end',
    JSON.stringify({ admin: viewer?.username ?? 'unknown', at: new Date().toISOString() }),
  );

  const response = NextResponse.json({ ok: true });
  // Cleared with the same attributes it was set with: a cookie whose Secure or
  // Path differs is a different cookie to the browser, and the old one would
  // survive the click meant to remove it.
  response.cookies.set(VIEW_AS_COOKIE, '', clearedViewAsCookieOptions(isSecureRequest(request)));
  return response;
}
