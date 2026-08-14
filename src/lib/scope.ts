/**
 * Cutting the data down to what the viewer is allowed to see.
 *
 * One function, used at one place (lib/load.ts), because scoping that is
 * applied per page is scoping that will one day be forgotten on a page. Every
 * admin screen reads through loadAll, so filtering there means a new page is
 * scoped before anyone remembers to think about it.
 *
 * The rule is the same for all four tables: an affiliate sees rows whose `usr`
 * equals their tracking key, and nothing else. In particular they never see
 * house rows (`usr === ''`), which are the clicks that arrived with no key at
 * all and belong to nobody in particular.
 */

import type { Viewer } from './viewer-core';
import type { AffiliateLink, Conversion, Submission, Visit } from './types';

export type Scopeable = {
  links: AffiliateLink[];
  submissions: Submission[];
  visits: Visit[];
  conversions: Conversion[];
};

/**
 * Whether this viewer sees everything.
 *
 * A null viewer is NOT treated as an admin. Any caller that reaches here
 * without one has a bug, and the safe reading of "I do not know who this is"
 * is "they see nothing".
 */
export function seesEverything(viewer: Viewer | null): boolean {
  return viewer?.role === 'admin';
}

export function scopeData<T extends Scopeable>(data: T, viewer: Viewer | null): T {
  if (seesEverything(viewer)) return data;

  // No viewer, or an affiliate whose key is somehow empty. Neither can be
  // resolved to a set of rows, so the answer is the empty set rather than
  // everything — the failure mode of an unscoped filter is a full data leak.
  const key = viewer?.usr ?? '';
  if (!key) {
    return { ...data, links: [], submissions: [], visits: [], conversions: [] };
  }

  return {
    ...data,
    links: data.links.filter((row) => row.usr === key),
    submissions: data.submissions.filter((row) => row.usr === key),
    visits: data.visits.filter((row) => row.usr === key),
    conversions: data.conversions.filter((row) => row.usr === key),
  };
}

/** Whether this viewer may act on rows carrying this tracking key. */
export function ownsKey(viewer: Viewer | null, usr: string): boolean {
  if (seesEverything(viewer)) return true;
  const key = viewer?.usr ?? '';
  return key !== '' && key === usr;
}
