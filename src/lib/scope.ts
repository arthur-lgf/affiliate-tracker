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

/* ------------------------------------------------------------------ */
/* Creating a link                                                      */
/* ------------------------------------------------------------------ */

/** The three fields on a link that say who it belongs to. */
export type LinkOwner = { usr: string; assignee: string; assigneeEmail: string };

/** The account behind the viewer, for filling in their own name and email. */
export type SelfAccount = { fullName: string; email: string; username: string };

export type OwnerDecision = { ok: true; owner: LinkOwner } | { ok: false; reason: string };

/**
 * Whose tracking key a new link pays out to.
 *
 * An admin says. An affiliate is not asked: whatever the request body claims,
 * the link is bound to the key on their own session. That is the whole reason
 * this is a function with tests rather than three lines inside the route — an
 * affiliate who could name the owner could point their own traffic at somebody
 * else's key, or create a link under somebody else's key and read the leads it
 * brought in.
 *
 * A house link (`usr: ''`) stays an admin-only thing for the same reason. House
 * rows are what an unattributed click falls back to, so they belong to nobody
 * in particular rather than to whoever asked for one last.
 *
 * The display name comes from the account, not the body: it is the label shown
 * next to the money on every page, and it should say who the row is actually
 * for. The email is the exception — it is a note to themselves about their own
 * row, so a typed one is kept and the account's is only the default.
 */
export function ownerForNewLink(
  viewer: Viewer | null,
  requested: LinkOwner,
  self: SelfAccount | null,
): OwnerDecision {
  // Same failing-closed rule as scopeData: not knowing who is asking is never
  // read as "an admin is asking".
  if (!viewer) return { ok: false, reason: 'Not signed in.' };
  if (seesEverything(viewer)) return { ok: true, owner: requested };

  if (!viewer.usr) {
    return {
      ok: false,
      reason: 'Your account has no tracking key, so a link cannot be created for it.',
    };
  }

  return {
    ok: true,
    owner: {
      usr: viewer.usr,
      assignee: self?.fullName || self?.username || viewer.username,
      assigneeEmail: requested.assigneeEmail || self?.email || '',
    },
  };
}
