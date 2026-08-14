/**
 * Response headers, and why each one is here.
 *
 * The admin surface renders lead names, emails and phone numbers, and its
 * controls delete links and approvals with a single click. Without
 * frame-ancestors that surface is embeddable, and an attacker page can float an
 * invisible iframe of /links under a decoy button: a signed-in admin clicks
 * once, the click lands inside the frame, and the app's own JavaScript fires
 * the request from its own origin. SameSite=Lax does not help there, because
 * nothing is cross-site once the click happens inside our own page.
 *
 * The CSP is written for how this app actually loads: no external scripts, no
 * external styles, no fonts or images from anywhere else. Next.js needs
 * 'unsafe-inline' for the style attributes and the bootstrap script it emits,
 * so this is not a nonce-grade policy — it is the tight end of what works
 * without rearchitecting rendering, and it still removes every remote origin as
 * a script source.
 */

const CSP = [
  "default-src 'self'",
  // 'unsafe-inline' and 'unsafe-eval' are what the framework's own inline
  // bootstrap and dev-mode refresh need. Everything remote is still refused.
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // The browser only ever talks to this app. The QMP and Supabase calls are
  // made server-side, so nothing here needs a remote connect origin.
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  // Belt and braces with frame-ancestors, for anything that still reads this.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // A lead's landing page URL carries the tracking key, and the admin URLs
  // carry it too. Sending a full referrer to the merchant would leak the path.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // googleapis is a heavy node-only dep; keep it out of the bundler's way.
  serverExternalPackages: ['googleapis'],
  // Not set as a default: every response should carry these, including the
  // public landing pages and the API routes.
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
