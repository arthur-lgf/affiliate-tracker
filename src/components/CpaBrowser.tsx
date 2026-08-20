'use client';

import { useMemo, useState } from 'react';
import { Pager } from '@/components/Pager';
import { SortHeader, nextSort, type SortState } from '@/components/SortHeader';
import { TableScroller } from '@/components/TableScroller';
import { formatDay, formatMoney, formatPercent } from '@/lib/analytics';
import { tierNumber } from '@/lib/cpa';
import { BLANK, sortRows, type ColumnKind } from '@/lib/report-table';
import { PAGE_SIZES, pageSlice } from '@/lib/paging';
import type { CpaRate } from '@/lib/types';

/**
 * A rate as this table needs it.
 *
 * Without the placement: it is the same string on every row of the export, the
 * table never shows it, and sending it anyway would be seventy bytes of the
 * same sentence repeated two hundred times in the page. The page prints it
 * once, above.
 */
export type CpaRateRow = Omit<CpaRate, 'placement'>;

/**
 * The rate card: search it, sort it, page through it.
 *
 * Everyone signed in can read this. It is the answer to "what do we get for
 * this card", which is a question a setter has mid-conversation, so the search
 * box is the important control and it is the first thing on the panel.
 */

type Column = {
  key: string;
  label: string;
  right: boolean;
  read: (rate: CpaRateRow) => unknown;
  kind: ColumnKind;
};

const COLUMNS: Column[] = [
  { key: 'issuer', label: 'Issuer', right: false, read: (r) => r.issuer, kind: 'text' },
  { key: 'card', label: 'Card', right: false, read: (r) => r.card, kind: 'text' },
  // Sorted by the number in it, so "Tier 10" lands after "Tier 9" rather than
  // between "Tier 1" and "Tier 2". A card with a single rate sorts first.
  { key: 'tier', label: 'Tier', right: false, read: (r) => (r.tier ? tierNumber(r.tier) : null), kind: 'number' },
  { key: 'current', label: 'Pays now', right: true, read: (r) => r.current, kind: 'currency' },
  { key: 'previous', label: 'Paid before', right: true, read: (r) => r.previous, kind: 'currency' },
  { key: 'change', label: 'Change', right: true, read: (r) => r.change, kind: 'percent' },
  { key: 'changedOn', label: 'Changed', right: true, read: (r) => r.changedOn, kind: 'text' },
];

const byKey = new Map(COLUMNS.map((column) => [column.key, column]));

export function CpaBrowser({ rows }: { rows: CpaRateRow[] }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0]);

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((rate) =>
          // The three things somebody would actually type: who pays, what for,
          // and which tier. Not the amounts — "420" matching a dollar figure
          // and a date at the same time is noise, not a search.
          `${rate.issuer} ${rate.card} ${rate.tier}`.toLowerCase().includes(needle),
        )
      : rows;

    if (!sort) return filtered;
    const column = byKey.get(sort.key);
    if (!column) return filtered;
    return sortRows(filtered, column.read, column.kind, sort.direction);
  }, [rows, query, sort]);

  const visible = pageSlice(matched, page, perPage);

  function search(next: string) {
    setQuery(next);
    setPage(1);
  }

  function toggleSort(key: string) {
    setPage(1);
    setSort((current) => nextSort(current, key));
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
      </div>

      {matched.length === 0 ? (
        <p className="mt-8 rounded-[20px] border-2 border-dashed border-edge-strong bg-panel px-6 py-16 text-center text-[20px] text-ink-soft">
          {rows.length === 0
            ? 'No rates uploaded yet.'
            : `Nothing matches${query ? ` “${query}”` : ''}.`}
        </p>
      ) : (
        <TableScroller className="mt-5" label="CPA rates">
          <table className="w-full min-w-[880px] border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-edge">
                {COLUMNS.map((column) => (
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
              {visible.map((rate, index) => (
                <tr key={`${rate.issuer}:${rate.card}:${rate.tier}:${index}`} className="divider-row last:border-0">
                  <td className="max-w-[200px] truncate px-3 py-3 text-[18px] text-ink-soft">
                    {rate.issuer || BLANK}
                  </td>
                  <td className="max-w-[380px] px-3 py-3 text-[19px] font-semibold">{rate.card}</td>
                  <td className="px-3 py-3 text-[18px]">
                    {rate.tier ? (
                      <span className="chip chip-quiet">{rate.tier}</span>
                    ) : (
                      <span className="text-ink-dim">One rate</span>
                    )}
                  </td>
                  {/* The number people came here for. A card at $0 is switched
                      off rather than unknown, so it is shown as money and the
                      dash is kept for genuinely missing values. */}
                  <td className="tnum px-3 py-3 text-right font-display text-[26px] font-semibold">
                    {rate.current === null ? (
                      <span className="text-ink-dim">{BLANK}</span>
                    ) : (
                      formatMoney(rate.current)
                    )}
                  </td>
                  <td className="tnum px-3 py-3 text-right text-[18px] text-ink-soft">
                    {rate.previous === null ? BLANK : formatMoney(rate.previous)}
                  </td>
                  <td className="tnum px-3 py-3 text-right text-[18px]">
                    {rate.change === null ? (
                      <span className="text-ink-dim">{BLANK}</span>
                    ) : (
                      <span className={rate.change < 0 ? 'text-alarm' : undefined}>
                        {rate.change > 0 ? '+' : ''}
                        {formatPercent(rate.change, 2)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-[18px] text-ink-soft">
                    {rate.changedOn ? formatDay(rate.changedOn) : BLANK}
                  </td>
                </tr>
              ))}
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
        label="Rates"
        note={matched.length === rows.length ? '' : ` · ${rows.length} in total`}
        className="mt-6"
      />
    </>
  );
}
