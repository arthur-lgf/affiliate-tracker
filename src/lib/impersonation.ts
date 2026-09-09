/**
 * Viewing the app as one of your affiliates.
 *
 * An admin asking "what does Sam actually see when they sign in?" had no way to
 * find out. /affiliate/[usr] shows an admin page *about* Sam — a different
 * layout with different controls. This gives them Sam's own.
 *
 * HOW IT WORKS, AND WHY IT IS A SECOND COOKIE
 *
 * The session cookie is never touched. A separate, short-lived, signed ticket
 * says "this admin is currently looking as this affiliate", and the viewer layer
 * applies it on top of the real session. That ordering is the whole design:
 *
 *   - The real identity stays provable, so Exit always works and cannot be
 *     locked out by the impersonated account being disabled mid-session.
 *   - Losing the ticket degrades to being yourself, which is the safe direction.
 *     Losing a swapped session cookie would mean being signed in as somebody
 *     else with no way back.
 *   - The ticket alone grants nothing. applyViewAs refuses unless the *real*
 *     viewer is an admin, so a forged ticket in an affiliate's cookie jar is
 *     inert.
 *
 * WHAT AN ADMIN CAN DO WHILE LOOKING
 *
 * Everything that affiliate can do, including submitting their forms. That was
 * a deliberate call, taken over a read-only view so an admin can unstick
 * somebody's onboarding for them. The consequence belongs next to the code: an
 * agreement or a W-9 submitted this way is stored exactly as if that affiliate
 * had submitted it. `actingAs` on the viewer, and the audit line the API logs,
 * are the only record that it was not.
 */

import { signingSecret, signPayload, timingSafeEqual } from './auth';
import { base64UrlDecode, base64UrlEncode } from './base64url';
import { findUserById } from './users';
import type { Viewer } from './viewer-core';

export const VIEW_AS_COOKIE = 'ledger_view_as';

/**
 * A different HKDF info string from the session cookie's, so the two are signed
 * with genuinely different keys. Without it either cookie would carry a valid
 * signature for the other, leaving only payload validation to refuse it.
 */
const VIEW_AS_HMAC_INFO = 'view-as-cookie-hmac';

/**
 * Much shorter than a session, on purpose. Looking as somebody else is what you
 * do for a minute to answer a question; an admin who wanders off should not
 * still be Sam tomorrow morning.
 */
const DEFAULT_MINUTES = 60;

export type ViewAsTicket = {
  v: 1;
  /** The admin who started it. Restored on exit, and named in the banner. */
  by: string;
  byName: string;
  /** The account being viewed. */
  uid: string;
  user: string;
  /** Their tracking key. Never '' — see readViewAsToken. */
  usr: string;
  expiresAt: number;
};

export type ViewAsSubject = Omit<ViewAsTicket, 'v' | 'expiresAt'>;

const encoder = new TextEncoder();

export function viewAsMinutes(): number {
  const raw = Number(process.env.VIEW_AS_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 12 * 60) return DEFAULT_MINUTES;
  return raw;
}

/** `<base64url payload>.<base64url hmac>`, the same shape as a session token. */
export async function createViewAsToken(
  subject: ViewAsSubject,
  now = Date.now(),
): Promise<string> {
  const secret = signingSecret();
  if (!secret) {
    throw new Error(
      'Cannot start a view-as session: neither SESSION_SECRET nor ADMIN_PASSWORD is set.',
    );
  }

  const ticket: ViewAsTicket = {
    v: 1,
    by: subject.by,
    byName: subject.byName,
    uid: subject.uid,
    user: subject.user,
    usr: subject.usr,
    expiresAt: now + viewAsMinutes() * 60 * 1000,
  };
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(ticket)));
  return `${payload}.${await signPayload(payload, secret, VIEW_AS_HMAC_INFO)}`;
}

/**
 * The ticket, only when the signature verifies and it has not expired.
 *
 * Anything malformed is null rather than a throw: a corrupt ticket should leave
 * an admin as themselves, not on an error page.
 */
