/**
 * Sign-in credentials and the signed cookie that remembers them.
 *
 * Everything here is Web Crypto and holds no database import, because the
 * middleware runs it on the Edge runtime on every single request. That
 * constraint shapes the whole design:
 *
 *   - The middleware can only do what a cookie's own bytes allow: check the
 *     signature, check the expiry, read the role. It cannot ask whether the
 *     account still exists.
 *   - So the cookie is a *claim*, not proof. Every gated page and route
 *     re-checks it against the users table server-side (see lib/viewer.ts),
 *     which is where "deleted", "disabled" and "password was reset" are caught.
 *
 * Two kinds of account exist:
 *
 *   - The env account, ADMIN_USER / ADMIN_PASSWORD. Always an admin, never
 *     stored in the database, and the way back in when the users table is
 *     empty or wrong. It is how the first database admin gets created.
 *   - Database accounts, in public.users, created by an admin.
 */

import { base64UrlDecode, base64UrlEncode } from './base64url';

export const SESSION_COOKIE = 'ledger_session';

/** How long a sign-in lasts. A day's work, not a fortnight. */
const DEFAULT_SESSION_HOURS = 12;

export type Role = 'admin' | 'affiliate';

/** The id the env account carries. No database row can collide: ids there are minted without a colon. */
export const ENV_ADMIN_ID = 'env:admin';

export type Session = {
  /**
   * Bumped when the payload shape changes. A v1 cookie (single admin, no role)
   * fails this check and its holder is asked to sign in again, which is the
   * correct outcome: there is no way to tell what that cookie should now be
   * allowed to see.
   */
  v: 2;
  uid: string;
  user: string;
  role: Role;
  /** Tracking key this session is scoped to. Always '' for an admin. */
  usr: string;
  /** users.password_changed_at, in ms, at the moment the token was minted. 0 for the env account. */
  pwdAt: number;
  expiresAt: number;
};

export function adminUser(): string {
  return process.env.ADMIN_USER?.trim() || 'admin';
}

export function adminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? '';
}

/**
 * The secret the cookie is signed with.
 *
 * SESSION_SECRET first, then ADMIN_PASSWORD. Falling back to the password
 * keeps the old property that rotating it signs everyone out, which is usually
 * what you want after someone leaves — but it also means that with database
 * accounts in play, changing the env password logs out every affiliate too.
 * Setting SESSION_SECRET explicitly is what decouples the two.
 */
function signingSecret(): string | null {
  const explicit = process.env.SESSION_SECRET?.trim();
  if (explicit) return `v2:${explicit}`;
  const password = adminPassword();
  if (password) return `v2:${password}`;
  return null;
}

/**
 * Whether the admin surface is gated at all.
 *
 * True as soon as there is anything to sign a cookie with. This is what the
 * middleware asks, so it must be answerable on the Edge from environment
 * variables alone — it cannot depend on whether the users table has rows.
 *
 * The consequence worth stating plainly: creating database users but setting
 * neither SESSION_SECRET nor ADMIN_PASSWORD leaves the app open. That
 * combination is refused at sign-in and reported on the users page.
 */
export function authConfigured(): boolean {
  return signingSecret() !== null;
}

export function sessionHours(): number {
  const raw = Number(process.env.SESSION_HOURS);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 24 * 30) return DEFAULT_SESSION_HOURS;
  return raw;
}

/**
 * Length-independent comparison.
 *
 * Compares to a fixed number of rounds so the loop count cannot leak the length
 * of the expected value, and folds any length difference into the result.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const rounds = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < rounds; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Whether HTTP Basic is accepted at all.
 *
 * Off unless asked for. Basic is a credential presented fresh on every request,
 * with no session to rate-limit behind and no cookie to expire, which made it a
 * clean password-guessing oracle against the one environment account: a wrong
 * pair is a redirect, a right pair is the dashboard, and there is no lockout in
 * between. It stays available for the `curl -u` case, but as something a
 * deployment opts into rather than something every deployment carries.
 */
export function basicAuthEnabled(): boolean {
  return process.env.ALLOW_BASIC_AUTH === 'true';
}

/**
 * The env account only. Database accounts are verified in lib/users.ts, which
 * needs the database and therefore cannot be reached from here.
 *
 * Both halves are always checked, so a wrong username costs the same as a wrong
 * password.
 */
export function envCredentialsValid(user: string, password: string): boolean {
  const expected = adminPassword();
  if (!expected) return false;
  const userOk = timingSafeEqual(user.toLowerCase(), adminUser().toLowerCase());
  const passOk = timingSafeEqual(password, expected);
  return userOk && passOk;
}

/* ---------------------------------------------------------------- */
/* Cookie signing                                                     */
/* ---------------------------------------------------------------- */

const encoder = new TextEncoder();

/**
 * Derived keys, cached by the secret they came from.
 *
 * The derivation is cheap but it happens on every request that carries a
 * cookie, which on the Edge is every request to a gated path.
 */
const keyCache = new Map<string, Promise<CryptoKey>>();

