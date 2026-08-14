/**
 * The tracking key an affiliate account is bound to — the `usr=` on their links.
 *
 * Generated rather than typed. When an admin chose it by hand the obvious
 * choice was the person's first name, which meant the key was both guessable
 * and personal: it appears in every link they share, so it travels to the
 * merchant, into referrer headers, and into anyone else's browser history. Two
 * people called Mark also collided, and the second one silently could not be
 * created.
 *
 * Six characters is not a secret and is not treated as one — scoping is decided
 * by the signed session, never by the key in a URL. It only has to be short
 * enough to sit in a link and unique enough not to collide.
 */

/**
 * No `i`, `l`, `o`, `0` or `1`. A tracking key gets read off a screen, dictated
 * over a phone, and typed into a browser bar; the characters that collide when
 * that happens cost more than the handful of bits they save.
 *
 * Lowercase only, so the value satisfies both usrSchema and the database's
 * users_usr_shape_check without any normalisation on the way in.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const LENGTH = 6;

/**
 * Uniform over the alphabet.
 *
 * `byte % 31` would be biased — 256 is not a multiple of 31, so the first four
 * characters would come up slightly more often. Values in the non-uniform tail
 * are discarded and redrawn.
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

/** Six characters from a 31-letter alphabet: about 887 million possibilities. */
export function newTrackingKey(): string {
  let key = '';
  for (let i = 0; i < LENGTH; i += 1) key += randomChar();
  return key;
}

/**
 * Whether a value is one of ours.
 *
 * Deliberately not used to validate stored keys: accounts created before this
 * existed carry hand-picked keys like "mark", and those stay valid. This is for
 * telling a generated key from a typed one when it matters.
 */
export function isTrackingKey(value: string): boolean {
  return new RegExp(`^[${ALPHABET}]{${LENGTH}}$`).test(value);
}
