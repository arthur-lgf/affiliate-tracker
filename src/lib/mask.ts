/**
 * Showing enough of a secret number to recognise it, and no more.
 *
 * Kept apart from secret-box.ts, which reaches for node:crypto. These are the
 * half of the job the browser needs — the onboarding form checks the shape of a
 * number before it sends it, and the admin table draws the mask — and importing
 * the sealing code to get them would drag node:crypto into the client bundle
 * and fail the build. lib/campaigns.ts is split from lib/config.ts for exactly
 * the same reason.
 */

/** Just the digits, which is the only part of a TIN or an account number that
 *  means anything. Typed dashes, spaces and brackets are formatting. */
export function digitsOf(value: string): string {
  return (value ?? '').replace(/\D+/g, '');
}

/**
 * The last four, which is what gets stored in the clear beside the ciphertext.
 *
 * Every screen that lists these wants the last four, and decrypting a page of
 * numbers to throw away all but four digits would mean the plaintext sitting in
 * memory constantly to render something that is not secret. Four digits
 * identify a number to the person who already knows it and are useless to
 * anyone else, which is why the whole industry prints them on receipts.
 */
export function last4(value: string): string {
  const digits = digitsOf(value);
  return digits.length >= 4 ? digits.slice(-4) : digits;
}

/** `•••-••-1234` for an SSN, `••-•••1234` for an EIN: each keeps the shape of
 *  the real thing, so an EIN typed into the SSN field is visible as a mask. */
export function maskTin(tail: string, type: 'ssn' | 'ein'): string {
  const tidy = digitsOf(tail).slice(-4);
  if (!tidy) return type === 'ssn' ? '•••-••-••••' : '••-•••••••';
  return type === 'ssn' ? `•••-••-${tidy}` : `••-•••${tidy}`;
}

/** `••••1234`. Bank account numbers have no agreed length, so the mask does not
 *  pretend to know one. */
export function maskAccount(tail: string): string {
  const tidy = digitsOf(tail).slice(-4);
  return tidy ? `••••${tidy}` : '••••';
}

/** A TIN is nine digits, whichever kind it is. */
export function validTin(value: string): boolean {
  return digitsOf(value).length === 9;
}

/**
 * The same dashes, but written in as the number is typed.
 *
 * Differs from formatTin below in the one way that matters at a keyboard: it
 * formats a half-finished number. `1234` becomes `123-4` rather than being
 * handed back raw and jumping into shape only at the ninth digit.
 *
 * A separator is never left dangling on the end. `123` stays `123` instead of
 * becoming `123-`, which is what stops backspace from deadlocking: delete the
 * fourth digit and the dash goes with it, rather than being immediately re-added
 * so the caret can never get past it.
 */
export function formatTinAsTyped(value: string, type: 'ssn' | 'ein'): string {
  const digits = digitsOf(value).slice(0, 9);
  if (type === 'ein') {
    return digits.length <= 2 ? digits : `${digits.slice(0, 2)}-${digits.slice(2)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/** How many characters a fully formatted number takes, so the input can stop
 *  there rather than silently dropping what it will not keep. */
export function tinMaxLength(type: 'ssn' | 'ein'): number {
  return type === 'ssn' ? 11 : 10;
}

/** `123-45-6789` / `12-3456789`, for reading back a number that was typed as a
 *  run of digits. Anything that is not nine digits is handed back untouched
 *  rather than dressed up as something it is not. */
export function formatTin(value: string, type: 'ssn' | 'ein'): string {
  const digits = digitsOf(value);
  if (digits.length !== 9) return value;
  return type === 'ssn'
    ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
    : `${digits.slice(0, 2)}-${digits.slice(2)}`;
}
