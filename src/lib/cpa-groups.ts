/**
 * The rate card as cards rather than rates, and the filter over them.
 *
 * The export is a list of rates, but a person reads it as a list of cards:
 * "what does the Platinum pay" is one question, not three. So the card is the
 * unit here, and a tiered card carries its tiers with it.
 *
 * All of it is pure and none of it imports React, which is the point of the
 * module. The table on screen and the three files it exports have to agree
 * about which cards a filter keeps, which card is the highest paying and what
 * order the tiers go in. Two copies of those rules would eventually give a
 * person a PDF that does not match the page they printed it from, and the
 * disagreement would be about money.
 *
 * scripts/cpa-export-checks.ts holds it to that.
 */

import { formatMoney } from './analytics';
import type { CpaRateView } from './cpa';
import { sortRows, type ColumnKind, type SortDirection } from './report-table';

/** One card, with every tier it pays at. An untiered card has exactly one. */
export type CpaGroup = {
  key: string;
  issuer: string;
  card: string;
  rates: CpaRateView[];
  /** True when the export gave this card's rows tier labels. */
  tiered: boolean;
};

/**
 * A sort, as a column key and a direction.
 *
 * Structurally the same shape as SortHeader's own SortState, on purpose: that
 * one lives in a client component and this module must not import it, but the
 * two are interchangeable wherever they meet.
 */
export type CpaSort = { key: string; direction: SortDirection } | null;

/** Rates into cards, keeping the order they arrived in. */
export function groupRates(rows: CpaRateView[]): CpaGroup[] {
  const groups = new Map<string, CpaGroup>();
  for (const rate of rows) {
    const key = `${rate.issuer}|${rate.card}`;
    const group = groups.get(key);
    if (group) group.rates.push(rate);
    else groups.set(key, { key, issuer: rate.issuer, card: rate.card, rates: [rate], tiered: false });
  }
  for (const group of groups.values()) {
    // Tiered because the export said so, not because there is more than one
    // row. One tier is still a tier, and the report writes it as one.
    group.tiered = group.rates.some((rate) => rate.tier !== '');
  }
  return [...groups.values()];
}

/**
 * The best-paying of a card's tiers, ignoring any with no rate at all.
 *
 * Picked on the affiliate's half rather than the merchant's rate, because that
 * is the figure every reader has: one is a fixed fraction of the other, so the
 * order is the same either way, and choosing the one that is always there means
 * the table sorts identically for an admin and for everybody else.
 */
export function bestRate(group: CpaGroup): CpaRateView | null {
  let found: CpaRateView | null = null;
  for (const rate of group.rates) {
    if (rate.revenue === null) continue;
    if (found === null || rate.revenue > (found.revenue ?? 0)) found = rate;
  }
  return found;
}

/**
 * What this card pays, in the money column this viewer actually reads.
 *
 * An admin is filtering on the merchant's rate and an affiliate on their own
 * share, and neither is shown the other. A floor of 200 therefore means two
 * different amounts to the two of them, which is why the control that sets it
 * is labelled differently for each.
 */
export function payoutOf(group: CpaGroup, gross: boolean): number | null {
  const rate = bestRate(group);
  if (!rate) return null;
  return gross ? rate.current : rate.revenue;
}

/** What the Tier column puts a card in order by: the number in its badge. */
export function tierCount(group: CpaGroup): number | null {
  return group.tiered ? group.rates.length : null;
}

/**
 * A card's tiers, in the order the sort asks for.
 *
 * They arrive as the report writes them, Tier 1 first, which is the order to
 * read them in and the order to go back to. Only the Tier column's own
 * descending sort flips them, because that is the one click that means "start
 * from the highest".
 */
export function tiersOf(group: CpaGroup, sort: CpaSort): CpaRateView[] {
  const flip = sort?.key === 'tier' && sort.direction === 'desc';
  return flip ? [...group.rates].reverse() : group.rates;
}

/* ------------------------------------------------------------ columns --- */

export type CpaColumn = {
  key: string;
  label: string;
  right: boolean;
  /**
   * What this column sorts a whole card by. A tiered card has no single rate,
   * so money sorts by its best tier: the honest answer to "which card pays
   * most", which is the question somebody sorting by it is asking.
   */
  read: (group: CpaGroup) => unknown;
  kind: ColumnKind;
};

/**
 * The columns a viewer may read.
 *
 * The merchant's own figures (what it pays, what it paid before, how it moved)
 * are an admin's. They are not blanked out for everybody else: the rows arrive
 * without them (see `ratesForViewer`), so a column of dashes would be a
 * standing reminder of a number nobody is going to be shown.
 */
