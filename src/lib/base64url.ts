/**
 * base64url, shared by the session cookie and the password hashes.
 *
 * Both need to put bytes in a string that survives a cookie, a URL and a
 * Postgres text column untouched, which rules out the `+`, `/` and `=` of
 * ordinary base64.
 */

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Null rather than a throw: a malformed value is an input, not an incident. */
export function base64UrlDecode(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
