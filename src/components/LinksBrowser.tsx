'use client';

import { useMemo, useState } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { LinkActions } from '@/components/LinkActions';
import { Pager } from '@/components/Pager';
import { TableScroller } from '@/components/TableScroller';
import { formatPercent, HOUSE_KEY } from '@/lib/analytics';
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
 * Every link as one row of a table.
 *
 * These were cards until the redesign, one panel per link, and a card is the
 * right shape for something you read on its own. A link is not read on its own:
 * the question is nearly always which of them is working, which means comparing
 * a column of visits down its right edge. Fourteen links as cards is a page you
 * scroll; as rows it is a page you scan.
 *
 * `canEdit` drops the pause/delete controls for an affiliate, who may see their
 * own links and copy them but not change where they point. Copy stays for
 * everyone — it is the whole reason an affiliate opens this page. Cosmetic
 * only: /api/links/[id] refuses them either way.
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
   * status because the status counts count within it: "All 42" over three
   * visible rows is the page insisting a filter is off while it is on.
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

  /* Two columns come and go with the capture form, and the table has to be
     wide enough for the ones that are actually there. A fixed minimum sized
     for eight columns would put a scrollbar under a six-column table. */
  const minWidth = capture ? 'min-w-[1080px]' : 'min-w-[860px]';

  return (
    <div className="panel mt-6 overflow-hidden">
      {/* The toolbar, banded off from the rows it filters. Everything in it is
          36px and in a line, so which control is which is a matter of reading
          the words rather than of telling two shapes apart. */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-edge px-5 py-3.5">
        <div className="min-w-[180px] flex-1">
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

        {/*
          Three pills became one select in the redesign. The counts came with
          them: they are the reason to touch this control at all, and a filter
          that hides how much it is hiding is a filter you forget is on.
        */}
        <label className="sr-only" htmlFor="link-status">
          Filter links by status
        </label>
        <select
          id="link-status"
          value={status}
          onChange={(e) => chooseStatus(e.target.value as StatusFilter)}
          className="field w-auto"
        >
          <option value="all">All {scoped.length}</option>
          <option value="live">Live {liveCount}</option>
          <option value="paused">Paused {scoped.length - liveCount}</option>
        </select>

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
              className="field w-auto max-w-[200px] truncate"
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
        >
          {sorts.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {matched.length === 0 ? (
        <p className="px-5 py-16 text-center text-[13px] text-ink-soft">
          {rows.length === 0
            ? 'No links yet.'
            : `Nothing matches${query ? ` “${query}”` : ''} in this view.`}
        </p>
      ) : (
        /* No margin of its own: the panel already draws the edge above these
           rows. The scroll buttons TableScroller adds when the table is wider
           than its window get the panel inset passed to them, or they would sit
           flush against a border that has no padding to give them. */
        <TableScroller label="Affiliate links" controlsClassName="px-5 pt-3">
          <table className={`w-full border-collapse text-left ${minWidth}`}>
            <thead>
              <tr className="bg-paper-card">
                <Th>Campaign</Th>
                <Th>Owner</Th>
                <Th>Short link</Th>
                <Th>Status</Th>
                <Th align="right">Visits</Th>
                {capture ? (
                  <>
                    <Th align="right">Leads</Th>
                    <Th align="right">Conversion</Th>
                  </>
                ) : null}
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="divider-row last:border-0">
                  <td className="max-w-[220px] px-5 py-3.5">
                    <span
                      className="block truncate text-[14px] font-medium"
                      title={row.campaign || row.slug}
                    >
                      {row.campaign || row.slug}
                    </span>
                  </td>

                  <td className="max-w-[180px] px-5 py-3.5">
                    <span className="block truncate text-[14px] text-ink-soft">
                      {row.assignee || 'House link'}
                    </span>
                    {row.createdAt ? (
                      <span className="mt-0.5 block text-[11px] text-ink-dim">
                        since {shortDate(row.createdAt)}
                      </span>
                    ) : null}
                  </td>

                  {/*
                    The short link is the thing this page exists to hand over,
                    so it is also the preview: clicking it opens the landing
                    page in a new tab, which is what the separate Preview button
                    used to do. Underneath it, dimmer, is where that link
                    forwards to — the one fact that tells you a link is pointing
                    at the wrong offer, and the only reason to keep a second
                    line in this cell.
                  */}
                  <td className="max-w-[320px] px-5 py-3.5">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tnum block truncate text-[12px] text-link hover:underline"
                      title={row.url}
                    >
                      {prettyUrl(row.url, 999)}
                    </a>
                    <span
                      className="tnum mt-0.5 block truncate text-[11px] text-ink-dim"
                      title={row.destination}
                    >
                      → {prettyUrl(row.destination, 999)}
                    </span>
                  </td>

                  <td className="px-5 py-3.5">
                    <span className={`chip ${row.active ? 'chip-live' : 'chip-quiet'}`}>
                      {row.active ? 'Live' : 'Paused'}
                    </span>
                  </td>

                  <td className="tnum px-5 py-3.5 text-right text-[14px]">
                    {row.visits.toLocaleString()}
                  </td>

                  {capture ? (
                    <>
                      <td className="tnum px-5 py-3.5 text-right text-[14px]">
                        {row.submissions.toLocaleString()}
                      </td>
                      <td className="tnum px-5 py-3.5 text-right text-[13px] text-ink-dim">
                        {row.visits > 0 ? formatPercent(row.submissions / row.visits, 0) : 'No visits'}
                      </td>
                    </>
                  ) : null}

                  {/* py-2.5 rather than py-3.5: the buttons are 30px and bring
                      their own height, so the same padding would make this the
                      tallest cell in the row and set the row height off it. */}
                  <td className="whitespace-nowrap px-5 py-2.5 text-right">
                    <span className="inline-flex justify-end gap-1.5">
                      <CopyButton value={row.url} label={`Copy the link for ${row.campaign || row.slug}`} />
                      {canEdit ? (
                        <LinkActions
                          id={row.id}
                          active={row.active}
                          label={row.campaign || row.slug}
                        />
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}

      {/* The footer band. Inside the panel and against its bottom edge, so the
          count belongs to this table rather than floating under the page. */}
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
        className="border-t border-edge px-5 py-3"
      />
    </div>
  );
}

/* Note: this module is 'use client', so every runtime export becomes a client
   reference. Row building lives in the server page instead — a plain function
   exported from here would throw when called during the server render. */

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
