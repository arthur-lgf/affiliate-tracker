'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Pager } from './Pager';
import { Spinner } from './Spinner';
import { TableScroller } from './TableScroller';
import { isLeadId } from '@/lib/lead-id';
import { PAGE_SIZES, pageSlice } from '@/lib/paging';
import { displayStatus, statusLabel } from '@/lib/status';
import type { LeadStatus } from '@/lib/types';

/**
 * One captured lead, as the dashboard needs it.
 *
 * `age` and `capturedAt` arrive pre-formatted from the server. Formatting a
 * relative time in the browser instead would produce a different string a
 * second after the server produced it, which React reports as a hydration
 * mismatch. The IP and user agent are logged but deliberately never sent here.
 */
export type LeadRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  campaign: string;
  slug: string;
  assignee: string;
  /** As stored. What is shown may be stronger — see `hasApproval`. */
  status: LeadStatus;
  /**
   * Whether an approval names this lead. Passed in rather than worked out here
   * because the approvals live on the server beside the leads, and shipping
   * them to the browser a second time to re-derive one boolean per row would be
   * the same answer at ten times the weight.
   */
  hasApproval: boolean;
  age: string;
  capturedAt: string;
};

/** Keyed by the stored word; `statusLabel` decides what it is called on screen. */
type Filter = 'all' | 'pending' | 'registered';

/**
 * The leads, one to a row.
 *
 * A table rather than a stack of cards because of what a reader does with this
 * list: run down the status column to see what is still pending, or down the
 * owner column to see whose links are producing. Both are comparisons between
 * rows, and a card puts every field of one lead close together at the cost of
 * putting the same field of two leads far apart.
 *
 * `canEdit` hides the status toggle for an affiliate, who may read their own
 * leads but not change them. It is presentation only — /api/leads/[id] refuses
 * them regardless, and has to, because nothing stops someone calling it
 * directly.
 *
 * The wording is overridable because this panel appears in two places that mean
 * different things by it: everyone's leads on the dashboard, and one person's
 * on their own page. Same rows, same controls, different sentence — which is
 * much better than a second copy of the list that can drift from this one.
 */
