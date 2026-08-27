'use client';

import { useState } from 'react';
import { DeleteApproval } from '@/components/DeleteApproval';
import { Pager } from '@/components/Pager';
import { TableScroller } from '@/components/TableScroller';
import { formatDay, formatMoney, type ConversionView } from '@/lib/analytics';
import { PAGE_SIZES, pageSlice } from '@/lib/paging';

/**
 * The approvals behind the money, most recent first.
 *
 * It used to show the latest eight and stop. Eight is what you can read without
 * a control; with one, the honest window is much wider, so the page hands over
 * a proper slice of the history and this pages through it.
 *
 * `gross` says which figure arrived and therefore how many money columns there
 * are. An admin sees what the merchant paid and the affiliate's share of it
 * side by side. An affiliate's rows arrive already worked out, so there is one
 * column and it is simply the amount — a second column, or a heading calling it
 * a share, would be describing a figure they are not being shown.
 */
export function ApprovalsList({
  rows,
  canEdit,
  gross,
  empty,
  showPerson = true,
}: {
  rows: ConversionView[];
  canEdit: boolean;
  gross: boolean;
  /** What to say when there is nothing at all. Wording differs by who is reading. */
  empty: string;
  /**
   * Off on one person's own page, where the heading already names them and the
   * column would be their name repeated down the side of it.
   */
  showPerson?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0]);
  const visible = pageSlice(rows, page, perPage);

  if (rows.length === 0) return <p className="plain mt-6">{empty}</p>;

  /* Static strings: the class scanner reads this file rather than running it,
     so a width built by arithmetic is a width Tailwind never emits. */
  const minWidth =
    gross && showPerson
      ? 'min-w-[1000px]'
      : gross || showPerson
        ? 'min-w-[860px]'
        : 'min-w-[720px]';

  return (
    <>
      <TableScroller className="mt-5" label="Approvals">
        <table className={`w-full border-collapse text-left ${minWidth}`}>
          <thead>
            <tr className="bg-paper-card">
              <Th>Date</Th>
              {showPerson ? <Th>Person</Th> : null}
              <Th>Card</Th>
              {gross ? <Th align="right">Payout</Th> : null}
              <Th align="right">{gross ? 'Affiliate share' : 'Amount'}</Th>
              {canEdit ? <Th align="right">Actions</Th> : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="divider-row last:border-0">
                <td className="tnum whitespace-nowrap px-5 py-3.5 text-[13px] text-ink-soft">
                  {formatDay(row.approvedOn)}
                </td>

                {showPerson ? (
                  <td className="max-w-[180px] px-5 py-3.5">
                    <span className="block truncate text-[14px] font-medium">{row.person}</span>
                  </td>
                ) : null}

                <td className="max-w-[320px] px-5 py-3.5">
                  <span className="block truncate text-[14px] text-ink-soft" title={row.card}>
                    {row.card}
                  </span>
                  {/* Who the approval was for. A dash means the report row
                      carried no var3, or one that matches no lead here — so it
                      is drawn dimmer than a name, being the absence of one. */}
                  <span className="mt-0.5 block truncate text-[11px] text-ink-dim">
                    Client{' '}
                    <span className={row.client === '-' ? undefined : 'font-semibold text-ink-soft'}>
                      {row.client}
                    </span>
                    {row.note ? ` · ${row.note}` : ''}
                  </span>
                </td>

                {gross ? (
                  <td className="tnum px-5 py-3.5 text-right text-[14px] font-medium">
                    {formatMoney(row.amount)}
                  </td>
                ) : null}

                {/* Worked out on the server, at the commission rate in force on
                    the day this one was approved. Not a share of the figure to
                    its left: two rows in this table can have been earned under
                    two different rates. */}
                <td className="tnum px-5 py-3.5 text-right text-[14px] font-medium">
                  {formatMoney(row.affiliate)}
                </td>

                {/* py-2.5: the button is 30px and brings its own height, so the
                    same padding as the text cells would make this the tallest
                    cell in the row. */}
                {canEdit ? (
                  <td className="whitespace-nowrap px-5 py-2.5 text-right">
                    <DeleteApproval id={row.id} label={`${row.person} · ${row.card}`} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>

      <Pager
        total={rows.length}
        page={page}
        perPage={perPage}
        onPage={setPage}
        onPerPage={setPerPage}
        label="Approvals"
      />
    </>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`label-cap border-b border-edge px-5 py-2.5 text-[10px] ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}
