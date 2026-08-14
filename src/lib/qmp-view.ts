/**
 * A QMP report read against Ledger's own data.
 *
 * The raw report is a wall of QuinStreet's columns, most of which say nothing
 * about anybody here. Two of them do:
 *
 *   var2  the tracking key, written into each link's destination URL as
 *         `var2=<usr>`, which QMP passes through untouched. This is what says
 *         whose row it is.
 *   var3  the lead reference minted before the visitor was forwarded, which is
 *         the id of the submission row. This is what says which client it was.
 *
 * So a report row is only meaningful here if its var2 matches a live tracking
 * key. Rows that do not are held back rather than shown: they belong to traffic
 * this Ledger does not account for, and mixing them into the table makes every
 * total on screen disagree with every total the dashboard shows.
 *
 * Held back, not dropped silently — the count comes back with the rows so the
 * page can say how many were left out and why.
 */

import { clientIndex, nameIndex, UNKNOWN_CLIENT } from './analytics';
import { leadRefOf, trackingKeyOf } from './qmp-sync';
import type { AffiliateLink, Submission } from './types';

export type ReportRowView = {
  /** var2, exactly as QMP sent it. */
  usr: string;
  /** The person that key belongs to. Never empty — falls back to the key. */
  person: string;
  /** var3, exactly as QMP sent it. Empty when the row carries none. */
  leadRef: string;
  /** The client behind var3, or a dash when it resolves to nobody. */
  client: string;
};

export type JoinedReport = {
  /** Report rows whose var2 is a live tracking key, in the order QMP sent them. */
  rows: Record<string, unknown>[];
  /** One entry per kept row, same index. */
  resolved: ReportRowView[];
  /** Rows held back because their var2 matches no link. */
  hidden: number;
  /** The distinct var2 values that were held back, for saying what to fix. */
  hiddenKeys: string[];
};

export function joinReport(options: {
  rows: Record<string, unknown>[];
  links: AffiliateLink[];
  submissions: Submission[];
}): JoinedReport {
  const { rows, links, submissions } = options;

  // Compared lowercased and trimmed, the same way the sync matches them, so
  // the table cannot show a row the sync would then refuse to attribute.
  const keys = new Map<string, string>();
  for (const link of links) {
    const key = link.usr.trim().toLowerCase();
    if (key) keys.set(key, link.usr);
  }

  const names = nameIndex(links);
  const clients = clientIndex(submissions);

  const kept: Record<string, unknown>[] = [];
  const resolved: ReportRowView[] = [];
  const hiddenKeys = new Set<string>();
  let hidden = 0;

  for (const row of rows) {
    const raw = trackingKeyOf(row);
    const usr = keys.get(raw.trim().toLowerCase());
    if (!usr) {
      hidden += 1;
      hiddenKeys.add(raw || '(empty)');
      continue;
    }

    const leadRef = leadRefOf(row);
    kept.push(row);
    resolved.push({
      usr,
      person: names.get(usr) ?? usr,
      leadRef,
      client: clients.get(leadRef) ?? UNKNOWN_CLIENT,
    });
  }

  return { rows: kept, resolved, hidden, hiddenKeys: [...hiddenKeys].sort() };
}
