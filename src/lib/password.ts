/**
 * Password hashing, and the random passwords the admin hands out.
 *
 * PBKDF2-HMAC-SHA256 through Web Crypto. Not because it is the strongest KDF —
 * scrypt and argon2 both resist a GPU better — but because it is the only
 * memory-hard-ish option available in every runtime this app has to work in
 * (Node, Vercel's serverless functions, the Edge middleware) with no native
 * module and no dependency. bcrypt and argon2 both mean a compiled binary that
 * has to match the deployment target, and this app is deliberately dependency
 * light.
 *
 * The iteration count is stored alongside each hash. Raising ITERATIONS later
 * therefore costs nothing: old hashes keep verifying at the count they were
 * written with, and each one is silently re-hashed at the new count the next
 * time its owner signs in successfully (see `needsRehash`).
 */

import { base64UrlDecode, base64UrlEncode } from './base64url';

/**
 * OWASP's 2023 floor for PBKDF2-HMAC-SHA256. Costs roughly a third of a second
 * per sign-in, which is the point: it is the same third of a second for every
 * guess an attacker makes against a stolen hash.
 */
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

const ALGORITHM = 'pbkdf2-sha256';

const encoder = new TextEncoder();

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    // BufferSource: a plain Uint8Array is accepted at runtime, but the DOM lib
    // types want an ArrayBuffer, and .buffer on a view is not always the whole
    // buffer. Slicing is the honest way to hand over exactly these bytes.
    { name: 'PBKDF2', salt: salt.slice().buffer as ArrayBuffer, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** `pbkdf2-sha256$<iterations>$<salt>$<hash>` */
export async function hashPassword(password: string, iterations = ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `${ALGORITHM}$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(hash)}`;
}

/**
 * Byte-wise comparison that always looks at every byte.
 *
 * A `===` on the encoded hash would return on the first differing character,
 * and the time that takes is a measurement of how much of the hash an attacker
 * has guessed correctly.
 */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const rounds = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < rounds; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/**
 * False for anything that is not a valid hash of this password, including a
 * stored value that is malformed, truncated, or written by some other algorithm.
 * A hash we cannot parse must never verify: "unrecognised" is not "matches".
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4) return false;

  const [algorithm, iterationsRaw, saltRaw, hashRaw] = parts as [string, string, string, string];
  if (algorithm !== ALGORITHM) return false;

  const iterations = Number(iterationsRaw);
  // An attacker who can write to the users table could otherwise set iterations
  // to 1 and make every hash cheap to crack, or to 2^31 and hang the process.
  if (!Number.isInteger(iterations) || iterations < 1_000 || iterations > 5_000_000) return false;

  const salt = base64UrlDecode(saltRaw);
  const expected = base64UrlDecode(hashRaw);
  if (!salt || !expected || salt.length === 0 || expected.length === 0) return false;

  let actual: Uint8Array;
  try {
    actual = await derive(password, salt, iterations);
  } catch {
    return false;
  }
  return timingSafeEqualBytes(actual, expected);
}

/** Whether a stored hash was written at a weaker setting than we use now. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== ALGORITHM) return true;
  const iterations = Number(parts[1]);
  return !Number.isInteger(iterations) || iterations < ITERATIONS;
}

/* ------------------------------------------------------------------ */
/* Generated passwords                                                  */
/* ------------------------------------------------------------------ */

/**
 * No `i`, `l`, `o`, `0` or `1`. This password is going to be read off a screen
 * and typed in by hand, quite possibly read aloud down a phone, and the pairs
 * that collide when you do that are worth more than the 5 bits they cost.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const GROUPS = 4;
const GROUP_SIZE = 4;

/**
 * Uniform over the alphabet.
 *
 * `random % 31` would be biased: 256 is not a multiple of 31, so the first four
 * letters would come up slightly more often than the rest. Values in the
 * non-uniform tail are discarded and redrawn instead.
 */
function randomChar(): string {
  const limit = 256 - (256 % ALPHABET.length);
  const buffer = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const byte = buffer[0]!;
    if (byte < limit) return ALPHABET[byte % ALPHABET.length]!;
  }
}

/**
 * Sixteen characters from a 31-letter alphabet, hyphenated into fours: about
 * 79 bits, which is far past anything an online guesser reaches through a rate
 * limiter, and is shown exactly once.
 */
export function generatePassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let group = '';
    for (let c = 0; c < GROUP_SIZE; c += 1) group += randomChar();
    groups.push(group);
  }
  return groups.join('-');
}
