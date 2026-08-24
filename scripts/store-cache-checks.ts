// The read cache in front of the store.
//
// Two things are being checked here and only one of them is performance. The
// other is the rule the whole design rests on: what is cached is the whole
// table, before anybody is scoped out of it, so a cache shared between requests
// cannot serve one affiliate another's rows. Every assertion about keys below is
// really an assertion about that.
//
//   npx tsx scripts/store-cache-checks.ts

import { cacheState, invalidate, withCache } from '../src/lib/store/cache';
import type {
  AffiliateLink,
  Conversion,
  NewAffiliateLink,
  NewConversion,
  NewSubmission,
  NewVisit,
  Store,
  Submission,
  Visit,
} from '../src/lib/types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A store that counts what it was asked for, so a cache hit is observable. */
function countingStore(options: { delayMs?: number; failReads?: boolean } = {}) {
  const calls: Record<string, number> = {};
  const bump = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };

  const rows = {
    links: [{ id: 'l1' }] as unknown as AffiliateLink[],
    submissions: [{ id: 's1' }] as unknown as Submission[],
    visits: [{ id: 'v1' }] as unknown as Visit[],
    conversions: [{ id: 'c1' }] as unknown as Conversion[],
  };

  async function answer<T>(name: string, value: T): Promise<T> {
    bump(name);
    if (options.delayMs) await wait(options.delayMs);
    if (options.failReads) throw new Error('the store is down');
    return value;
  }

  const store: Store = {
    kind: 'local',
    listLinks: () => answer('listLinks', rows.links),
    createLink: async (input: NewAffiliateLink) => {
      bump('createLink');
      return { ...(input as unknown as AffiliateLink), id: 'new' };
    },
    updateLink: async (id: string) => {
      bump('updateLink');
      return { id } as unknown as AffiliateLink;
    },
    deleteLink: async () => {
      bump('deleteLink');
    },
    listSubmissions: () => answer('listSubmissions', rows.submissions),
    addSubmission: async (input: NewSubmission) => {
      bump('addSubmission');
      return { ...(input as unknown as Submission), id: 'new' };
    },
    updateSubmission: async (id: string) => {
      bump('updateSubmission');
      return { id } as unknown as Submission;
    },
    listVisits: () => answer('listVisits', rows.visits),
    addVisit: async (input: NewVisit) => {
      bump('addVisit');
      return { ...(input as unknown as Visit), id: 'new' };
    },
    listConversions: () => answer('listConversions', rows.conversions),
    addConversion: async (input: NewConversion) => {
      bump('addConversion');
      return { ...(input as unknown as Conversion), id: 'new' };
    },
    deleteConversion: async () => {
      bump('deleteConversion');
    },
    readCpaReport: () => answer('readCpaReport', null),
    writeCpaReport: async () => {
      bump('writeCpaReport');
    },
    listCampaigns: () => answer('listCampaigns', []),
    writeCampaigns: async () => {
      bump('writeCampaigns');
    },
  };

  return { store, calls };
}

