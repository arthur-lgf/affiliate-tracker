/**
 * Admin sign-in: credentials, and the signed cookie that remembers them.
 *
 * One account, held in the environment — there is no user table and this tool
 * does not need one. `ADMIN_USER` is the username (default "admin") and
 * `ADMIN_PASSWORD` is the password; with the password unset there is no admin
 * account at all and the middleware decides what that means.
 *
 * Everything here is Web Crypto and runs unchanged on the Edge runtime, because
 * the middleware is the thing that has to verify a session on every request.
 */

export const SESSION_COOKIE = 'ledger_session';

/** How long a sign-in lasts. A day's work, not a fortnight. */
const DEFAULT_SESSION_HOURS = 12;

export type Session = { user: string; expiresAt: number };

export function adminUser(): string {
  return process.env.ADMIN_USER?.trim() || 'admin';
}

export function adminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? '';
}

/** Whether a password has been set, i.e. whether the admin surface is gated. */
export function authConfigured(): boolean {
  return adminPassword().length > 0;
}

export function sessionHours(): number {
  const raw = Number(process.env.SESSION_HOURS);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 24 * 30) return DEFAULT_SESSION_HOURS;
  return raw;
}

/**
 * The HMAC key for session cookies.
 *
 * Derived from the password unless SESSION_SECRET is set, which gives a
 * property worth having: changing ADMIN_PASSWORD invalidates every cookie
 * signed with the old one, so rotating the password really does sign everyone
 * out rather than leaving live sessions behind it.
 */
function signingSecret(): string {
  const explicit = process.env.SESSION_SECRET?.trim();
  if (explicit) return `v1:${explicit}`;
  return `v1:${adminPassword()}`;
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

/** Both halves are always checked, so a wrong username costs the same as a wrong password. */
export function credentialsValid(user: string, password: string): boolean {
  if (!authConfigured()) return false;
  const userOk = timingSafeEqual(user, adminUser());
  const passOk = timingSafeEqual(password, adminPassword());
  return userOk && passOk;
}

/* ---------------------------------------------------------------- */
/* Cookie signing                                                     */
/* ---------------------------------------------------------------- */

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function sign(payload: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

/** `<base64url payload>.<base64url hmac>` */
export async function createSessionToken(user: string, now = Date.now()): Promise<string> {
  const session: Session = {
    user,
    expiresAt: now + sessionHours() * 3600 * 1000,
  };
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(session)));
  return `${payload}.${await sign(payload)}`;
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
  const dot = token.indexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let expected: string;
  try {
    expected = await sign(payload);
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
  const { user, expiresAt } = parsed as Partial<Session>;
  if (typeof user !== 'string' || typeof expiresAt !== 'number') return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  // The username is part of the signed payload, so a cookie issued for a
  // previous ADMIN_USER stops working the moment the username changes.
  if (!timingSafeEqual(user, adminUser())) return null;

  return { user, expiresAt };
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
