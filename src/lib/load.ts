import { scopeData } from './scope';
import { getStore } from './store';
import type { AffiliateLink, Conversion, Submission, Visit } from './types';
import type { Viewer } from './viewer';

export type LoadResult = {
  links: AffiliateLink[];
  submissions: Submission[];
  visits: Visit[];
  conversions: Conversion[];
  error: string | null;
};

const EMPTY = { links: [], submissions: [], visits: [], conversions: [] };

/**
 * Reads everything the admin pages need, cut down to what this viewer may see.
 *
 * The viewer is a required argument rather than something read from the request
 * inside here, and that is deliberate: a default would mean a page that forgot
 * to pass one still renders, showing every affiliate's data to whoever asked.
 * Making it explicit turns that mistake into a type error.
 *
 * A Sheets outage or a bad credential should degrade to an in-page message,
 * never a 500 — so failures are captured rather than thrown.
 *
 * Note on cost: every row is read and then filtered in memory. That matches how
 * the Sheets adapter already works (it can only fetch whole tabs) and is fine at
 * this size. If the tables ever outgrow it, the filter belongs in the query, and
 * scopeData stays as the thing that defines what the filter has to mean.
 */
export async function loadAll(viewer: Viewer | null): Promise<LoadResult> {
  const store = getStore();
  try {
    const [links, submissions, visits, conversions] = await Promise.all([
      store.listLinks(),
      store.listSubmissions(),
      store.listVisits(),
      store.listConversions(),
    ]);

    const scoped = scopeData({ links, submissions, visits, conversions }, viewer);

    // Newest first for display. Sorted into new arrays: a store adapter may be
    // handing back rows it also caches, and sorting those in place would change
    // which link the public landing page resolves to.
    return {
      links: [...scoped.links].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      submissions: [...scoped.submissions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      visits: scoped.visits,
      conversions: [...scoped.conversions].sort((a, b) => b.approvedOn.localeCompare(a.approvedOn)),
      error: null,
    };
  } catch (error) {
    return {
      ...EMPTY,
      error: error instanceof Error ? error.message : 'Unknown storage error',
    };
  }
}
