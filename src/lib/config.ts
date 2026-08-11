import { resolveGoogleCredentials } from './google-credentials';

/**
 * Slugs that would collide with a real route in the app. A link can never be
 * created with one of these, otherwise `/links` would resolve to a landing page.
 */
export const RESERVED_SLUGS = new Set([
  'api',
  'links',
  'link',
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
} as const;

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