/**
 * The HMAC key, derived from the secret rather than being the secret.
 *
 * This matters because the secret is usually ADMIN_PASSWORD — something a
 * person chose and can remember. A token is `payload.HMAC(payload, key)`, and
 * both halves travel in a cookie: anyone who captures one (a proxy log, a
 * shared machine, a screenshot) can run a wordlist against it offline and
 * recover the key. When the key *is* the password, that is the password.
 *
 * HKDF does not make a weak password strong — it is not a slow KDF and is not
 * meant to be — but it means the value recovered is a derived key rather than
 * the password itself, so cracking a cookie no longer hands over the thing that
 * is also typed into the sign-in form. Rotating ADMIN_PASSWORD still changes
 * the derived key, so it still signs everyone out.
 */
async function hmacKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret);
  if (cached) return cached;

  const derived = (async () => {
    const ikm = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        // A fixed, public salt. HKDF's salt is a domain separator here, not a
        // secret: there is nowhere to keep a random one that every instance
        // would agree on, and its job is only to stop this key colliding with
        // some other use of the same input.
        salt: encoder.encode('ledger.session.v2'),
        info: encoder.encode('session-cookie-hmac'),
      },
      ikm,
      256,
    );
    return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  })();

  keyCache.set(secret, derived);
  return derived;
}

async function sign(payload: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

export type SessionSubject = {
  uid: string;
  user: string;
  role: Role;
  usr: string;
  pwdAt: number;
};

/** `<base64url payload>.<base64url hmac>` */
export async function createSessionToken(
  subject: SessionSubject,
  now = Date.now(),
): Promise<string> {
  const secret = signingSecret();
  if (!secret) throw new Error('Cannot mint a session: neither SESSION_SECRET nor ADMIN_PASSWORD is set.');

  const session: Session = {
    v: 2,
    uid: subject.uid,
    user: subject.user,
    // An admin is scoped to nothing because it sees everything. Forcing '' here
    // rather than trusting the caller means a stray usr on an admin subject can
    // never become a filter that quietly hides rows from them.
    role: subject.role,
    usr: subject.role === 'admin' ? '' : subject.usr,
    pwdAt: subject.pwdAt,
    expiresAt: now + sessionHours() * 3600 * 1000,
  };
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(session)));
  return `${payload}.${await sign(payload, secret)}`;
}

/**
 * Returns the session only when the signature verifies AND it has not expired.
 * Anything malformed is a null rather than a throw — a corrupt cookie should
 * land someone on the sign-in page, not on a 500.
 */
export async function readSessionToken(
  token: string | undefined | null,
  now = Date.now(),
): Promise<Session | null> {
  if (!token) return null;
  const secret = signingSecret();
  if (!secret) return null;

  const dot = token.indexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let expected: string;
  try {
    expected = await sign(payload, secret);
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
  const { v, uid, user, role, usr, pwdAt, expiresAt } = parsed as Partial<Session>;

  if (v !== 2) return null;
  if (typeof uid !== 'string' || uid.length === 0) return null;
  if (typeof user !== 'string' || user.length === 0) return null;
  if (role !== 'admin' && role !== 'affiliate') return null;
  if (typeof usr !== 'string') return null;
  if (typeof pwdAt !== 'number' || !Number.isFinite(pwdAt)) return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= now) return null;

  // An admin session must carry no scope. A cookie claiming both would, if any
  // future caller read `usr` without checking `role` first, be an admin whose
  // view is silently filtered — or worse, an affiliate whose scope is ignored.
  if (role === 'admin' && usr !== '') return null;
  if (role === 'affiliate' && usr === '') return null;

  // The env account's username is part of what is signed, so a cookie issued
  // under a previous ADMIN_USER stops working the moment the name changes.
  if (uid === ENV_ADMIN_ID && !timingSafeEqual(user, adminUser().toLowerCase())) return null;

  return { v, uid, user, role, usr, pwdAt, expiresAt };
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: sessionHours() * 3600,
  };
}

/** Clearing means an immediate expiry, with the same attributes it was set with. */
export function clearedSessionCookieOptions(secure: boolean) {
  return { ...sessionCookieOptions(secure), maxAge: 0 };
}

/* ---------------------------------------------------------------- */
/* Redirect targets                                                   */
/* ---------------------------------------------------------------- */

/**
 * Where to send someone after they sign in.
 *
 * Only a path on this site is ever honoured. `//evil.example` and
 * `/\evil.example` are both browser-legal ways of writing an absolute URL, so
 * anything that is not a plain single-slash path collapses to the dashboard —
 * otherwise the sign-in form is an open redirect with a password prompt
 * attached, which is exactly the shape a phishing link wants.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  // Control characters can smuggle a header or a second URL past a naive
  // check. Tested by code point rather than a regex range: writing that range
  // as a literal means putting the control bytes into this file.
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return '/';
  }
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  if (raw.includes('\\')) return '/';
  if (raw.startsWith('/login')) return '/';
  return raw;
}