const GROSS_ONLY = new Set(['current', 'previous', 'change']);

export const CPA_COLUMNS: CpaColumn[] = [
  { key: 'issuer', label: 'Issuer', right: false, read: (g) => g.issuer, kind: 'text' },
  { key: 'card', label: 'Card', right: false, read: (g) => g.card, kind: 'text' },
  /*
   * How many tiers the card pays at: the number in the badge, which is all
   * this column says about a card. An untiered card has no tier to be put in
   * order by, so it reads blank and falls to the end whichever way the arrow
   * points, the same as every other blank in this table.
   *
   * Sorting it also turns the tiers inside each card round: see `tiersOf`.
   * Without that, "highest tier first" would reorder seven cards and leave
   * Tier 1 sitting at the top of each of them.
   */
  { key: 'tier', label: 'Tier', right: false, read: tierCount, kind: 'number' },
  { key: 'current', label: 'Pays now', right: true, read: (g) => bestRate(g)?.current ?? null, kind: 'currency' },
  /*
   * Half of what the card pays, worked out in `ratesForViewer` through the
   * same helper the dashboard's Potential revenue column uses. One definition
   * of the share, so the rate card and the earnings table can never quote two
   * different splits for the same dollar.
   */
  { key: 'affiliate', label: 'Potential revenue', right: true, read: (g) => bestRate(g)?.revenue ?? null, kind: 'currency' },
  { key: 'previous', label: 'Paid before', right: true, read: (g) => bestRate(g)?.previous ?? null, kind: 'currency' },
  { key: 'change', label: 'Change', right: true, read: (g) => bestRate(g)?.change ?? null, kind: 'percent' },
  { key: 'changedOn', label: 'Changed', right: true, read: (g) => bestRate(g)?.changedOn ?? '', kind: 'text' },
];

export function columnsFor(gross: boolean): CpaColumn[] {
  return gross ? CPA_COLUMNS : CPA_COLUMNS.filter((column) => !GROSS_ONLY.has(column.key));
}

/**
 * What the table opens on: the most valuable card first.
 *
 * It used to open unsorted, which meant alphabetical by issuer, an order that
 * answers "who do we work with" when the question this page exists for is
 * "which card is worth pushing". Somebody had to click a header to find that
 * out, and the first click gives ascending, so the honest answer was two
 * clicks away.
 *
 * Keyed to the money column this viewer actually has. "Pays now" is an admin's
 * column (see GROSS_ONLY); naming it for an affiliate would leave the sort
 * silently ignored, because the lookup only knows the columns they were given,
 * and the arrow would be drawn on no header at all. Both columns are the same
 * number scaled by the same share, so the ranking is identical either way.
 */
export function defaultSort(gross: boolean): NonNullable<CpaSort> {
  return { key: gross ? 'current' : 'affiliate', direction: 'desc' };
}

/**
 * Cards in the order a sort asks for, ignoring one that names a column this
 * viewer does not have.
 *
 * Ignoring rather than falling back, because a sort key only arrives from two
 * places: this app's own table, and a query string somebody edited. Neither is
 * worth failing a download over.
 */
export function sortGroups(groups: CpaGroup[], sort: CpaSort, gross: boolean): CpaGroup[] {
  if (!sort) return groups;
  const column = columnsFor(gross).find((entry) => entry.key === sort.key);
  if (!column) return groups;
  return sortRows(groups, column.read, column.kind, sort.direction);
}

/* ------------------------------------------------------------- filter --- */

/** Whether a card is being kept for its tiers, its single rate, or either. */
export type CpaShape = 'all' | 'tiered' | 'flat';

export type CpaFilter = {
  /** Free text over the issuer, the card and its tier labels. */
  query: string;
  /** One issuer, exactly as written in the export. Empty means all of them. */
  issuer: string;
  /** The least a card may pay and still be listed. Null means no floor. */
  min: number | null;
  shape: CpaShape;
};

export const NO_FILTER: CpaFilter = { query: '', issuer: '', min: null, shape: 'all' };

/**
 * The floors the control offers.
 *
 * Steps rather than a number box because the question being asked is "is this
 * card worth quoting", and that is answered in round numbers. A free field
 * invites 187 and then a table nobody can describe.
 */
export const MIN_STEPS = [100, 200, 300, 500, 750] as const;

