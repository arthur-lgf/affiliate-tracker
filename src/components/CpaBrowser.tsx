'use client';

import { Fragment, useMemo, useState } from 'react';
import { Pager } from '@/components/Pager';
import { SortHeader, nextSort, type SortState } from '@/components/SortHeader';
import { TableScroller } from '@/components/TableScroller';
import { formatDay, formatMoney, formatPercent } from '@/lib/analytics';
import type { CpaRateView } from '@/lib/cpa';
import { BLANK, sortRows, type ColumnKind } from '@/lib/report-table';
import { PAGE_SIZES, pageSlice } from '@/lib/paging';

/**
 * The rate card, grouped the way the report itself is written: one row per
 * card, with its tiers folded underneath it.
 *
 * The export is a list of rates, but a person reads it as a list of cards —
 * "what does the Platinum pay" is one question, not three. Flat, a nine-tier
 * card is nine rows that push everything else off the screen; grouped, it is
 * one row you open when you need it.
 *
 * That makes the card the unit of this table, and so also the unit of the
 * pager: a page is ten cards, never ten rates, because half a card's tiers at
 * the bottom of one page and the rest at the top of the next is not something
 * anybody can read.
 */

/** One card, with every tier it pays at. An untiered card has exactly one. */
export type Group = {
  key: string;
  issuer: string;
  card: string;
  rates: CpaRateView[];
  /** True when the export gave this card's rows tier labels. */
  tiered: boolean;
};

type Column = {
  key: string;
  label: string;
  right: boolean;
  /**
   * What this column sorts a whole card by. A tiered card has no single rate,
   * so money sorts by its best tier — the honest answer to "which card pays
   * most", which is the question somebody sorting by it is asking.
   */
  read: (group: Group) => unknown;
  kind: ColumnKind;
};

/**
 * The columns this viewer may read.
 *
 * The merchant's own figures — what it pays, what it paid before, how it moved
 * — are an admin's. They are not blanked out for everybody else: the rows
 * arrive without them (see `ratesForViewer`), so a column of dashes would be a
 * standing reminder of a number nobody is going to be shown.
 */
const GROSS_ONLY = new Set(['current', 'previous', 'change']);

export function columnsFor(gross: boolean): Column[] {
  return gross ? COLUMNS : COLUMNS.filter((column) => !GROSS_ONLY.has(column.key));
}

