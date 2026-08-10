import type { NextRequest } from 'next/server';

/**
 * Best-effort client IP.
 *
 * Platform-set headers are preferred because a client cannot forge them; only
 * if none are present do we fall back to x-forwarded-for, whose first entry is
 * fully attacker-controlled when the app is not actually behind a proxy. Treat
 * the result as a spam-throttling hint, never as identity.
 */
export function clientIp(request: NextRequest | Request): string {
  const headers = request.headers;
  const platform =
    headers.get('x-vercel-forwarded-for') ??
    headers.get('cf-connecting-ip') ??
    headers.get('x-real-ip');
  if (platform) return platform.split(',')[0]!.trim().slice(0, 64);

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 64);
  return '';
}

export function userAgent(request: NextRequest | Request): string {
  return (request.headers.get('user-agent') ?? '').slice(0, 400);
}

export function referrer(request: NextRequest | Request): string {
  return (request.headers.get('referer') ?? '').slice(0, 400);
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
