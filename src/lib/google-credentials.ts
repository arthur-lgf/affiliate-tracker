import fs from 'node:fs';
import path from 'node:path';
import { StoreConfigError } from './store/errors';

/**
 * Service-account credentials, from either of two sources.
 *
 *   1. A service-account JSON key file — the whole file downloaded from Google
 *      Cloud, dropped in the project root as `service-account.json` (or pointed
 *      at by GOOGLE_APPLICATION_CREDENTIALS). Easiest locally: no copying keys
 *      out of JSON, no \n escaping to get wrong.
 *   2. GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY environment variables.
 *      Use this on Vercel and other hosts, where there is no filesystem to put
 *      a key file on (and committing one to the repo would leak it).
 *
 * Env vars win when both are present, so a deployed environment is never
 * silently overridden by a stray file.
 *
 * Note the JSON key does NOT contain your spreadsheet id — GOOGLE_SHEET_ID is
 * still required either way.
 */

export type GoogleCredentials = {
  email: string;
  privateKey: string;
  /** Where these came from, for the "how am I configured" message in the UI. */
  source: 'env' | string;
};

const DEFAULT_KEY_FILENAMES = ['service-account.json', 'google-service-account.json'];

function normalizePrivateKey(raw: string): string {
  // A key pasted into .env carries escaped newlines and often surrounding
  // quotes; the same key read from JSON already has real newlines. Accept both.
  return raw.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
}

/** Absolute path of the key file to use, or null if there isn't one. */
export function keyFilePath(): string | null {
  const configured =
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

  if (configured) {
    const resolved = path.isAbsolute(configured)
      ? configured
      : path.join(process.cwd(), configured);
    return fs.existsSync(resolved) ? resolved : null;
  }

  for (const name of DEFAULT_KEY_FILENAMES) {
    const candidate = path.join(process.cwd(), name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

let cached: GoogleCredentials | null = null;

export function resolveGoogleCredentials(): GoogleCredentials | null {
  if (cached) return cached;

  const envEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const envKey = process.env.GOOGLE_PRIVATE_KEY?.trim();
  if (envEmail && envKey) {
    cached = { email: envEmail, privateKey: normalizePrivateKey(envKey), source: 'env' };
    return cached;
  }

  const file = keyFilePath();
  if (!file) return null;

  let parsed: { client_email?: unknown; private_key?: unknown; type?: unknown };
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new StoreConfigError(
      `Could not read the service account key at ${file}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }

  const email = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : '';
  const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key : '';

  if (!email || !privateKey) {
    throw new StoreConfigError(
      `${path.basename(file)} is missing client_email or private_key. ` +
        'Use the JSON key file downloaded from Google Cloud (its "type" is "service_account"), not an OAuth client secret.',
    );
  }

  cached = { email, privateKey: normalizePrivateKey(privateKey), source: file };
  return cached;
}

/** Test seam / used after an env change in dev. */
export function clearCredentialCache(): void {
  cached = null;
}
