import { resolveGoogleCredentials } from './google-credentials';

/**
 * Slugs that would collide with a real route in the app. A link can never be
 * created with one of these, otherwise `/links` would resolve to a landing page.
 */
export const RESERVED_SLUGS = new Set([
  'api',
  'links',
  'link',
  'affiliate',
  'dashboard',
  'admin',
  'settings',
  'login',
  'logout',
  'static',
  'public',
  'assets',
  '_next',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  'health',
  'new',
]);

export const SHEET_TABS = {
  links: 'Links',
  submissions: 'Submissions',
  visits: 'Visits',
  conversions: 'Conversions',
} as const;

/** Column order for each tab. Changing this changes the sheet layout. */
export const SHEET_HEADERS = {
  links: [
    'id',
    'created_at',
    'slug',
    'usr',
    'assignee',
    'assignee_email',
    'campaign',
    'destination',
    'headline',
    'subheadline',
    'cta_label',
    'require_phone',
    'pass_usr_param',
    'active',
    'notes',
  ],
  submissions: [
    'id',
    'created_at',
    'slug',
    'usr',
    'assignee',
    'campaign',
    'full_name',
    'email',
    'phone',
    'destination',
    'referrer',
    'user_agent',
    'ip',
    // Appended, never inserted: an existing spreadsheet already holds rows in
    // the columns above, and inserting a column here would shift every one of
    // them out of alignment with its header.
    'status',
  ],
  visits: ['id', 'created_at', 'slug', 'usr', 'referrer', 'user_agent', 'ip'],
  /**
   * An approved application and what it paid. Nothing produces these
   * automatically — they are entered on the dashboard or typed straight into
   * the tab, which is also the shape a network postback would write if one is
   * wired up later.
   */
  conversions: ['created_at', 'approved_on', 'slug', 'usr', 'amount', 'notes'],
} as const;

/**
 * Whether the affiliate link shows the lead-capture page before forwarding.
 *
 * Off by default: a click goes straight to the destination. The page, its form
 * and the submissions tab are all left in place, so setting CAPTURE_FORM=on
 * brings the old interstitial back with its data intact.
 */
export function captureFormEnabled(): boolean {
  return process.env.CAPTURE_FORM === 'on';
}

/**
 * Sheets is in play when there's a spreadsheet id AND credentials from either
 * source (env vars or a service-account JSON key file).
 */
export function isSheetsConfigured(): boolean {
  if (!process.env.GOOGLE_SHEET_ID?.trim()) return false;
  try {
    return resolveGoogleCredentials() !== null;
  } catch {
    // A key file that exists but is unreadable/malformed is a configuration
    // error worth surfacing, not a reason to silently fall back to local JSON.
    return true;
  }
}

/** Visit (page view) logging. On by default; set TRACK_VISITS=false to disable. */
export function visitTrackingEnabled(): boolean {
  return process.env.TRACK_VISITS !== 'false';
}

/**
 * Public origin used when rendering a copyable affiliate URL server-side.
 * Falls back to the request host at render time when unset.
 */
export function configuredBaseUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}
