/**
 * Turning a QMP report into Ledger approvals.
 *
 * The shapes do not line up, and pretending they do is how money goes wrong.
 * A QMP row is a daily aggregate:
 *
 *   Date-Daily, Placement Name, Advertiser, Card Name, Device Type, Var2,
 *   Var3, Sub ID, Referring Session URL, State  +  Approvals, Total Earnings
 *
 * so one row can say "3 approvals, $412.50" for a card on a day. A Ledger
 * conversion is one approved application with one amount. Three decisions
 * follow, and all three are deliberate:
 *
 *  1. A row with N approvals becomes N conversions, not one. The dashboard
 *     counts conversions to show "approved", so collapsing a row to a single
 *     conversion would report 1 approval where QMP reports 3.
 *
 *  2. The earnings are split evenly across those N, in whole cents, with the
 *     remainder handed out one cent at a time so the total is exact. QMP does
 *     not say what each individual approval paid, so the split is an average
 *     and is labelled as one. The sum is what is true.
 *
 *  3. Sub ID is the only join back to a person. It is matched to a link's
 *     `usr`. Nothing is guessed: a Sub ID with no link, or with several links
 *     and no way to tell them apart, is reported as unresolved rather than
 *     attributed to somebody.
 *
 * Re-running is safe. Every conversion carries a marker in its notes derived
 * from the row's dimensions, and anything already carrying that marker is left
 * alone. The marker also preserves the card name, which Ledger otherwise does
 * not store anywhere.
 */

import type { AffiliateLink, Conversion, NewConversion } from './types';

/** Strip case, spaces and punctuation so "Total Earnings($)" meets "totalearnings". */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * QMP's JSON field names are not documented, and the UI labels are not
 * necessarily what comes back. Each field is therefore looked up by a list of
 * normalized aliases rather than one exact name.
 */
const FIELDS = {
  date: ['datedaily', 'date', 'day', 'processdate', 'reportdate'],
  // `source_name` is what the live API calls the column the UI labels
  // "Placement Name". The UI labels and the JSON names do not match, which is
  // the whole reason these are lists.
  placement: ['sourcename', 'placementname', 'placement'],
  advertiser: ['advertiser', 'advertisername'],
  card: ['cardname', 'card', 'productname', 'product'],
  device: ['devicetype', 'device'],
  var2: ['var2'],
  var3: ['var3'],
  subId: ['subid', 'sub', 'subid1', 'sub1'],
  referrer: ['sessionrefurl', 'referringsessionurl', 'referringurl', 'referrer'],
  state: ['state'],
  approvals: ['approvals', 'approval', 'approvedapplications'],
  earnings: ['totalearnings', 'earnings', 'revenue', 'totalrevenue', 'payout'],
  clicks: ['clicks', 'click'],
  applications: ['applications', 'apps', 'application'],
} as const;

type FieldName = keyof typeof FIELDS;

/**
 * The most approvals a single report row is allowed to mean.
 *
 * Deliberately generous: a genuinely busy day on one card should still sync
 * without a complaint. This is a guard against a column being read as
 * "approvals" when it is really an id, a restatement or a currency figure —
 * the count drives both a loop and an array allocation, so a mis-mapped column
 * is the difference between a wrong number and a dead process.
 */
const MAX_APPROVALS_PER_ROW = 1_000;

/** Which dimensions identify a row. Measures are excluded: they are the payload. */
const DIMENSIONS: FieldName[] = [
  'date', 'placement', 'advertiser', 'card', 'device', 'var2', 'var3', 'subId', 'referrer', 'state',
];

export function readField(row: Record<string, unknown>, field: FieldName): unknown {
  const wanted = FIELDS[field] as readonly string[];
  for (const key of Object.keys(row)) {
    if (wanted.includes(normalizeKey(key))) return row[key];
  }
  return undefined;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** "1,234" / "$1,234.50" / 1234.5 / "(12.30)" as a negative. */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = asText(value);
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/[()]/g, '').replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

