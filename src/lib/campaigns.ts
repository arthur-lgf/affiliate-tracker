/**
 * Campaigns: the offers a link can point at, and where each one sends people.
 *
 * Kept out of lib/config.ts on purpose. config.ts reaches for the Google
 * credentials helper, which imports node:fs and node:path. LinkForm is a client
 * component, so importing this from there would drag those into the browser
 * bundle and fail the build with an UnhandledSchemeError. Nothing here needs
 * server code, so it lives alone and both sides can have it.
 */

/**
 * The query parameter the tracking key travels in.
 *
 * This is the whole attribution chain in one word. QuinStreet passes var2
 * through to its reporting untouched, and the sync matches that column back to
 * a tracking key to decide who an approval paid. A destination without it
 * produces traffic that reports against nobody.
 */
export const TRACKING_PARAM = 'var2';

/** A campaign as the forms need it: what it is called and where it sends people. */
export type CampaignOption = { name: string; destination: string };

/**
 * The categories this started with, before campaigns had URLs and a page to
 * edit them on.
 *
 * Still here as the fallback for a deployment that has not set any up yet: an
 * empty campaign picker would make the link form unusable, and every one of
 * these names is already attached to links in the wild.
 */
export const CAMPAIGNS = [
  '0% Intro APR',
  'Bad Credit',
  'Balance Transfer',
  'Best Cards',
  'CardFinder',
  'Cash Back',
  'Credit Builder',
  'Credit Card Deals',
  'Excellent Credit Needed',
  'Fair Credit',
  'Gas',
  'Good Credit Needed',
  'Hotel',
  'Limited Credit',
  'Low Ongoing Rate',
  'Miles',
  'No Annual Fee',
  'No Foreign Transaction Fee',
  'Premium',
  'Rewards',
  'Secured',
  'Small Business',
  'Student',
  'Travel Rewards',
] as const;

/** Those names with no destination behind them, which is what "not set up yet" is. */
export function defaultCampaigns(): CampaignOption[] {
  return CAMPAIGNS.map((name) => ({ name, destination: '' }));
}

/**
 * A campaign's URL with one person's tracking key written into it.
 *
 * `set`, not append: a destination that already carries var2 has it replaced
 * rather than gaining a second copy the merchant would be free to read either
 * way round. The merchant's own parameters (?src=714025 and the rest) are kept
 * exactly as they were given.
 *
 * A house link has no key, and gets the URL unchanged — there is nobody to
 * attribute it to, and `var2=` empty would report against a tracking key that
 * does not exist. Anything that will not parse as a URL is handed back
 * untouched: this runs on every keystroke behind a field somebody is still
 * typing in, and rewriting half a URL as they type is worse than waiting.
 */
export function withTrackingKey(destination: string, usr: string): string {
  const base = (destination ?? '').trim();
  if (!base || !usr) return base;
  try {
    const url = new URL(base);
    url.searchParams.set(TRACKING_PARAM, usr);
    return url.toString();
  } catch {
    return base;
  }
}

/** Whether a campaign destination is something we can actually send someone to. */
export function isSendableUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The list as it should be stored: trimmed, blank rows dropped, one row per
 * name.
 *
 * Names are the key here — the link form looks a campaign up by the name on the
 * link — so two rows called "Cash Back" would make which URL you get depend on
 * the order they happen to be in. The first wins, and the duplicate is dropped
 * rather than silently renamed.
 */
export function normalizeCampaigns(rows: CampaignOption[]): CampaignOption[] {
  const seen = new Set<string>();
  const out: CampaignOption[] = [];
  for (const row of rows) {
    const name = (row.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, destination: (row.destination ?? '').trim() });
  }
  return out;
}
