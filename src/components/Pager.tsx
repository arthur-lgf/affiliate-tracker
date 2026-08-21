'use client';

import { PAGE_SIZES, pageBounds } from '@/lib/paging';

/**
 * The bar under a list: what you are looking at, and how to move through it.
 *
 * Shared rather than written per screen, because the three lists that have one
 * are read by the same people on the same day — a Next button that sits on the
 * left here and the right there is a small tax paid every single time.
 *
 * The controls hide themselves when the list is shorter than the smallest page
 * size. There is no page to turn and no size worth choosing at that point, so
 * what is left is the one useful half: the count.
 */
export function Pager({
  total,
  page,
  perPage,
  onPage,
  onPerPage,
  label = 'Rows',
  note = '',
  className = 'mt-5',
}: {
  /** How many items are in the list being paged, after any filtering. */
  total: number;
  page: number;
  perPage: number;
  onPage: (page: number) => void;
  onPerPage: (perPage: number) => void;
  /** The word beside the size picker: Rows, Links, Accounts. */
  label?: string;
  /** Anything the caller wants to add to the count, e.g. ", sorted". */
  note?: string;
  className?: string;
}) {
  const bounds = pageBounds(total, page, perPage);
  const paged = total > PAGE_SIZES[0];

  const count =
    total === 0
      ? 'Nothing to show'
      : paged
        ? `Showing ${bounds.from.toLocaleString()}–${bounds.to.toLocaleString()} of ${total.toLocaleString()}`
        : `Showing all ${total.toLocaleString()}`;

  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-4 ${className}`}>
      <span className="text-[13px] text-ink-soft" role="status">
        {count}
        {note}
      </span>

      {paged ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2.5 text-[12px] text-ink-soft">
            {label}
            {/* 30px, to sit level with the Previous/Next buttons beside it
                rather than setting the height of the whole bar. */}
            <select
              className="field w-auto min-h-[30px] px-2 text-[12px]"
              value={perPage}
              onChange={(event) => {
                // Back to the first page here rather than in every caller: a new
                // size renumbers every page, so page 7 of the old size is not a
                // place that still exists.
                onPerPage(Number(event.target.value));
                onPage(1);
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-quiet btn-sm"
            onClick={() => onPage(bounds.current - 1)}
            disabled={bounds.current <= 1}
          >
            ← Previous
          </button>
          <span className="tnum text-[12px] font-semibold">
            Page {bounds.current} of {bounds.pages}
          </span>
          <button
            type="button"
            className="btn-quiet btn-sm"
            onClick={() => onPage(bounds.current + 1)}
            disabled={bounds.current >= bounds.pages}
          >
            Next →
          </button>
        </div>
      ) : null}
    </div>
  );
}
