'use client';

import { useMemo, useState } from 'react';
import { CopyLink } from '@/components/CopyLink';
import { LinkActions } from '@/components/LinkActions';
import { Pager } from '@/components/Pager';
import { formatPercent, HOUSE_KEY, initialsOf } from '@/lib/analytics';
import { PAGE_SIZES, pageSlice } from '@/lib/paging';
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
  { key: 'leads', label: 'Most leads first' },
  { key: 'visits', label: 'Most visits first' },
  { key: 'newest', label: 'Newest first' },
  { key: 'name', label: 'A–Z' },
];

/**
 * `canEdit` drops the pause/edit/delete controls for an affiliate, who may see
 * their own links and copy them but not change where they point. Cosmetic only:
 * /api/links/[id] refuses them either way.
 */
export function LinksBrowser({
  rows,
  capture,
  canEdit = true,
}: {
  rows: LinkRow[];
  capture: boolean;
  canEdit?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [person, setPerson] = useState('');
  // With the capture form hidden there are no leads to sort by, and a sort that
  // ranks everything equally reads as broken.
  const [sort, setSort] = useState<Sort>(capture ? 'leads' : 'visits');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0]);

  const sorts = capture ? SORTS : SORTS.filter((option) => option.key !== 'leads');

  /**
   * Everyone with a link here, newest link first so a rename shows the name
   * they go by now. House links have no key of their own and answer to
   * HOUSE_KEY, the same stand-in the earnings pages use, because an empty
   * value already means "everyone" in this control.
   */
  const people = useMemo(() => {
    const labels = new Map<string, string>();
    for (const row of [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const key = row.usr || HOUSE_KEY;
      if (labels.has(key)) continue;
      labels.set(key, key === HOUSE_KEY ? 'House links' : row.assignee || row.usr);
    }
    return [...labels]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  /**
   * One person's links, or everyone's. Held apart from the search and the
   * status because the pills count within it: "All 42" over three visible
   * cards is the page insisting a filter is off while it is on.
   */
  const scoped = useMemo(
    () => (person ? rows.filter((row) => (row.usr || HOUSE_KEY) === person) : rows),
    [rows, person],
  );
  const liveCount = scoped.filter((r) => r.active).length;

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = scoped.filter((row) => {
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
  }, [scoped, query, status, sort]);

  const visible = pageSlice(matched, page, perPage);

  /*
   * Narrowing the list starts it again at page one. Without this, filtering
   * from four pages down to one leaves the reader on page 3 of 1 — pageSlice
   * clamps it back to something real, but the page they asked for is gone and
   * nobody told them.
   */
  function search(next: string) {
    setQuery(next);
    setPage(1);
  }
  function chooseStatus(next: StatusFilter) {
    setStatus(next);
    setPage(1);
  }
  function choosePerson(next: string) {
    setPerson(next);
    setPage(1);
  }
  function chooseSort(next: Sort) {
    setSort(next);
    setPage(1);
  }

  return (
    <>
      {/* Search + filters */}
      <div className="mt-7 flex flex-wrap items-center gap-4">
        {/* min-w keeps the search box from collapsing next to the filters, but
            has to stay under a 320px screen's content width or it becomes the
            thing that widens the page. */}
        <div className="min-w-[200px] flex-1">
          <label className="sr-only" htmlFor="link-search">
            Search links
          </label>
          <input
            id="link-search"
            type="search"
            value={query}
            onChange={(e) => search(e.target.value)}
            placeholder="Search a link, campaign or person…"
            className="field"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="pill-filter"
            aria-pressed={status === 'all'}
            data-active={status === 'all'}
            onClick={() => chooseStatus('all')}
          >
            All {scoped.length}
          </button>
          <button
            type="button"
            className="pill-filter"
            aria-pressed={status === 'live'}
            data-active={status === 'live'}
            onClick={() => chooseStatus('live')}
          >
            Live {liveCount}
          </button>
          <button
            type="button"
            className="pill-filter"
            aria-pressed={status === 'paused'}
            data-active={status === 'paused'}
            onClick={() => chooseStatus('paused')}
          >
            Paused {scoped.length - liveCount}
          </button>
          {/* Only worth drawing when there is more than one person to choose
              between: an affiliate sees their own links and nobody else's, so
              for them this would be a control with a single answer. */}
          {people.length > 1 ? (
            <>
              <label className="sr-only" htmlFor="link-person">
                Filter links by person
              </label>
              <select
                id="link-person"
                value={person}
                onChange={(e) => choosePerson(e.target.value)}
                className="field w-auto max-w-[240px] truncate"
                style={{
                  minHeight: '56px',
                  fontSize: '19px',
                  fontWeight: 600,
                  borderColor: 'var(--color-ink)',
                }}
              >
                <option value="">Everyone</option>
                {people.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <label className="sr-only" htmlFor="link-sort">
            Sort links
          </label>
          <select
            id="link-sort"
            value={sort}
            onChange={(e) => chooseSort(e.target.value as Sort)}
            className="field w-auto"
            style={{
              minHeight: '56px',
              fontSize: '19px',
              fontWeight: 600,
              borderColor: 'var(--color-ink)',
            }}
          >
            {sorts.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Rows */}
      {matched.length === 0 ? (
        <p className="mt-8 rounded-[20px] border-2 border-dashed border-edge-strong bg-panel px-6 py-16 text-center text-[20px] text-ink-soft">
          {rows.length === 0
            ? 'No links yet.'
            : `Nothing matches${query ? ` “${query}”` : ''} in this view.`}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-5">
          {visible.map((row, index) => (
            <li
              key={row.id}
              className="rise panel flex flex-col gap-5 p-6 sm:p-7"
              style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
            >
              {/* Who and what, then the numbers */}
              <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3.5">
                    <h2
                      className="min-w-0 truncate font-display text-[28px] sm:text-[32px]"
                      title={row.campaign || row.slug}
                    >
                      {row.campaign || row.slug}
                    </h2>
                    <span className={`chip ${row.active ? 'chip-live' : 'chip-quiet'}`}>
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 flex-none rounded-full"
                        style={{
                          background: row.active
                            ? 'var(--color-leaf-live)'
                            : 'var(--color-ink-dim)',
                        }}
                      />
                      {row.active ? 'Live' : 'Paused'}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <span aria-hidden className="disc h-10 w-10 text-[16px]">
                      {row.assignee ? initialsOf(row.assignee) : 'H'}
                    </span>
                    <span className="min-w-0 truncate text-[19px] text-ink-soft">
                      {row.assignee || 'House link'}
                      {row.createdAt ? ` · since ${shortDate(row.createdAt)}` : ''}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-10 gap-y-4">
                  <Metric label="Visits" value={row.visits.toLocaleString()} />
                  {capture ? (
                    <>
                      <Metric label="Leads" value={row.submissions.toLocaleString()} />
                      <Metric
                        label="Turned into leads"
                        value={
                          row.visits > 0 ? formatPercent(row.submissions / row.visits, 0) : 'None yet'
                        }
                      />
                    </>
                  ) : null}
                </div>
              </div>

              {/* The URL and everything you can do to it */}
              <div className="flex flex-wrap items-center gap-4 border-t-2 border-edge-faint pt-5">
                <CopyLink value={row.url} />
                <a
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-outline btn-sm"
                >
                  Preview ↗
                </a>
                <span className="hidden flex-1 lg:block" />
                {canEdit ? (
                  <LinkActions id={row.id} active={row.active} label={row.campaign || row.slug} />
                ) : null}
              </div>

              {/* A URL is one long unbreakable token; let it break anywhere
                  rather than push the card past the edge of a phone. */}
              <p className="text-[18px] text-ink-soft [overflow-wrap:anywhere]">
                Sends people to → {prettyUrl(row.destination, 68)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Pager
        total={matched.length}
        page={page}
        perPage={perPage}
        onPage={setPage}
        onPerPage={setPerPage}
        label="Links"
        /* The whole count stays on screen while a filter is on, so the number
           of links you have never depends on which filter you left running. */
        note={matched.length === rows.length ? '' : ` · ${rows.length} in total`}
        className="mt-6"
      />
    </>
  );
}

/* Note: this module is 'use client', so every runtime export becomes a client
   reference. Row building lives in the server page instead — a plain function
   exported from here would throw when called during the server render. */

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-right">
      <span className="label-cap block">{label}</span>
      <span className="tnum mt-1 block font-display text-[38px] font-semibold leading-tight">
        {value}
      </span>
    </span>
  );
}
