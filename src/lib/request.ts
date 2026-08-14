/**
 * Anything carrying request headers. Structural rather than `Request`, so a
 * server component holding only the result of `headers()` can use these too —
 * which is how the pass-through redirect logs a click without a route handler.
 */
type HeaderSource = { headers: Headers };

/**
 * Which forwarding header, if any, this deployment is willing to believe.
 *
 * This used to try several headers in preference order and take whichever
 * turned up. That is the wrong shape: `x-real-ip` and `cf-connecting-ip` are
 * only unforgeable when something in front of the app overwrites them, and
 * nothing in a header's *name* says whether that happened. Off Vercel and
 * Cloudflare, a client could simply send `x-real-ip: <anything>` and pick its
 * own rate-limit bucket, which turned every limiter in the app into a
 * formality — including the one in front of the admin password.
 *
 * So trust is now declared rather than guessed:
 *
 *   - On Vercel, `x-vercel-forwarded-for` is set by the platform and stripped
 *     from client input, so it is trusted when VERCEL is in the environment.
 *   - Anywhere else, nothing is trusted unless TRUSTED_PROXY_HEADER names it.
 *
 * The cost of getting this wrong in the safe direction is that every request
 * shares one bucket and the limits bite sooner. The cost of getting it wrong in
 * the other direction is unlimited password guessing.
 */
function trustedHeaderName(): string | null {
  const configured = process.env.TRUSTED_PROXY_HEADER?.trim().toLowerCase();
  if (configured) return configured;
  if (process.env.VERCEL) return 'x-vercel-forwarded-for';
  return null;
}

/**
 * How many proxies sit in front of this app, for reading x-forwarded-for.
 *
 * The list grows left to right as it passes through proxies, so the *rightmost*
 * entries are the ones added closest to the app and the leftmost is whatever
 * the original client claimed. Reading `parts[0]` — which is what this did —
 * reads the attacker's own value. Counting from the right instead means a
 * client can prepend as many fake hops as it likes without moving the entry we
 * actually use.
 */
function trustedHops(): number {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS);
  if (!Number.isInteger(raw) || raw < 1 || raw > 10) return 1;
  return raw;
}

/**
 * Best-effort client IP, for rate limiting and for the visit log.
 *
 * Returns '' when nothing can be trusted, and callers must treat that as a
 * single shared bucket rather than as "no limit". Never identity: even a
 * trustworthy IP is shared by everyone behind one NAT.
 */
export function clientIp(request: HeaderSource): string {
  const headers = request.headers;
  const trusted = trustedHeaderName();
  if (!trusted) return '';

  const raw = headers.get(trusted);
  if (!raw) return '';

  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';

  // x-forwarded-for is the only one of these that is a list in practice. For a
  // single-value header the hop count lands on the only entry either way.
  const index = Math.max(0, parts.length - trustedHops());
  return (parts[index] ?? parts[parts.length - 1] ?? '').slice(0, 64);
}

export function userAgent(request: HeaderSource): string {
  return (request.headers.get('user-agent') ?? '').slice(0, 400);
}

export function referrer(request: HeaderSource): string {
  return (request.headers.get('referer') ?? '').slice(0, 400);
}

/**
 * Whether this request reached us over HTTPS.
 *
 * `new URL(request.url).protocol` describes the connection *this process*
 * received, which behind a TLS-terminating proxy is plain http even though the
 * browser is on https. Getting this wrong drops the Secure flag off the session
 * cookie, so the forwarded scheme is consulted first — the same header
 * originFromHeaders already relies on.
 */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  if (forwarded) return forwarded === 'https';
  return new URL(request.url).protocol === 'https:';
}

/**
 * Origin for building shareable links. Prefers the configured public base URL,
 * then the forwarded proto/host of the current request.
 */
export function originFromHeaders(
  headers: Headers,
  configured: string | null,
): string {
  if (configured) return configured;
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000';
  const proto =
    headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