/** Whatever QMP calls a day, as YYYY-MM-DD. Returns '' if it is not a date. */
export function parseDate(value: unknown): string {
  const text = asText(value);
  if (!text) return '';

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 08/13/2026 and 08-13-2026. Month first: QMP is a US platform and its own
  // UI renders 08/13/2026 for the 13th of August.
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (slash) {
    const month = slash[1]!.padStart(2, '0');
    const day = slash[2]!.padStart(2, '0');
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${slash[3]}-${month}-${day}`;
    }
  }

  // "13 Aug 2026" / "Aug 13, 2026"
  const parsed = Date.parse(`${text} UTC`);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return '';
}

/** FNV-1a, base36. Short, stable, and no crypto import for a non-secret. */
export function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0').slice(0, 7);
}

/**
 * Identity of a QMP row, over every dimension it carries.
 *
 * Sorted by field name so reordering columns in QMP does not change it. It
 * does change if a dimension is added or removed, which would make previously
 * imported rows look new. That is a deliberate trade: the alternative is
 * hashing a subset, which silently merges two rows that differ only in a
 * dimension left out of the hash, and drops one of them.
 */
export function rowIdentity(row: Record<string, unknown>, reportKey: string): string {
  const parts = [`report=${reportKey}`];
  for (const field of [...DIMENSIONS].sort()) {
    parts.push(`${field}=${asText(readField(row, field))}`);
  }
  return shortHash(parts.join('|'));
}

/** `qmp:ab12cd3#2/3` — the marker a re-run looks for. */
export function markerFor(identity: string, index: number, count: number): string {
  return `qmp:${identity}#${index + 1}/${count}`;
}

const MARKER_PATTERN = /qmp:([a-z0-9]+)#(\d+)\/(\d+)/i;

export function markerIn(notes: string): string | null {
  const match = MARKER_PATTERN.exec(notes ?? '');
  return match ? `qmp:${match[1]}#${match[2]}/${match[3]}` : null;
}

export type ParsedMarker = { identity: string; index: number; count: number };

export function parseMarker(notes: string): ParsedMarker | null {
  const match = MARKER_PATTERN.exec(notes ?? '');
  if (!match) return null;
  return { identity: match[1]!, index: Number(match[2]), count: Number(match[3]) };
}

/**
 * Split a total into `count` whole-cent amounts that add back up to it.
 * The remainder goes one cent at a time to the earliest amounts.
 */
export function splitAmount(total: number, count: number): number[] {
  if (count <= 0) return [];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  const remainder = cents - base * count;
  return Array.from({ length: count }, (_, index) => (index < remainder ? base + 1 : base) / 100);
}

export type PlannedConversion = NewConversion & { marker: string; card: string };

export type SyncIssue = {
  kind:
    | 'no-link'
    | 'ambiguous-link'
    | 'no-date'
    | 'negative-earnings'
    | 'no-approvals-column'
    | 'restated'
    | 'implausible-count';
  detail: string;
  /** How many QMP rows hit this. */
  rows: number;
  /** Approvals sitting behind the issue, so the cost of ignoring it is visible. */
  approvals: number;
};

export type SyncPlan = {
  create: PlannedConversion[];
  /** Already imported on an earlier run. */
  skipped: number;
  issues: SyncIssue[];
  /** Rows that carried at least one approval. */
  rowsWithApprovals: number;
  totalApprovals: number;
  totalEarnings: number;
  /** True when the report has no Approvals column at all. */
  unusable: boolean;
};

function linkFor(
  subId: string,
  row: Record<string, unknown>,
  links: AffiliateLink[],
  defaultSlug: string,
): { link: AffiliateLink } | { error: SyncIssue['kind']; detail: string } {
  const wanted = subId.trim().toLowerCase();
  const matches = links.filter((link) => link.usr.trim().toLowerCase() === wanted);

  if (matches.length === 1) return { link: matches[0]! };
  if (matches.length === 0) {
    // QMP does not always carry a usable tracking key. On report 93440 every
    // row's Sub ID is "JavaScriptTransition_JSWidget", which is QuinStreet's
    // own widget identifier rather than anybody's key, so without somewhere to
    // put them the whole report is unattributable. QMP_DEFAULT_SLUG names that
    // somewhere. It is off unless set: guessing an owner is worse than saying
    // nothing.
    if (defaultSlug) {
      const fallback = links.find((link) => link.slug === defaultSlug);
      if (fallback) return { link: fallback };
      return {
        error: 'no-link',
        detail: `QMP_DEFAULT_SLUG is set to "${defaultSlug}" but no link has that slug.`,
      };
    }
    return {
      error: 'no-link',
      detail: wanted
        ? `Sub ID "${subId}" has no link. Create one with usr=${subId}, set QMP_DEFAULT_SLUG to send these to one link, or fix the Sub ID in QMP.`
        : 'Rows with no Sub ID need a house link (a link with usr left empty).',
    };
  }

  // Several links share the tracking key. The card or placement may tell them
  // apart through the link's campaign; if not, say so rather than pick one.
  const card = asText(readField(row, 'card')).toLowerCase();
  const placement = asText(readField(row, 'placement')).toLowerCase();
  const byCampaign = matches.filter((link) => {
    const campaign = link.campaign.trim().toLowerCase();
    if (!campaign) return false;
    return card.includes(campaign) || campaign.includes(card) || placement.includes(campaign);
  });
  if (byCampaign.length === 1) return { link: byCampaign[0]! };

  return {
    error: 'ambiguous-link',
    detail: `Sub ID "${subId}" matches ${matches.length} links (${matches
      .map((link) => link.slug)
      .join(', ')}) and the card name does not single one out.`,
  };
}

export function planSync(options: {
  rows: Record<string, unknown>[];
  reportKey: string;
  links: AffiliateLink[];
  existing: Conversion[];
  /** Where to put approvals whose Sub ID matches no link. Off when empty. */
  defaultSlug?: string;
}): SyncPlan {
  const { rows, reportKey, links, existing, defaultSlug = '' } = options;

  const alreadyImported = new Set<string>();
  // What each already-imported row was worth last time, so a restatement is
  // caught instead of being written a second time alongside the first.
  const importedCount = new Map<string, number>();
  for (const conversion of existing) {
    const parsed = parseMarker(conversion.notes ?? '');
    if (!parsed) continue;
    alreadyImported.add(markerFor(parsed.identity, parsed.index - 1, parsed.count));
    importedCount.set(parsed.identity, parsed.count);
  }

  const create: PlannedConversion[] = [];
  const issueMap = new Map<string, SyncIssue>();
  const addIssue = (kind: SyncIssue['kind'], detail: string, approvals: number) => {
    const key = `${kind}|${detail}`;
    const found = issueMap.get(key);
    if (found) {
      found.rows += 1;
      found.approvals += approvals;
    } else {
      issueMap.set(key, { kind, detail, rows: 1, approvals });
    }
  };

  let skipped = 0;
  let rowsWithApprovals = 0;
  let totalApprovals = 0;
  let totalEarnings = 0;

  // A report with no Approvals column cannot be synced at all; say that once
  // rather than reporting every row as a problem.
  const hasApprovals = rows.some((row) => readField(row, 'approvals') !== undefined);
  if (rows.length > 0 && !hasApprovals) {
    return {
      create: [],
      skipped: 0,
      issues: [
        {
          kind: 'no-approvals-column',
          detail: 'This report has no Approvals column. Add Approvals and Total Earnings to it in QMP.',
          rows: rows.length,
          approvals: 0,
        },
      ],
      rowsWithApprovals: 0,
      totalApprovals: 0,
      totalEarnings: 0,
      unusable: true,
    };
  }

  // Rows that share an identity (same dimensions) get an occurrence suffix so
  // the second one cannot be mistaken for a repeat of the first.
  const seenIdentities = new Map<string, number>();

  for (const row of rows) {
    const approvals = Math.trunc(parseNumber(readField(row, 'approvals')) ?? 0);
    if (approvals <= 0) continue;

    // A row's approval count is the loop bound below, and columns are matched
    // by fuzzy alias — so a renamed column, a restatement, or an account id
    // that happens to normalise to "approvals" would be expanded into that many
    // conversion rows. At best that is a wildly wrong money record; at a large
    // enough value it is an allocation that takes the process down before
    // anyone sees the plan. Anything past a plausible day's work is reported
    // rather than expanded.
    if (approvals > MAX_APPROVALS_PER_ROW) {
      addIssue(
        'implausible-count',
        `A row claims ${approvals.toLocaleString()} approvals, which is past the ${MAX_APPROVALS_PER_ROW.toLocaleString()} a single row is allowed to mean. Check the report's columns before syncing it.`,
        0,
      );
      continue;
    }

    rowsWithApprovals += 1;
    totalApprovals += approvals;

    const earnings = parseNumber(readField(row, 'earnings')) ?? 0;
    totalEarnings += earnings;

    const approvedOn = parseDate(readField(row, 'date'));
    if (!approvedOn) {
      addIssue('no-date', `A row has no readable date (${asText(readField(row, 'date')) || 'empty'}).`, approvals);
      continue;
    }

    if (earnings < 0) {
      // A clawback. Ledger has no negative approval, and inventing one would
      // corrupt the count as well as the total.
      addIssue(
        'negative-earnings',
        `${approvedOn} has negative earnings (${earnings}), which looks like a reversal. Adjust it by hand.`,
        approvals,
      );
      continue;
    }

    const subId = asText(readField(row, 'subId'));
    const resolved = linkFor(subId, row, links, defaultSlug);
    if ('error' in resolved) {
      addIssue(resolved.error, resolved.detail, approvals);
      continue;
    }

    const baseIdentity = rowIdentity(row, reportKey);
    const occurrence = seenIdentities.get(baseIdentity) ?? 0;
    seenIdentities.set(baseIdentity, occurrence + 1);
    const identity = occurrence === 0 ? baseIdentity : `${baseIdentity}${occurrence}`;

    const card = asText(readField(row, 'card'));

    // QMP restates: a day's approvals can go up (or down) after the fact. The
    // markers of an already-imported row all carry the count it had then, so
    // a changed count would match none of them and the row would be written a
    // second time on top of the first. Refuse, and say what to do.
    const previousCount = importedCount.get(identity);
    if (previousCount !== undefined && previousCount !== approvals) {
      addIssue(
        'restated',
        `${approvedOn}${card ? ` ${card}` : ''} was imported with ${previousCount} approval${
          previousCount === 1 ? '' : 's'
        } and QMP now says ${approvals}. Remove the ${previousCount} old row${
          previousCount === 1 ? '' : 's'
        } from Approvals, then sync again.`,
        approvals,
      );
      continue;
    }

    const amounts = splitAmount(earnings, approvals);

    for (let index = 0; index < approvals; index += 1) {
      const marker = markerFor(identity, index, approvals);
      if (alreadyImported.has(marker)) {
        skipped += 1;
        continue;
      }
      create.push({
        slug: resolved.link.slug,
        usr: resolved.link.usr,
        approvedOn,
        amount: amounts[index]!,
        // Card first: it is the useful half for anyone reading the sheet, and
        // Ledger stores the card nowhere else.
        notes: card ? `${card} · ${marker}` : marker,
        marker,
        card,
      });
    }
  }

  return {
    create,
    skipped,
    issues: [...issueMap.values()].sort((a, b) => b.approvals - a.approvals),
    rowsWithApprovals,
    totalApprovals,
    totalEarnings,
    unusable: false,
  };
}