export function isFiltered(filter: CpaFilter): boolean {
  return (
    filter.query.trim() !== '' || filter.issuer !== '' || filter.min !== null || filter.shape !== 'all'
  );
}

/** Every issuer on the card, once each, in reading order. */
export function issuersOf(groups: CpaGroup[]): string[] {
  const seen = new Set<string>();
  for (const group of groups) if (group.issuer) seen.add(group.issuer);
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * The cards a filter keeps.
 *
 * Card level throughout, and the floor is the part that matters: a card is
 * judged on its best tier and then keeps all of them. Dropping the tiers under
 * the floor from a card that is being kept for its top one would leave a rate
 * card that misquotes what the first approvals actually pay.
 */
export function filterGroups(groups: CpaGroup[], filter: CpaFilter, gross: boolean): CpaGroup[] {
  const needle = filter.query.trim().toLowerCase();

  return groups.filter((group) => {
    if (filter.issuer && group.issuer !== filter.issuer) return false;
    if (filter.shape === 'tiered' && !group.tiered) return false;
    if (filter.shape === 'flat' && group.tiered) return false;

    if (filter.min !== null) {
      const pays = payoutOf(group, gross);
      // A card with no rate at all cannot clear a floor. It is not a zero.
      if (pays === null || pays < filter.min) return false;
    }

    if (needle) {
      // Who pays, what for, and which tier. Not the amounts: "420" matching a
      // dollar figure and a date at once is noise, not a search.
      const haystack = `${group.issuer} ${group.card} ${group.rates
        .map((rate) => rate.tier)
        .join(' ')}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    return true;
  });
}

/**
 * The filter in words, for the top of an exported file.
 *
 * A filtered export that does not say it is filtered is a rate card with cards
 * missing from it, and the person who opens the file six weeks later has no
 * way of telling which of those it is.
 */
export function describeFilter(filter: CpaFilter, gross: boolean): string {
  const parts: string[] = [];
  if (filter.issuer) parts.push(filter.issuer);
  if (filter.min !== null) {
    parts.push(`${gross ? 'paying' : 'earning'} ${formatMoney(filter.min)} or more`);
  }
  if (filter.shape === 'tiered') parts.push('tiered cards only');
  if (filter.shape === 'flat') parts.push('cards with one rate only');
  if (filter.query.trim()) parts.push(`matching "${filter.query.trim()}"`);
  if (parts.length === 0) return '';

  // Sentence case, so the line reads as a line rather than as a list of tags.
  const first = parts[0]!;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...parts.slice(1)].join(' · ');
}

/* ---------------------------------------------------- filter in a URL ---- */

/**
 * The filter as query parameters.
 *
 * Only what is set is written. A download URL that carries `min=&shape=all` on
 * every request is one nobody can read in a network tab, and the empty values
 * would have to be understood by the reader at the other end anyway.
 */
export function filterQuery(filter: CpaFilter, sort: CpaSort): string {
  const params = new URLSearchParams();
  if (filter.query.trim()) params.set('q', filter.query.trim());
  if (filter.issuer) params.set('issuer', filter.issuer);
  if (filter.min !== null) params.set('min', String(filter.min));
  if (filter.shape !== 'all') params.set('shape', filter.shape);
  if (sort) {
    params.set('sort', sort.key);
    params.set('dir', sort.direction);
  }
  return params.toString();
}

type Params = { get(name: string): string | null };

/**
 * A filter read back off a URL, forgiving anything it does not recognise.
 *
 * Every field is bounded here rather than trusted. This is a signed-in reader
 * asking for their own rate card, so the risk is not what they might see; it
 * is a hand-edited `min=NaN` or a 40 KB `q=` turning a download into a 500.
 */
export function readFilter(params: Params): CpaFilter {
  const shape = params.get('shape');
  const min = Number(params.get('min'));

  return {
    query: (params.get('q') ?? '').slice(0, 120),
    issuer: (params.get('issuer') ?? '').slice(0, 200),
    min: Number.isFinite(min) && min > 0 ? min : null,
    shape: shape === 'tiered' || shape === 'flat' ? shape : 'all',
  };
}

/** A sort read back off a URL, falling back to what the table opens on. */
export function readSort(params: Params, gross: boolean): CpaSort {
  const key = params.get('sort');
  if (!key) return defaultSort(gross);
  if (!columnsFor(gross).some((column) => column.key === key)) return defaultSort(gross);
  return { key, direction: params.get('dir') === 'asc' ? 'asc' : 'desc' };
}
