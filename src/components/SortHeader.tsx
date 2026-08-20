'use client';

import type { SortDirection } from '@/lib/report-table';

export type SortState = { key: string; direction: SortDirection } | null;

/**
 * A column heading you can sort by.
 *
 * The whole heading is the button, so the target is the width of the column
 * rather than the width of the word.
 *
 * The arrow is always rendered, dimmed when the column is not the one in play,
 * so the heading row does not reflow when a sort is applied.
 */
export function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  right,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  right: boolean;
}) {
  const active = sort?.key === sortKey;
  const direction = active ? sort.direction : null;

  return (
    <th
      scope="col"
      className="whitespace-nowrap p-0 pb-3"
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`label-cap flex w-full items-center gap-1.5 rounded-lg px-3 py-1 hover:text-ink ${
          right ? 'justify-end' : 'justify-start'
        }`}
        title={
          direction === 'asc'
            ? `Sorted by ${label}, lowest first. Click for highest first.`
            : direction === 'desc'
              ? `Sorted by ${label}, highest first. Click to clear.`
              : `Sort by ${label}`
        }
      >
        {label}
        <span aria-hidden className={active ? 'text-ink' : 'text-ink-dim'}>
          {direction === 'desc' ? '↓' : '↑'}
        </span>
      </button>
    </th>
  );
}

/**
 * Ascending, then descending, then back to the order the data arrived in.
 *
 * The third state matters on a report: the order the source wrote the rows in
 * is itself information, and once a column has been sorted there is otherwise
 * no way back to it short of reloading.
 */
export function nextSort(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}