/** What the Tier column puts a card in order by: the number in its badge. */
export function tierCount(group: Group): number | null {
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
export function tiersOf(group: Group, sort: SortState): CpaRateView[] {
  const flip = sort?.key === 'tier' && sort.direction === 'desc';
  return flip ? [...group.rates].reverse() : group.rates;
}

/**
 * The best-paying of a card's tiers, ignoring any with no rate at all.
 *
 * Picked on the affiliate's half rather than the merchant's rate, because that
 * is the figure every reader has: one is a fixed fraction of the other, so the
 * order is the same either way, and choosing the one that is always there means
 * the table sorts identically for an admin and for everybody else.
 */
function best(group: Group): CpaRateView | null {
  let found: CpaRateView | null = null;
  for (const rate of group.rates) {
    if (rate.revenue === null) continue;
    if (found === null || rate.revenue > (found.revenue ?? 0)) found = rate;
  }
  return found;
}

const COLUMNS: Column[] = [
  { key: 'issuer', label: 'Issuer', right: false, read: (g) => g.issuer, kind: 'text' },
  { key: 'card', label: 'Card', right: false, read: (g) => g.card, kind: 'text' },
  /*
   * How many tiers the card pays at — the number in the badge, which is all
   * this column says about a card. An untiered card has no tier to be put in
   * order by, so it reads blank and falls to the end whichever way the arrow
   * points, the same as every other blank in this table.
   *
   * Sorting it also turns the tiers inside each card round: see `tiersOf`.
   * Without that, "highest tier first" would reorder seven cards and leave
   * Tier 1 sitting at the top of each of them.
   */
  { key: 'tier', label: 'Tier', right: false, read: tierCount, kind: 'number' },
  { key: 'current', label: 'Pays now', right: true, read: (g) => best(g)?.current ?? null, kind: 'currency' },
  /*
   * Half of what the card pays, through the same helper the dashboard's
   * Potential revenue column uses. One definition of the share, in
   * AFFILIATE_SHARE, so the rate card and the earnings table can never quote
   * two different splits for the same dollar.
   */
  { key: 'affiliate', label: 'Potential revenue', right: true, read: (g) => best(g)?.revenue ?? null, kind: 'currency' },
  { key: 'previous', label: 'Paid before', right: true, read: (g) => best(g)?.previous ?? null, kind: 'currency' },
  { key: 'change', label: 'Change', right: true, read: (g) => best(g)?.change ?? null, kind: 'percent' },
  { key: 'changedOn', label: 'Changed', right: true, read: (g) => best(g)?.changedOn ?? '', kind: 'text' },
];

/** Rates into cards, keeping the order they arrived in. */
export function groupRates(rows: CpaRateView[]): Group[] {
  const groups = new Map<string, Group>();
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

export function CpaBrowser({ rows, gross }: { rows: CpaRateView[]; gross: boolean }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0]);
  /**
   * Which cards are folded shut. Closed is what is tracked rather than open, so
   * the default is everything open: the same as the report this copies, and the
   * state somebody can read without clicking anything first.
   */
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

  const groups = useMemo(() => groupRates(rows), [rows]);
  const columns = useMemo(() => columnsFor(gross), [gross]);
  // Rebuilt with the columns, so a sort can only ever name one this viewer has.
  const byKey = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? groups.filter((group) =>
          // Who pays, what for, and which tier. Not the amounts — "420"
          // matching a dollar figure and a date at once is noise, not a search.
          `${group.issuer} ${group.card} ${group.rates.map((rate) => rate.tier).join(' ')}`
            .toLowerCase()
            .includes(needle),
        )
      : groups;

    if (!sort) return filtered;
    const column = byKey.get(sort.key);
    if (!column) return filtered;
    return sortRows(filtered, column.read, column.kind, sort.direction);
  }, [groups, query, sort, byKey]);

  const visible = pageSlice(matched, page, perPage);
  const anyTiered = groups.some((group) => group.tiered);
  const allClosed = anyTiered && groups.every((group) => !group.tiered || closed.has(group.key));

  function search(next: string) {
    setQuery(next);
    setPage(1);
  }

  function toggleSort(key: string) {
    setPage(1);
    setSort((current) => nextSort(current, key));
  }

  function toggle(key: string) {
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    // Every card, not just this page. A "fold everything" that left the next
    // page open would be a control that lies about what it did.
    setClosed(allClosed ? new Set() : new Set(groups.filter((g) => g.tiered).map((g) => g.key)));
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <div className="min-w-[200px] flex-1">
          <label className="sr-only" htmlFor="cpa-search">
            Search the rate card
          </label>
          <input
            id="cpa-search"
            type="search"
            value={query}
            onChange={(event) => search(event.target.value)}
            placeholder="Search an issuer, a card or a tier…"
            className="field"
          />
        </div>
        {anyTiered ? (
          <button type="button" className="btn-quiet btn-sm" onClick={toggleAll}>
            {allClosed ? 'Open every card' : 'Fold every card'}
          </button>
        ) : null}
      </div>

      {matched.length === 0 ? (
        <p className="mt-8 rounded-[20px] border-2 border-dashed border-edge-strong bg-panel px-6 py-16 text-center text-[13px] text-ink-soft">
          {groups.length === 0
            ? 'No rates uploaded yet.'
            : `Nothing matches${query ? ` “${query}”` : ''}.`}
        </p>
      ) : (
        <TableScroller className="mt-5" label="Card rates">
          <table
            className={`w-full border-collapse text-left ${
              gross ? 'min-w-[1040px]' : 'min-w-[720px]'
            }`}
          >
            <thead>
              <tr className="bg-paper-card">
                {columns.map((column) => (
                  <SortHeader
                    key={column.key}
                    label={column.label}
                    sortKey={column.key}
                    sort={sort}
                    onSort={toggleSort}
                    right={column.right}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((group, index) => {
                const open = !closed.has(group.key);
                const single = group.tiered ? null : group.rates[0]!;
                /*
                 * Every other card sits on a band, and a whole card takes one:
                 * a tiered card and its tiers are one thing, and striping them
                 * apart would undo the grouping this table exists for. Folded
                 * shut, that is exactly one row per band, which is the plain
                 * every-other-row stripe.
                 *
                 * Counted off the page rather than the whole list, so every
                 * page opens on the same colour instead of the first row
                 * changing shade as you page through.
                 */
                const band = index % 2 === 1 ? 'bg-paper-sunk' : '';

                return (
                  <Fragment key={group.key}>
                    {/* The card. On a tiered one this is a heading and nothing
                        else: the rates live on the tiers underneath, and
                        putting a figure here would mean inventing one. */}
                    <tr
                      className={`${
                        group.tiered ? 'border-t-2 border-edge-faint' : 'divider-row'
                      } ${band}`}
                    >
                      <td className="max-w-[200px] truncate px-3 py-3 text-[12px] text-ink-soft">
                        {group.issuer || BLANK}
                      </td>
                      <td className="max-w-[380px] px-3 py-3 text-[13px] font-semibold">
                        {group.card}
                      </td>
                      <td className="px-3 py-3 text-[12px]">
                        {group.tiered ? (
                          <button
                            type="button"
                            onClick={() => toggle(group.key)}
                            aria-expanded={open}
                            className="inline-flex items-center gap-2 rounded-lg px-1 py-1"
                          >
                            <span className="chip chip-quiet tnum">{group.rates.length}</span>
                            <span aria-hidden className="text-ink-soft">
                              {open ? '▲' : '▼'}
                            </span>
                            <span className="sr-only">
                              {open ? 'Fold away' : 'Show'} the {group.rates.length} tiers of{' '}
                              {group.card}
                            </span>
                          </button>
                        ) : (
                          <span className="text-ink-dim">{BLANK}</span>
                        )}
                      </td>
                      {gross ? <Money value={single ? single.current : null} lead /> : null}
                      <Money value={single ? single.revenue : null} lead />
                      {gross ? <Money value={single ? single.previous : null} /> : null}
                      {gross ? <Change value={single ? single.change : null} /> : null}
                      <Changed value={single ? single.changedOn : ''} />
                    </tr>

                    {group.tiered && open
                      ? tiersOf(group, sort).map((rate, tierIndex) => (
                          <tr
                            key={`${group.key}:${rate.tier}:${tierIndex}`}
                            className={`divider-row ${band}`}
                          >
                            {/* Blank on purpose: the issuer and the card are on
                                the row above, and repeating them down every
                                tier is what makes a grouped table read like an
                                ungrouped one. */}
                            <td />
                            <td />
                            <td className="whitespace-nowrap px-3 py-3 text-[12px]">
                              <span aria-hidden className="mr-2 text-ink-dim">
                                ↳
                              </span>
                              {/* The card's name, for a screen reader only: a
                                  row that says only "Tier 2" is unreadable out
                                  of the context the indent gives sighted eyes. */}
                              <span className="sr-only">{group.card}, </span>
                              {rate.tier || BLANK}
                            </td>
                            {gross ? <Money value={rate.current} lead /> : null}
                            <Money value={rate.revenue} lead />
                            {gross ? <Money value={rate.previous} /> : null}
                            {gross ? <Change value={rate.change} /> : null}
                            <Changed value={rate.changedOn} />
                          </tr>
                        ))
                      : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </TableScroller>
      )}

      <Pager
        total={matched.length}
        page={page}
        perPage={perPage}
        onPage={setPage}
        onPerPage={setPerPage}
        label="Cards"
        note={matched.length === groups.length ? '' : ` · ${groups.length} in total`}
        className="mt-6"
      />
    </>
  );
}

/**
 * A money cell. `lead` marks the two columns people came here for, which are
 * set larger; the rest are context and are sized as such.
 *
 * Null reads as a dash rather than as $0 throughout. A card at zero has been
 * switched off, which is worth seeing; a blank one simply has no figure.
 */
function Money({ value, lead = false }: { value: number | null; lead?: boolean }) {
  return (
    <td
      className={
        lead
          ? 'tnum px-3 py-3 text-right font-display text-[15px] font-semibold'
          : 'tnum px-3 py-3 text-right text-[12px] text-ink-soft'
      }
    >
      {value === null ? <span className="text-ink-dim">{BLANK}</span> : formatMoney(value)}
    </td>
  );
}

function Change({ value }: { value: number | null }) {
  return (
    <td className="tnum px-3 py-3 text-right text-[12px]">
      {value === null ? (
        <span className="text-ink-dim">{BLANK}</span>
      ) : (
        <span className={value < 0 ? 'text-alarm' : undefined}>
          {value > 0 ? '+' : ''}
          {formatPercent(value, 2)}
        </span>
      )}
    </td>
  );
}

function Changed({ value }: { value: string }) {
  return (
    <td className="whitespace-nowrap px-3 py-3 text-right text-[12px] text-ink-soft">
      {value ? formatDay(value) : BLANK}
    </td>
  );
}
