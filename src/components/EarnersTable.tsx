'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Pager } from '@/components/Pager';
import { TableScroller } from '@/components/TableScroller';
import {
  affiliateHref,
  affiliateRevenueOf,
  formatMoney,
  formatPercent,
  initialsOf,
  type EarningsRow,
  type EarningsView,
  type Period,
} from '@/lib/analytics';
import { PAGE_SIZES, pageSlice } from '@/lib/paging';

/**
 * One row per person: what came in, and what half of it is theirs.
 *
 * A client component only so it can page itself. Every figure in it is worked
 * out on the server and handed over whole, so there is no arithmetic here that
 * the totals below could disagree with.
 */
export function EarnersTable({
  rows,
  totals,
  period,
}: {
  rows: EarningsRow[];
  totals: EarningsView['totals'];
  period: Period;
}) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0]);
  const visible = pageSlice(rows, page, perPage);

  /*
   * Every row's own half added up, rather than half of the total. The two can
   * differ by a cent, and of the two answers this is the one the reader can
   * check: it is the sum of the column printed above it.
   */
  const affiliateRevenue =
    Math.round(rows.reduce((sum, row) => sum + affiliateRevenueOf(row.earnings), 0) * 100) / 100;

  return (
    <>
      <TableScroller className="mt-5" label="Who is earning">
        <table className="w-full min-w-[980px] border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-edge">
              <Th>Person</Th>
              <Th align="right">Visits</Th>
              <Th align="right">Approved</Th>
              <Th align="right">Amount</Th>
              <Th align="right">Affiliate revenue</Th>
              {/* Deliberately empty: every button in the column carries its
                  own "Open <person>" label, so a header here would only
                  repeat itself once per row. */}
              <th className="pb-3" />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.key} className="divider-row last:border-0">
                <td className="py-5 pr-4">
                  <div className="flex items-center gap-4.5">
                    <span aria-hidden className="disc h-14 w-14 text-[19px]">
                      {row.usr ? initialsOf(row.person) : 'H'}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[23px] font-semibold">{row.person}</span>
                      <span className="mt-1 block truncate text-[18px] text-ink-soft">
                        {row.cardCount} card{row.cardCount === 1 ? '' : 's'}
                        {row.usr ? ` · usr=${row.usr}` : ' · no usr'}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="tnum py-5 pr-4 text-right text-[28px] font-semibold">
                  {row.visits.toLocaleString()}
                </td>
                <td className="py-5 pr-4 text-right">
                  <span className="tnum block text-[28px] font-semibold">{row.approved}</span>
                  {row.visits > 0 && row.approved > 0 ? (
                    <span className="mt-0.5 block text-[17px] text-ink-soft">
                      {formatPercent(row.approvalRate, 1)} of visits
                    </span>
                  ) : null}
                </td>
                <td className="tnum py-5 pr-4 text-right font-display text-[30px] font-semibold">
                  {formatMoney(row.earnings)}
                </td>
                <td className="tnum py-5 pr-4 text-right font-display text-[30px] font-semibold">
                  {formatMoney(affiliateRevenueOf(row.earnings))}
                </td>
                <td className="py-5 text-right">
                  {/* One link per row rather than a whole-row target: the
                      thing you can click is then something you can see. */}
                  <Link
                    href={affiliateHref(row.usr, period)}
                    className="btn-outline btn-sm"
                    aria-label={`Open ${row.person}`}
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-edge-strong">
              <td className="py-5 text-[21px] font-bold">
                Total
                {/* The footer has always been the whole window, and now that the
                    rows above it are one page of it, that has to be said out
                    loud or it reads as a broken sum. */}
                {rows.length > visible.length ? (
                  <span className="mt-1 block text-[17px] font-normal text-ink-soft">
                    everyone, not just this page
                  </span>
                ) : null}
              </td>
              <td className="tnum py-5 pr-4 text-right text-[26px] font-semibold">
                {totals.visits.toLocaleString()}
              </td>
              <td className="tnum py-5 pr-4 text-right text-[26px] font-semibold">
                {totals.approved.toLocaleString()}
              </td>
              <td className="py-5 pr-4 text-right">
                <span className="mark tnum font-display text-[30px] font-bold">
                  {formatMoney(totals.earnings)}
                </span>
              </td>
              <td className="tnum py-5 pr-4 text-right font-display text-[30px] font-bold">
                {formatMoney(affiliateRevenue)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </TableScroller>

      <Pager
        total={rows.length}
        page={page}
        perPage={perPage}
        onPage={setPage}
        onPerPage={setPerPage}
        label="People"
      />
    </>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`label-cap pb-3 pr-4 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}