export async function readViewAsToken(
  token: string | undefined | null,
  now = Date.now(),
): Promise<ViewAsTicket | null> {
  if (!token) return null;
  const secret = signingSecret();
  if (!secret) return null;

  const dot = token.indexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let expected: string;
  try {
    expected = await signPayload(payload, secret, VIEW_AS_HMAC_INFO);
  } catch {
    return null;
  }
  if (!timingSafeEqual(signature, expected)) return null;

  const bytes = base64UrlDecode(payload);
  if (!bytes) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const { v, by, byName, uid, user, usr, expiresAt } = parsed as Partial<ViewAsTicket>;

  if (v !== 1) return null;
  if (typeof by !== 'string' || by.length === 0) return null;
  if (typeof byName !== 'string' || byName.length === 0) return null;
  if (typeof uid !== 'string' || uid.length === 0) return null;
  if (typeof user !== 'string' || user.length === 0) return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= now) return null;

  // An admin's tracking key is always ''. A ticket without one therefore names
  // an admin or nobody: the first would be a way to climb from admin to admin,
  // the second would scope to nothing while claiming to be somebody. Both are
  // refused here rather than left to each caller to remember.
  if (typeof usr !== 'string' || usr.length === 0) return null;

  return { v, by, byName, uid, user, usr, expiresAt };
}

/**
 * The viewer an admin becomes while looking, or null to leave them as they are.
 *
 * Null means "not impersonating" in every failure case, so a caller that forgets
 * to check gets the real viewer rather than a half-applied one.
 */
export function applyViewAs(real: Viewer | null, ticket: ViewAsTicket | null): Viewer | null {
  if (!ticket) return null;

  // The ticket is a claim about who is being viewed, never about who may view.
  // That question is answered by the session, which is why a forged ticket in an
  // affiliate's cookie jar does nothing at all.
  if (!real) return null;
  if (real.role !== 'admin') return null;

  // Bound to the admin who minted it, not merely to "an admin".
  //
  // Without this, a ticket outlives the session that created it and the next
  // admin to sign in on the same browser silently inherits the impersonation —
  // they are an admin, so every other check here would wave them through, and
  // the banner would name the wrong person while they filled in somebody's W-9.
  if (ticket.by !== real.id) return null;

  // No chaining. An already-impersonated viewer carries an affiliate's role and
  // would be refused above; this is the belt to that braces, and it says so.
  if (real.actingAs) return null;

  return {
    id: ticket.uid,
    username: ticket.user,
    role: 'affiliate',
    usr: ticket.usr,
    isEnvAdmin: false,
    open: false,
    actingAs: { adminId: real.id, adminName: real.username },
  };
}

/**
 * Read a ticket, apply it, and re-check the account it names — the whole of
 * "who is looking" in one call, for both the page and the route entry points.
 *
 * The re-check is the part worth explaining. A ticket is a claim frozen at the
 * moment it was minted, and it can outlive the truth: in the hour it lives, the
 * affiliate it names can be disabled, deleted, or rebound to a different
 * tracking key by another admin. resolveSession already refuses to trust a
 * session cookie for exactly that reason — "the cookie identifies; this
 * function authorises" — and a borrowed identity deserves the same treatment,
 * or it would be the one way to keep operating as an account that has been
 * switched off.
 */
export async function resolveViewAs(
  real: Viewer | null,
  token: string | undefined | null,
): Promise<Viewer | null> {
  const acting = applyViewAs(real, await readViewAsToken(token));
  if (!acting) return null;

  const account = await findUserById(acting.id);
  if (!account) return null;
  if (!account.active) return null;
  // Promoted, or rebound to a different key, since the ticket was minted. Either
  // way the ticket describes somebody who no longer exists in that shape.
  if (account.role !== 'affiliate') return null;
  if (account.usr !== acting.usr) return null;

  return acting;
}

export function viewAsCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: viewAsMinutes() * 60,
  };
}

/** Clearing means an immediate expiry, with the same attributes it was set with. */
export function clearedViewAsCookieOptions(secure: boolean) {
  return { ...viewAsCookieOptions(secure), maxAge: 0 };
}