async function main() {
  console.log('\n— reading once instead of once per page —');
  invalidate();
  {
    const { store, calls } = countingStore();
    const cached = withCache(store);

    await cached.listLinks();
    await cached.listLinks();
    await cached.listLinks();
    check('three reads of the same table hit the store once', calls.listLinks === 1);

    const first = await cached.listLinks();
    const again = await cached.listLinks();
    check('and hand back the same rows', first === again);

    await cached.listSubmissions();
    await cached.listVisits();
    await cached.listConversions();
    await cached.listSubmissions();
    await cached.listVisits();
    await cached.listConversions();
    check(
      'each table is its own entry',
      calls.listSubmissions === 1 && calls.listVisits === 1 && calls.listConversions === 1,
    );

    /*
     * What a page load actually costs. loadAll reads all four tables and four
     * pages call it, so walking Overview → Links → Create → Overview used to be
     * sixteen reads of four tables that did not change.
     */
    const loadAll = () =>
      Promise.all([
        cached.listLinks(),
        cached.listSubmissions(),
        cached.listVisits(),
        cached.listConversions(),
      ]);
    const before = calls.listLinks + calls.listSubmissions + calls.listVisits + calls.listConversions;
    await loadAll();
    await loadAll();
    await loadAll();
    await loadAll();
    const after = calls.listLinks + calls.listSubmissions + calls.listVisits + calls.listConversions;
    check('four page loads add no reads at all', after === before);
  }

  console.log('\n— two requests arriving together —');
  invalidate();
  {
    const { store, calls } = countingStore({ delayMs: 25 });
    const cached = withCache(store);
    // The cold-start case: nothing is cached yet and everything asks at once.
    const [a, b, c] = await Promise.all([
      cached.listLinks(),
      cached.listLinks(),
      cached.listLinks(),
    ]);
    check('they share one read rather than making three', calls.listLinks === 1);
    check('and all get the same answer', a === b && b === c);
  }

  console.log('\n— a write clears what it touched —');
  invalidate();
  {
    const { store, calls } = countingStore();
    const cached = withCache(store);

    await cached.listLinks();
    await cached.createLink({} as NewAffiliateLink);
    await cached.listLinks();
    check('creating a link makes the next read fresh', calls.listLinks === 2);

    await cached.updateLink('l1', {});
    await cached.listLinks();
    check('so does updating one', calls.listLinks === 3);

    await cached.deleteLink('l1');
    await cached.listLinks();
    check('and deleting one', calls.listLinks === 4);

    await cached.listSubmissions();
    const submissionsBefore = calls.listSubmissions;
    await cached.updateLink('l1', {});
    await cached.listSubmissions();
    check('a link write leaves other tables alone', calls.listSubmissions === submissionsBefore);

    /*
     * An approval is money. It moves the hero figure and the leads table as
     * well as the approvals list, so it has to clear both tables those are
     * drawn from, or recording one shows a number that has not moved.
     */
    await cached.listConversions();
    await cached.listSubmissions();
    const conversionsAt = calls.listConversions;
    const submissionsAt = calls.listSubmissions;
    await cached.addConversion({} as NewConversion);
    await cached.listConversions();
    await cached.listSubmissions();
    check('recording an approval refreshes the approvals', calls.listConversions === conversionsAt + 1);
    check('and the leads beside them', calls.listSubmissions === submissionsAt + 1);

    await cached.listCampaigns();
    await cached.listLinks();
    const campaignsAt = calls.listCampaigns;
    const linksAt = calls.listLinks;
    await cached.writeCampaigns([]);
    await cached.listCampaigns();
    await cached.listLinks();
    check('saving campaigns refreshes them', calls.listCampaigns === campaignsAt + 1);
    // A campaign decides where a link points, so a link read through a stale
    // campaign is a link pointing at the old destination.
    check('and the links that read through them', calls.listLinks === linksAt + 1);

    await cached.readCpaReport();
    const cpaAt = calls.readCpaReport;
    await cached.writeCpaReport({} as never);
    await cached.readCpaReport();
    check('uploading a rate card replaces it', calls.readCpaReport === cpaAt + 1);
  }

  console.log('\n— a failed read is never remembered —');
  invalidate();
  {
    const { store, calls } = countingStore({ failReads: true });
    const cached = withCache(store);

    let threw = 0;
    for (let i = 0; i < 3; i++) {
      try {
        await cached.listLinks();
      } catch {
        threw++;
      }
    }
    check('the failure reaches the caller every time', threw === 3);
    /*
     * The one that would turn a blip into an outage: caching an error means
     * thirty seconds of a broken page after a single flaky read, and no way to
     * fix it but wait.
     */
    check('and it is retried rather than cached', calls.listLinks === 3);
    check('nothing is left in the cache', !cacheState().settled.includes('links'));
    check('and nothing is left in flight', !cacheState().inFlight.includes('links'));
  }

  console.log('\n— what the cache is holding —');
  invalidate();
  {
    const { store } = countingStore();
    const cached = withCache(store);
    check('it starts empty', cacheState().settled.length === 0);

    await cached.listLinks();
    await cached.listConversions();
    check('and holds one entry per table read', cacheState().settled.length === 2);

    /*
     * The rule the whole design rests on. These keys are table names and
     * nothing else: no user id, no tracking key, no role. Scoping happens after
     * the read, per request, in lib/load.ts — so there is no key here that
     * could serve one affiliate another's rows, because there is no key here
     * that knows an affiliate exists.
     */
    check(
      'keyed by table, never by who is asking',
      cacheState().settled.every((key) =>
        ['links', 'submissions', 'visits', 'conversions', 'cpa', 'campaigns'].includes(key),
      ),
    );

    invalidate('links');
    check('one table can be cleared on its own', cacheState().settled.join() === 'conversions');

    await cached.listLinks();
    invalidate();
    check('and everything at once', cacheState().settled.length === 0);
  }

  console.log('\n— the shape of the thing is unchanged —');
  {
    const { store } = countingStore();
    const cached = withCache(store);
    check('it is still the same store kind', cached.kind === store.kind);
    check(
      'and still has every method',
      (Object.keys(store) as (keyof Store)[]).every((key) => typeof cached[key] === typeof store[key]),
    );
  }

  console.log(`\nstore-cache: ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

void main();
