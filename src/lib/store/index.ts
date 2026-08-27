import { isSheetsConfigured } from '../config';
import type { AffiliateLink, Store } from '../types';
import { StoreConfigError } from './errors';
import { createLocalStore } from './local';
import { withCache } from './cache';
import { createSheetsStore } from './sheets';
import { createSupabaseStore, isSupabaseConfigured } from './supabase';

export { StoreConflictError, StoreNotFoundError, StoreConfigError, statusForError } from './errors';

/**
 * True on hosts whose filesystem is read-only and thrown away between requests
 * (Vercel, Lambda, Netlify). The local JSON store cannot work there, so falling
 * back to it would only produce a confusing `mkdir '/var/task/.data'` error at
 * the first write.
 */
export function isEphemeralFilesystem(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY ||
      process.env.LAMBDA_TASK_ROOT,
  );
}

const NOT_CONFIGURED_MESSAGE =
  'No database is configured on this deployment, and the local file store cannot run on a ' +
  'serverless host. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your project settings, ' +
  'then redeploy. (Google Sheets still works too; a service-account.json file does not, because ' +
  'there is no persistent filesystem here.)';

/** Every operation fails the same way, with an actionable message. */
function createUnavailableStore(message: string): Store {
  const fail = async (): Promise<never> => {
    throw new StoreConfigError(message);
  };
  return {
    kind: 'sheets',
    listLinks: fail,
    createLink: fail,
    updateLink: fail,
    deleteLink: fail,
    listSubmissions: fail,
    addSubmission: fail,
    updateSubmission: fail,
    listVisits: fail,
    addVisit: fail,
    listConversions: fail,
    addConversion: fail,
    deleteConversion: fail,
    readCpaReport: fail,
    writeCpaReport: fail,
    listCampaigns: fail,
    writeCampaigns: fail,
    readSettings: fail,
    writeSettings: fail,
  };
}

export type StorageStatus = 'supabase' | 'sheets' | 'local' | 'unconfigured';

/** What the UI should report about where data is going. */
export function storageStatus(): StorageStatus {
  if (isSupabaseConfigured()) return 'supabase';
  if (isSheetsConfigured()) return 'sheets';
  return isEphemeralFilesystem() ? 'unconfigured' : 'local';
}

let cached: Store | null = null;

/**
 * Supabase when it is configured, then Google Sheets, then local JSON.
 * Resolved once per process; restart the dev server after changing .env.local.
 *
 * Supabase wins over Sheets deliberately. Both being set is what a migration
 * looks like halfway through, and at that point the database is the copy that
 * is being written to.
 */
export function getStore(): Store {
  if (!cached) {
    let store: Store;
    if (isSupabaseConfigured()) {
      store = createSupabaseStore();
    } else if (isSheetsConfigured()) {
      store = createSheetsStore();
    } else if (isEphemeralFilesystem()) {
      // Fail loudly rather than silently degrading to a store that cannot write.
      store = createUnavailableStore(NOT_CONFIGURED_MESSAGE);
    } else {
      store = createLocalStore();
    }
    /*
     * Wrapped once, here, so every adapter gets the same read cache and every
     * write clears it. Doing it at this seam rather than in the pages is what
     * keeps the cache holding whole unscoped tables: nothing above this line
     * knows who is asking. See store/cache.ts.
     */
    cached = withCache(store);
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
