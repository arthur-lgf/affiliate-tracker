import type { Store } from '../types';

/**
 * Reading each table once instead of once per page.
 *
 * lib/load.ts reads all four tables whole and filters them in memory, and four
 * pages call it. Walking Overview → Links → Create → back is sixteen reads of
 * the same four tables, none of which changed in between. This is that, done
 * once.
 *
 * ---------------------------------------------------------------------------
 * The safety rule, which is the only part of this file that really matters
 * ---------------------------------------------------------------------------
 *
 * What is cached here is the WHOLE table, before anybody is scoped out of it.
 * Scoping happens afterwards, per request, in lib/load.ts, against the viewer
 * from that request's own cookie.
 *
 * That ordering is what makes a shared cache safe. There is no viewer in this
 * file, no key derived from one, and nothing here can be reached with a viewer
 * in hand — so the failure everybody fears, one affiliate served another's
 * rows out of a cache, cannot be expressed. If you ever find yourself wanting
 * to cache the result of scopeData, or to add a userId to a key here, that is
 * the bug, not the feature.
 *
 * ---------------------------------------------------------------------------
 * What this is not
 * ---------------------------------------------------------------------------
 *
 * Per process, not per deployment. On a serverless host each warm instance
 * keeps its own copy, and a cold one starts empty. That is fine for the shape
 * of this app — a handful of admins clicking around inside a few minutes hit
 * the same instance — and the worst case is exactly today's behaviour.
 *
 * Nothing here is a source of truth and nothing survives a restart. A write
 * clears what it touched, so the only staleness left is somebody else's write
 * on another instance, bounded by TTL_MS.
 */

/** Long enough to cover walking between pages, short enough that another
 *  admin's change turns up while you are still looking for it. */
const TTL_MS = 30_000;

type Entry<T> = {
  at: number;
  value: T;
};

type Key = 'links' | 'submissions' | 'visits' | 'conversions' | 'cpa' | 'campaigns' | 'settings';

/**
 * One box per table, holding either a settled value or the promise that is
 * currently fetching it.
 *
 * The in-flight promise is half the point. Two requests landing together used
 * to make two identical reads; now the second waits on the first. That matters
 * most on a cold start, which is precisely when everything arrives at once.
 */
const settled = new Map<Key, Entry<unknown>>();
const inFlight = new Map<Key, Promise<unknown>>();

function fresh(entry: Entry<unknown> | undefined, now: number): boolean {
  return entry !== undefined && now - entry.at < TTL_MS;
}

async function read<T>(key: Key, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = settled.get(key);
  if (fresh(hit, now)) return hit!.value as T;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = load()
    .then((value) => {
      settled.set(key, { at: Date.now(), value });
      return value;
    })
    /*
     * A failure is never remembered. Caching an error would turn one flaky read
     * into thirty seconds of a broken page, and the store's own callers already
     * degrade a failed read into a message on the page.
     */
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/**
 * Forget one table, or all of them.
 *
 * Called by every write below, and exported for the routes that write through
 * something other than the Store interface.
 */
export function invalidate(...keys: Key[]): void {
  if (keys.length === 0) {
    settled.clear();
    inFlight.clear();
    return;
  }
  for (const key of keys) {
    settled.delete(key);
    inFlight.delete(key);
  }
}

/** For the checks: what is actually being held. */
export function cacheState(): { settled: Key[]; inFlight: Key[] } {
  return { settled: [...settled.keys()], inFlight: [...inFlight.keys()] };
}

/**
 * The same Store, reading through the cache and clearing it on every write.
 *
 * A decorator rather than changes inside each adapter, so Supabase, Sheets and
 * the local JSON file all get it, and so the invalidation for a write lives one
 * line from the write itself instead of in whichever route remembered.
 */
export function withCache(store: Store): Store {
  return {
    kind: store.kind,

    listLinks: () => read('links', () => store.listLinks()),
    createLink: async (input) => {
      const made = await store.createLink(input);
      invalidate('links');
      return made;
    },
    updateLink: async (id, patch) => {
      const updated = await store.updateLink(id, patch);
      invalidate('links');
      return updated;
    },
    deleteLink: async (id) => {
      await store.deleteLink(id);
      invalidate('links');
    },

    listSubmissions: () => read('submissions', () => store.listSubmissions()),
    addSubmission: async (input) => {
      const made = await store.addSubmission(input);
      invalidate('submissions');
      return made;
    },
    updateSubmission: async (id, patch) => {
      const updated = await store.updateSubmission(id, patch);
      invalidate('submissions');
      return updated;
    },

    listVisits: () => read('visits', () => store.listVisits()),
    addVisit: async (input) => {
      const made = await store.addVisit(input);
      invalidate('visits');
      return made;
    },

    listConversions: () => read('conversions', () => store.listConversions()),
    addConversion: async (input) => {
      const made = await store.addConversion(input);
      // An approval is money: it moves the hero figure, the per-card totals and
      // the leads table, and all three are drawn from tables this clears.
      invalidate('conversions', 'submissions');
      return made;
    },
    deleteConversion: async (id) => {
      await store.deleteConversion(id);
      invalidate('conversions', 'submissions');
    },

    readCpaReport: () => read('cpa', () => store.readCpaReport()),
    writeCpaReport: async (report) => {
      await store.writeCpaReport(report);
      invalidate('cpa');
    },

    readSettings: () => read('settings', () => store.readSettings()),
    writeSettings: async (settings) => {
      await store.writeSettings(settings);
      /*
       * The commission share decides what every money figure on every page
       * says, and the rate-card floor decides which cards are on it. Neither
       * is stored on the rows they change, so both of those have to be read
       * again rather than served from a copy taken before the change.
       */
      invalidate('settings', 'conversions', 'cpa');
    },

    listCampaigns: () => read('campaigns', () => store.listCampaigns()),
    writeCampaigns: async (campaigns) => {
      await store.writeCampaigns(campaigns);
      // A campaign decides where a link points, so the links a page draws are
      // read through it.
      invalidate('campaigns', 'links');
    },
  };
}
