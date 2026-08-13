import { isSheetsConfigured } from '../config';
import type { AffiliateLink, Store } from '../types';
import { StoreConfigError } from './errors';
import { createLocalStore } from './local';
import { createSheetsStore } from './sheets';

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
  'Google Sheets is not configured on this deployment, and the local file store cannot run on a ' +
  'serverless host. Set GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in ' +
  'your project settings, then redeploy. (A service-account.json file will not work here — there ' +
  'is no persistent filesystem.)';

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
  };
}

export type StorageStatus = 'sheets' | 'local' | 'unconfigured';

/** What the UI should report about where data is going. */
export function storageStatus(): StorageStatus {
  if (isSheetsConfigured()) return 'sheets';
  return isEphemeralFilesystem() ? 'unconfigured' : 'local';
}

let cached: Store | null = null;

/**
 * Google Sheets when credentials are present, local JSON otherwise. Resolved
 * once per process; restart the dev server after changing .env.local.
 */
export function getStore(): Store {
  if (!cached) {
    if (isSheetsConfigured()) {
      cached = createSheetsStore();
    } else if (isEphemeralFilesystem()) {
      // Fail loudly rather than silently degrading to a store that cannot write.
      cached = createUnavailableStore(NOT_CONFIGURED_MESSAGE);
    } else {
      cached = createLocalStore();
    }
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
