import { isSheetsConfigured } from '../config';
import type { AffiliateLink, Store } from '../types';
import { createLocalStore } from './local';
import { createSheetsStore } from './sheets';

export { StoreConflictError, StoreNotFoundError, StoreConfigError, statusForError } from './errors';

let cached: Store | null = null;

/**
 * Google Sheets when credentials are present, local JSON otherwise. Resolved
 * once per process; restart the dev server after changing .env.local.
 */
export function getStore(): Store {
  if (!cached) {
    cached = isSheetsConfigured() ? createSheetsStore() : createLocalStore();
  }
  return cached;
}

export type LinkResolution =
  | {
      status: 'ok';
      link: AffiliateLink;
      /** The `usr` value from the URL, normalised. */
      usr: string;
      /** True when `usr` matched a row that was actually assigned to that person. */
      assigned: boolean;
    }
  | { status: 'paused' }
  | { status: 'missing' };

/**
 * Resolve a landing page request.
 *
 * `/cashback?usr=arthur` prefers the row created for (cashback, arthur). If no
 * such row exists we fall back to the campaign's house row (usr === "") or any
 * other active row for the slug — an unknown `usr` still lands and is still
 * logged, so the traffic is recorded rather than dropped.
 *
 * A slug whose rows all exist but are inactive resolves to `paused`, which is a
 * different page from a slug that was never created.
 */
export async function resolveLink(slug: string, usr: string): Promise<LinkResolution> {
  const links = await getStore().listLinks();
  const forSlug = links.filter((row) => row.slug === slug);
  if (forSlug.length === 0) return { status: 'missing' };

  // A usr that owns a row is answered by that row and nothing else. Checking
  // ownership BEFORE filtering on `active` is what makes Pause work per
  // assignee: otherwise pausing Arthur's link would quietly serve Bianca's
  // offer to Arthur's traffic and log the lead against the wrong person.
  if (usr) {
    const owned = forSlug.filter((row) => row.usr === usr);
    if (owned.length > 0) {
      const live = owned.find((row) => row.active);
      return live
        ? { status: 'ok', link: live, usr, assigned: true }
        : { status: 'paused' };
    }
  }

  const active = forSlug.filter((row) => row.active);
  if (active.length === 0) return { status: 'paused' };

  // Unknown or absent usr: fall back to the campaign's house row. `assigned`
  // describes the row we actually chose, so the landing page never claims an
  // assignee the visitor did not come through.
  const house = active.find((row) => row.usr === '') ?? active[0];
  return { status: 'ok', link: house, usr, assigned: house.usr === usr };
}
