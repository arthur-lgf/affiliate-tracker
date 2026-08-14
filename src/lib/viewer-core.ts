/**
 * Resolving a session into a viewer, with no framework entanglement.
 *
 * This module deliberately imports nothing from `next/headers`,
 * `next/navigation` or `react`. Those belong to the React Server Component
 * layer, and pulling them into a module that route handlers also import makes
 * the route handler's module graph unbuildable — the build compiles and then
 * fails to collect the route, which is a confusing way to learn about a layering
 * mistake.
 *
 * So the split is:
 *
 *   viewer-core.ts  what a viewer is, and how a session becomes one  (both)
 *   viewer.ts       cookies(), headers(), redirect()                 (pages)
 *   api-auth.ts     a Request in, a 401/403 out                      (routes)
 */

import {
  adminUser,
  basicAuthEnabled,
  ENV_ADMIN_ID,
  envCredentialsValid,
  type Role,
  type Session,
} from './auth';
import { findUserById, usersEnabled } from './users';

export type Viewer = {
  id: string;
  username: string;
  role: Role;
  /** The tracking key this viewer is confined to. Always '' for an admin. */
  usr: string;
  /** The ADMIN_USER/ADMIN_PASSWORD account, which has no database row. */
  isEnvAdmin: boolean;
  /**
   * True when nothing is configured to sign in with, i.e. local development
   * with no ADMIN_PASSWORD. The middleware lets every request through in that
   * state, so this exists to make the pages agree with it rather than showing
   * a signed-out shell over an open app.
   */
  open: boolean;
};

export function envAdminViewer(): Viewer {
  return {
    id: ENV_ADMIN_ID,
    username: adminUser().toLowerCase(),
    role: 'admin',
    usr: '',
    isEnvAdmin: true,
    open: false,
  };
}

export function openViewer(): Viewer {
  return {
    id: 'open',
    username: adminUser().toLowerCase(),
    role: 'admin',
    usr: '',
    isEnvAdmin: false,
    open: true,
  };
}

export function isAdmin(viewer: Viewer | null): boolean {
  return viewer?.role === 'admin';
}

/**
 * Turn a verified session into a viewer, checking the account is still what the
 * cookie says it is.
 *
 * The middleware already proved the cookie is signed and unexpired, but it runs
 * on the Edge and cannot reach Postgres, so that is all it can prove. A cookie
 * stays valid for up to SESSION_HOURS, and in that window an account can be
 * disabled, deleted, demoted, rebound to a different tracking key, or have its
 * password reset. The cookie identifies; this function authorises.
 */
export async function resolveSession(session: Session): Promise<Viewer | null> {
  if (session.uid === ENV_ADMIN_ID) {
    // The env account exists only while the password does. Clearing
    // ADMIN_PASSWORD must not leave its cookies working.
    return process.env.ADMIN_PASSWORD ? envAdminViewer() : null;
  }

  if (!usersEnabled()) return null;

  const account = await findUserById(session.uid);
  if (!account) return null;
  if (!account.active) return null;

  // A password reset (or a disable) moves password_changed_at forward, which
  // retires every token minted before it. This is the whole revocation story
  // for a stateless cookie, so it is checked before anything else is trusted.
  const changedAt = Date.parse(account.passwordChangedAt);
  if (Number.isFinite(changedAt) && changedAt > session.pwdAt) return null;

  return {
    id: account.id,
    username: account.username,
    // From the row, not the cookie: a demotion has to bite inside the life of
    // an already-issued session.
    role: account.role,
    usr: account.role === 'admin' ? '' : account.usr,
    isEnvAdmin: false,
    open: false,
  };
}

/**
 * HTTP Basic, kept so an existing `curl -u` or script does not break, and only
 * when ALLOW_BASIC_AUTH=true. The environment account only: verifying a
 * database password here would mean a PBKDF2 derivation on every request, with
 * no session to amortise it over.
 */
export function readBasic(header: string | null): Viewer | null {
  // Same opt-in as the middleware. Without this check the middleware could be
  // refusing Basic while the pages happily accepted it, which is the kind of
  // disagreement between two layers that turns into a bypass.
  if (!basicAuthEnabled()) return null;
  if (!header?.startsWith('Basic ')) return null;

  let decoded: string;
  try {
    // atob yields bytes, not characters. Decoding them as UTF-8 is what makes a
    // password containing any non-ASCII character work at all.
    const bytes = Uint8Array.from(atob(header.slice(6)), (char) => char.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return null;
  }

  const separator = decoded.indexOf(':');
  const user = separator === -1 ? '' : decoded.slice(0, separator);
  const pass = separator === -1 ? decoded : decoded.slice(separator + 1);
  return envCredentialsValid(user, pass) ? envAdminViewer() : null;
}

export function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
