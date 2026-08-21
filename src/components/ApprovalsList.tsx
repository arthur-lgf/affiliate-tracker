'use client';

import { useState } from 'react';
import { DeleteApproval } from '@/components/DeleteApproval';
import { Pager } from '@/components/Pager';
import { formatDay, formatMoney, type ConversionView } from '@/lib/analytics';
import { PAGE_SIZES, pageSlice } from '@/lib/paging';

/**
 * The approvals behind the money, most recent first.
 *
 * It used to show the latest eight and stop. Eight is what you can read without
 * a control; with one, the honest window is much wider, so the page hands over
 * a proper slice of the history and this pages through it.
 */
export function ApprovalsList({
  rows,
  canEdit,
  empty,
}: {
  rows: ConversionView[];
  canEdit: boolean;
  /** What to say when there is nothing at all. Wording differs by who is reading. */
  empty: string;
}) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0]);
  const visible = pageSlice(rows, page, perPage);

  if (rows.length === 0) return <p className="plain mt-6">{empty}</p>;

  return (
    <>
      <ul className="mt-6 flex flex-col gap-4">
        {visible.map((row) => (
          <li
            key={row.id}
            className="card-row-lit flex flex-wrap items-center gap-x-6 gap-y-4 p-5 sm:px-6"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{row.person}</span>
              <span className="mt-0.5 block truncate text-[12px] text-ink-soft">
                {row.card} ·{' '}
                <span className={row.client === '-' ? 'text-ink-dim' : undefined}>
                  {row.client}
                </span>
                {row.note ? ` · ${row.note}` : ''}
              </span>
            </span>
            <span className="text-[13px] text-ink-soft">{formatDay(row.approvedOn)}</span>
            <span className="tnum min-w-[110px] text-right text-[16px] font-semibold">
              {formatMoney(row.amount)}
            </span>
            {canEdit ? <DeleteApproval id={row.id} label={`${row.person} · ${row.card}`} /> : null}
          </li>
        ))}
      </ul>

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
