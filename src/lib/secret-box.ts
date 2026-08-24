/**
 * The two numbers in this app that must not be readable from a database dump:
 * a Social Security number and a bank account number.
 *
 * Everything else here is protected the way the rest of the schema is — RLS on,
 * no policies, revoked from anon and authenticated, service-role reads only.
 * That is a good access model and it is not enough for these two. An SSN is not
 * a fact about somebody's business, it is the number that opens credit in their
 * name for the rest of their life, and the failure mode of "the access model
 * held right up until it didn't" is not one you can apologise your way out of.
 *
 * So they are sealed before they are stored. AES-256-GCM: authenticated, so a
 * tampered ciphertext fails to open rather than decrypting to something else,
 * with a fresh random IV per value so two people with the same last four digits
 * do not produce the same ciphertext.
 *
 * The key lives in ONBOARDING_SECRET_KEY, apart from the database, so reading
 * the rows and holding the key are two separate compromises.
 *
 * Losing the key means losing the plaintext. That is the deal, and it is the
 * right way round: an unrecoverable SSN is a nuisance (ask them again), a
 * recoverable-by-anyone SSN is a breach.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ENV_KEY = 'ONBOARDING_SECRET_KEY';

/** `v1.iv.tag.ciphertext`, each part base64url. The prefix is what lets the
 *  scheme change later without every stored value becoming ambiguous. */
const VERSION = 'v1';

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

/**
 * Derived once, then held. scrypt is deliberately slow — that is the point of
 * it — and paying 100ms on every W-9 read would be paying it for nothing, since
 * the input never changes within a process.
 */
let cachedKey: Buffer | null = null;
let cachedFrom = '';

/**
 * A 32-byte key from whatever the environment holds.
 *
 * Three shapes accepted, in order: 64 hex characters, 44 characters of base64,
 * or any other string at all — which is stretched with scrypt rather than
 * refused. The last case is the one that matters in practice: somebody will
 * paste a passphrase, and the choice is between deriving a real key from it and
 * having the feature not work.
 *
 * The salt is fixed and public. That is fine here and would not be for
 * passwords: a salt exists to stop one precomputed table breaking many secrets,
 * and there is exactly one secret.
 */
function keyFrom(raw: string): Buffer {
  if (cachedKey && cachedFrom === raw) return cachedKey;

  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    const base64 = Buffer.from(raw, 'base64');
    if (base64.length === 32 && base64.toString('base64').replace(/=+$/, '') === raw.replace(/=+$/, '')) {
      key = base64;
    }
  }
  if (!key) key = scryptSync(raw, 'ledger.onboarding.v1', 32);

  cachedKey = key;
  cachedFrom = raw;
  return key;
}

/** Whether anything can be sealed at all. */
export function secretsConfigured(): boolean {
  return (process.env[ENV_KEY] ?? '').trim().length >= 16;
}

function requireKey(): Buffer {
  const raw = (process.env[ENV_KEY] ?? '').trim();
  if (raw.length < 16) {
    throw new SecretBoxError(
      `Set ${ENV_KEY} to a long random string before collecting taxpayer or bank details. ` +
        'Without it there is nowhere safe to put them, and storing them in the clear is not an option this app offers.',
    );
  }
  return keyFrom(raw);
}

/** Plaintext in, one opaque string out. */
export function seal(plaintext: string): string {
  if (!plaintext) throw new SecretBoxError('Nothing to seal.');
  const key = requireKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), body.toString('base64url')].join('.');
}

/**
 * Back again, or an error.
 *
 * Never returns a partial or a guess: a value that will not open is either a
 * value sealed under a different key or a value somebody has edited, and both
 * of those should stop a page rather than silently produce a wrong SSN.
 */
export function open(sealed: string): string {
  const key = requireKey();
  const parts = (sealed ?? '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretBoxError('That value was not sealed by this application.');
  }
  try {
    const iv = Buffer.from(parts[1]!, 'base64url');
    const tag = Buffer.from(parts[2]!, 'base64url');
    const body = Buffer.from(parts[3]!, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    // The tag check failing is the interesting case and it is indistinguishable
    // from a wrong key, on purpose: telling them apart would tell an attacker
    // which of the two they had got wrong.
    throw new SecretBoxError(
      'That value could not be unsealed. Either ' + ENV_KEY + ' has changed since it was stored, or the row was edited.',
    );
  }
}

/** Whether two sealed values hold the same plaintext, without printing either. */
export function sealedMatches(sealed: string, plaintext: string): boolean {
  try {
    const a = Buffer.from(open(sealed), 'utf8');
    const b = Buffer.from(plaintext, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- masking -- */

/*
 * Re-exported rather than defined here. They live in lib/mask.ts because the
 * browser needs them — the onboarding form checks the shape of a number before
 * it sends it, and the admin table draws the mask — and a client component
 * importing this file would drag node:crypto into the bundle.
 */
export { digitsOf, formatTin, last4, maskAccount, maskTin, validTin } from './mask';
