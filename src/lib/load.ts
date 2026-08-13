import { getStore } from './store';
import type { AffiliateLink, Conversion, Submission, Visit } from './types';

export type LoadResult = {
  links: AffiliateLink[];
  submissions: Submission[];
  visits: Visit[];
  conversions: Conversion[];
  error: string | null;
};

/**
 * Reads everything the admin pages need. A Sheets outage or a bad credential
 * should degrade to an in-page message, never a 500 — so failures are captured
 * rather than thrown.
 */
export async function loadAll(): Promise<LoadResult> {
  const store = getStore();
  try {
    const [links, submissions, visits, conversions] = await Promise.all([
      store.listLinks(),
      store.listSubmissions(),
      store.listVisits(),
      store.listConversions(),
    ]);
    // Newest first for display. Sorted into new arrays: a store adapter may be
    // handing back rows it also caches, and sorting those in place would change
    // which link the public landing page resolves to.
    return {
      links: [...links].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      submissions: [...submissions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      visits,
      conversions: [...conversions].sort((a, b) => b.approvedOn.localeCompare(a.approvedOn)),
      error: null,
    };
  } catch (error) {
    return {
      links: [],
      submissions: [],
      visits: [],
      conversions: [],
      error: error instanceof Error ? error.message : 'Unknown storage error',
    };
  }
}
