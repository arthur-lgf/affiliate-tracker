'use client';

import { useMemo, useState } from 'react';
import { CopyLink } from '@/components/CopyLink';
import { LinkActions } from '@/components/LinkActions';
import { formatPercent, initialsOf } from '@/lib/analytics';
import type { AffiliateLink } from '@/lib/types';
import { prettyUrl } from '@/lib/url';

export type LinkRow = AffiliateLink & {
  visits: number;
  submissions: number;
  url: string;
};

type StatusFilter = 'all' | 'live' | 'paused';
type Sort = 'leads' | 'visits' | 'newest' | 'name';

/** "4 Aug" — UTC to match every other date in the app. */
function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const SORTS: { key: Sort; label: string }[] = [
  { key: 'leads', label: 'Most leads' },
  { key: 'visits', label: 'Most visits' },
  { key: 'newest', label: 'Newest' },
  { key: 'name', label: 'A–Z' },
];

export function LinksBrowser({ rows }: { rows: LinkRow[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<Sort>('leads');

  const liveCount = rows.filter((r) => r.active).length;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (status === 'live' && !row.active) return false;
      if (status === 'paused' && row.active) return false;
      if (!needle) return true;
      // Search the things you would actually remember: the slug, the campaign,
      // the person, and the destination.
      return [row.slug, row.campaign, row.assignee, row.usr, row.destination, row.notes]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'visits':
          return b.visits - a.visits || b.submissions - a.submissions;
        case 'newest':
          return b.createdAt.localeCompare(a.createdAt);
        case 'name':
          return (a.campaign || a.slug).localeCompare(b.campaign || b.slug);
        default:
          return b.submissions - a.submissions || b.visits - a.visits;
      }
    });
    return sorted;
  }, [rows, query, status, sort]);

  return (
    <>
      {/* Search + filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a slug, campaign or person…"
          aria-label="Search links"
          className="min-w-[220px] flex-1 rounded-full border border-pine-700 bg-pine-850 px-[18px] py-3 text-[13px] text-cream outline-none transition-colors placeholder:text-sage-dim focus:border-mustard"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="pill-action"
            aria-pressed={status === 'all'}
            data-active={status === 'all'}
            onClick={() => setStatus('all')}
          >
            All {rows.length}
          </button>
          <button
            type="button"
            className="pill-action"
            aria-pressed={status === 'live'}
            data-active={status === 'live'}
            onClick={() => setStatus('live')}
          >
            Live {liveCount}
          </button>
          <button
            type="button"
            className="pill-action"
            aria-pressed={status === 'paused'}
            data-active={status === 'paused'}
            onClick={() => setStatus('paused')}
          >
            Paused {rows.length - liveCount}
          </button>
          <label className="sr-only" htmlFor="link-sort">
            Sort links
          </label>
          <select
            id="link-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="cursor-pointer rounded-full border border-pine-700 bg-transparent px-3.5 py-2 text-[11.5px] font-medium text-sage transition-colors hover:bg-pine-850 hover:text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-mustard)]"
          >
            {SORTS.map((option) => (
              <option key={option.key} value={option.key} className="bg-pine-850 text-cream">
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Rows */}
      {visible.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-pine-700 px-6 py-14 text-center text-sm text-sage-dim">
          {rows.length === 0
            ? 'No links yet.'
            : `Nothing matches${query ? ` “${query}”` : ''} in this view.`}
        </p>
      ) : (
        <ul className="mt-[18px] flex flex-col gap-2.5">
          {visible.map((row, index) => (
            <li
              key={row.id}
              className="rise row-card grid gap-x-6 gap-y-4 px-[22px] py-4 lg:grid-cols-[minmax(0,1.5fr)_170px_215px_150px] lg:items-center"
              style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
            >
              {/* Campaign + shareable URL. Preview lives here, beside Copy —
                  both act on the same URL. */}
              <div className="min-w-0">
                <p className="truncate text-[14.5px] font-medium" title={row.campaign || row.slug}>
                  {row.campaign || row.slug}
                </p>
                <div className="mt-2.5 flex max-w-full flex-wrap items-center gap-2">
                  <CopyLink value={row.url} />
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-none rounded-full border border-pine-700 px-3 py-1.5 text-[11px] font-medium text-sage transition-colors hover:border-mustard hover:text-mustard"
                  >
                    Preview ↗
                  </a>
                </div>
                <p className="mt-2 truncate text-[11px] text-sage-dim">
                  → {prettyUrl(row.destination, 54)}
                </p>
              </div>

              {/* Person */}
              <div className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden className="disc h-[30px] w-[30px] text-[10.5px]">
                  {row.assignee ? initialsOf(row.assignee) : '—'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px]">
                    {row.assignee || <span className="text-sage-dim">House link</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-sage-dim">
                    {row.usr ? `usr=${row.usr}` : 'no usr'}
                    {row.createdAt ? ` · since ${shortDate(row.createdAt)}` : ''}
                  </span>
                </span>
              </div>

              {/* Numbers */}
              <div className="flex gap-6">
                <Metric label="Visits" value={row.visits.toLocaleString()} />
                <Metric label="Leads" value={row.submissions.toLocaleString()} accent />
                <Metric
                  label="Conv."
                  value={row.visits > 0 ? formatPercent(row.submissions / row.visits, 0) : '—'}
                />
              </div>

              {/* Status + actions */}
              <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                <span className="pill bg-pine-800 px-3 py-1.5 font-normal text-[#d7cfbb]">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background: row.active ? 'var(--color-moss)' : 'var(--color-sage-dim)',
                    }}
                  />
                  {row.active ? 'Live' : 'Paused'}
                </span>
                <LinkActions id={row.id} active={row.active} label={row.campaign || row.slug} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <p role="status" aria-live="polite" className="mt-5 text-[12.5px] text-sage-dim">
        Showing {visible.length} of {rows.length}
      </p>
    </>
  );
}

/* Note: this module is 'use client', so every runtime export becomes a client
   reference. Row building lives in the server page instead — a plain function
   exported from here would throw when called during the server render. */

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <span>
      <span
        className="block text-[10px] font-medium uppercase tracking-[0.13em] text-sage-dim"
      >
        {label}
      </span>
      <span
        className="tnum mt-1 block font-display text-xl"
        style={accent ? { color: 'var(--color-mustard)' } : undefined}
      >
        {value}
      </span>
    </span>
  );
}