export function LeadsPanel({
  rows,
  total,
  canEdit = true,
  title = 'Latest submissions',
  summary,
  emptyBody = 'No leads captured yet. Share a link and they will appear here.',
  showAssignee = true,
}: {
  rows: LeadRow[];
  total: number;
  canEdit?: boolean;
  title?: string;
  /** Replaces the count line under the heading. */
  summary?: string;
  emptyBody?: string;
  /**
   * Off when every row belongs to the same person and the heading already says
   * who — their name down the side of their own page is six copies of a fact
   * the reader arrived with.
   */
  showAssignee?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  /**
   * Statuses this session has changed, applied over whatever the server last
   * sent. The toggle flips instantly and the row is re-rendered from the server
   * a moment later; without this the pill would sit on its old value for the
   * whole round trip to the spreadsheet, which is not fast.
   */
  const [changed, setChanged] = useState<Record<string, LeadStatus>>({});

  const withStatus = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        // The approval wins over both the stored status and an optimistic
        // toggle, so the counts, the filter and the pill all read the same
        // thing the approvals panel does.
        status: displayStatus(changed[row.id] ?? row.status, row.hasApproval),
      })),
    [rows, changed],
  );

  const registeredCount = withStatus.filter((row) => row.status === 'registered').length;
  /** How many of those are approved because an approval says so, not by hand. */
  const fromApprovals = withStatus.filter((row) => row.hasApproval).length;
  const counts = {
    all: withStatus.length,
    registered: registeredCount,
    pending: withStatus.length - registeredCount,
  };

  const matching = withStatus.filter((row) => filter === 'all' || row.status === filter);
  const visible = pageSlice(matching, page, perPage);

  /*
   * A reference column only when there are references to put in it. Leads
   * captured before references existed carry a uuid that never travelled
   * anywhere, and a column of dashes invites a search that cannot succeed.
   * Read off the whole list rather than the page, so the table does not gain
   * and lose a column as you page through it.
   */
  const showRef = rows.some((row) => isLeadId(row.id));

  /* Static strings, because the class scanner reads this file rather than
     running it: a width built by arithmetic is a width Tailwind never emits. */
  const minWidth =
    showAssignee && showRef
      ? 'min-w-[1080px]'
      : showAssignee || showRef
        ? 'min-w-[940px]'
        : 'min-w-[800px]';

  /** A different set of leads is a different first page, not page 4 of it. */
  function choose(next: Filter) {
    setFilter(next);
    setPage(1);
  }

  async function setStatus(row: LeadRow, next: LeadStatus) {
    setBusyId(row.id);
    setError(null);
    setChanged((prev) => ({ ...prev, [row.id]: next }));
    try {
      const res = await fetch(`/api/leads/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Request failed (${res.status})`);
      }
      setAnnouncement(`${row.fullName || row.email} marked ${statusLabel(next).toLowerCase()}.`);
      startTransition(() => router.refresh());
    } catch (err) {
      // Put the pill back where it was — the sheet did not change.
      setChanged((prev) => {
        const rest = { ...prev };
        delete rest[row.id];
        return rest;
      });
      setError(err instanceof Error ? err.message : 'Could not update that lead');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rise panel mt-5 p-6 sm:p-8">
      {/* Heading, what you are looking at, and the one control — the same shape
          as the Approvals panel above it on the dashboard. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div>
          <h2 className="font-display text-[18px]">{title}</h2>
          <p className="plain mt-1">
            {summary ??
              (total > rows.length
                ? `Latest ${rows.length} of ${total.toLocaleString()}. Older leads live in your sheet.`
                : `${total.toLocaleString()} in total.`)}
          </p>
        </div>

        {rows.length > 0 ? (
          <>
            <label className="sr-only" htmlFor="lead-status">
              Filter leads by status
            </label>
            {/* The counts ride on the options rather than sitting beside them:
                the three of them are the whole funnel, and they are read at the
                moment you go looking for one of the three. */}
            <select
              id="lead-status"
              value={filter}
              onChange={(e) => choose(e.target.value as Filter)}
              className="field w-auto"
            >
              {(['all', 'pending', 'registered'] as const).map((key) => (
                <option key={key} value={key}>
                  {key === 'all' ? 'All' : statusLabel(key)} {counts[key]}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="py-12 text-center text-[13px] text-ink-soft">{emptyBody}</p>
      ) : (
        <>
          {/* Instructions for a control this reader does not have are worse
              than no instructions, so an affiliate gets the reading of the
              statuses instead of the recipe for changing them. */}
          <p className="plain mt-3">
            {canEdit ? (
              <>
                Every lead starts <strong>pending</strong>. Mark one approved once they have signed
                up, either here or in column N of the sheet.
              </>
            ) : (
              <>
                Every lead starts <strong>pending</strong> and is marked approved once they have
                signed up.
              </>
            )}{' '}
            {/* Said only when it applies. An explanation of something that is
                not happening on this list is one more line to read past. */}
            {fromApprovals > 0 ? (
              <>
                {fromApprovals === 1 ? 'One of them reads' : `${fromApprovals} of them read`}{' '}
                approved because there is an approval on file, which is the merchant confirming it
                went through. Removing the approval is what changes that back.
              </>
            ) : null}
          </p>

          {error ? (
            <p role="alert" className="field-error">
              {error}
            </p>
          ) : null}

          {matching.length === 0 ? (
            <p className="py-12 text-center text-[13px] text-ink-soft">
              No {filter === 'registered' ? 'approved' : filter} leads in this list.
            </p>
          ) : (
            <TableScroller className="mt-5" label="Captured leads">
              <table className={`w-full border-collapse text-left ${minWidth}`}>
                <thead>
                  <tr className="bg-paper-card">
                    <Th>Lead</Th>
                    <Th>Contact</Th>
                    <Th>Campaign</Th>
                    {showAssignee ? <Th>Owner</Th> : null}
                    {showRef ? <Th>Ref</Th> : null}
                    <Th>Status</Th>
                    <Th align="right">Captured</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id} className="divider-row last:border-0">
                      <td className="max-w-[200px] px-5 py-3.5">
                        <span className="block truncate text-[14px] font-medium">
                          {row.fullName || <span className="text-ink-dim">No name given</span>}
                        </span>
                      </td>

                      {/* Both of these are the point of capturing a lead, so
                          both are one click from here rather than one click
                          plus a selection. */}
                      <td className="max-w-[240px] px-5 py-3.5">
                        <a
                          href={`mailto:${row.email}`}
                          className="tnum block truncate text-[12px] text-link hover:underline"
                          title={row.email}
                        >
                          {row.email}
                        </a>
                        {row.phone ? (
                          <a
                            href={`tel:${row.phone.replace(/[^\d+]/g, '')}`}
                            className="tnum mt-0.5 block truncate text-[11px] text-ink-dim hover:underline"
                          >
                            {row.phone}
                          </a>
                        ) : null}
                      </td>

                      <td className="max-w-[200px] px-5 py-3.5">
                        <span
                          className="block truncate text-[14px] text-ink-soft"
                          title={row.campaign || row.slug}
                        >
                          {row.campaign || row.slug}
                        </span>
                      </td>

                      {showAssignee ? (
                        <td className="max-w-[160px] px-5 py-3.5">
                          <span className="block truncate text-[14px] text-ink-soft">
                            {row.assignee || 'Unassigned'}
                          </span>
                        </td>
                      ) : null}

                      {/* The value this lead was forwarded to the merchant
                          with. It is what turns up in the report's var3
                          column, so it is the thing to search for when an
                          approval needs tracing back to a person. */}
                      {showRef ? (
                        <td className="tnum px-5 py-3.5 text-[12px] text-ink-dim">
                          {isLeadId(row.id) ? row.id : '—'}
                        </td>
                      ) : null}

                      {/* py-2.5: the pill is 30px and brings its own height, so
                          the same padding as the text cells would make this the
                          tallest cell in the row. */}
                      <td className="px-5 py-2.5">
                        {/* No toggle where an approval decides it: pressing it
                            would write a status the next render overrules,
                            which is a control that lies about what it does. */}
                        {canEdit && !row.hasApproval ? (
                          <StatusToggle
                            row={row}
                            busy={busyId === row.id}
                            onToggle={() =>
                              setStatus(row, row.status === 'registered' ? 'pending' : 'registered')
                            }
                          />
                        ) : (
                          <StatusPill row={row} />
                        )}
                      </td>

                      {/* No .tnum here, unlike every other narrow column: "4
                          hrs ago" is a phrase, not a figure, and monospacing it
                          spaces the words out like a countdown. The exact
                          timestamp is on the title. */}
                      <td
                        className="whitespace-nowrap px-5 py-3.5 text-right text-[13px] text-ink-dim"
                        title={row.capturedAt}
                      >
                        {row.age}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroller>
          )}

          {/* The line above already says the filter found nothing, and
              says it better than a count of zero would. */}
          {matching.length > 0 ? (
            <Pager
              total={matching.length}
              page={page}
              perPage={perPage}
              onPage={setPage}
              onPerPage={setPerPage}
              label="Leads"
            />
          ) : null}

          <p role="status" aria-live="polite" className="sr-only left-0">
            {announcement}
          </p>
        </>
      )}
    </section>
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

/**
 * The same pill with nothing to press. Not a disabled button: a disabled
 * control reads as "temporarily unavailable, try again", when the truth is that
 * this is simply not yours to change.
 */
function StatusPill({ row }: { row: LeadRow }) {
  const registered = row.status === 'registered';
  return (
    <span
      className="pill-status"
      data-status={row.status}
      title={row.hasApproval ? 'An approval is recorded against this lead.' : undefined}
    >
      <span
        aria-hidden
        className="h-2.5 w-2.5 flex-none rounded-full"
        style={{ background: registered ? 'var(--color-leaf-live)' : 'var(--color-ink-dim)' }}
      />
      {statusLabel(row.status)}
    </span>
  );
}

function StatusToggle({
  row,
  busy,
  onToggle,
}: {
  row: LeadRow;
  busy: boolean;
  onToggle: () => void;
}) {
  const registered = row.status === 'registered';
  const who = row.fullName || row.email || 'this lead';
  return (
    <button
      type="button"
      className="pill-status"
      data-status={row.status}
      disabled={busy}
      aria-busy={busy}
      onClick={onToggle}
      /* The visible word starts the accessible name so "click Pending" still
         works for voice control, and the rest says what clicking will do. */
      aria-label={`${statusLabel(row.status)}, mark ${who} as ${statusLabel(
        registered ? 'pending' : 'registered',
      ).toLowerCase()}`}
    >
      {/* The status dot becomes the spinner while the change is in flight.
          Same spot, same size, so the pill does not resize under the cursor
          and the thing that is changing is the thing that shows it. */}
      {busy ? (
        <Spinner className="h-2.5 w-2.5 border-[2px]" />
      ) : (
        <span
          aria-hidden
          className="h-2.5 w-2.5 flex-none rounded-full"
          style={{
            background: registered ? 'var(--color-leaf-live)' : 'var(--color-ink-dim)',
          }}
        />
      )}
      {statusLabel(row.status)}
    </button>
  );
}
