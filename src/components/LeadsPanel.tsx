'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Pager } from './Pager';
import { Spinner } from './Spinner';
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
 * `canEdit` hides the status toggle for an affiliate, who may read their own
 * leads but not change them. It is presentation only — /api/leads/[id] refuses
 * them regardless, and has to, because nothing stops someone calling it
 * directly.
 *
 * The wording is overridable because this panel now appears in two places that
 * mean different things by it: everyone's leads on the dashboard, and one
 * person's on their own page. Same rows, same controls, different sentence —
 * which is much better than a second copy of the list that can drift from this
 * one.
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
  /** Replaces the count line on the right of the heading. */
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
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
        <h2 className="font-display text-[32px]">{title}</h2>
        <span className="text-[19px] text-ink-soft">
          {summary ??
            (total > rows.length
              ? `Latest ${rows.length} of ${total.toLocaleString()}. Older leads live in your sheet`
              : `${total.toLocaleString()} in total`)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-12 text-center text-[19px] text-ink-soft">{emptyBody}</p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {(['all', 'pending', 'registered'] as const).map((key) => (
              <button
                key={key}
                type="button"
                className="pill-filter"
                aria-pressed={filter === key}
                data-active={filter === key}
                onClick={() => choose(key)}
              >
                {key === 'all' ? 'All' : statusLabel(key)} {counts[key]}
              </button>
            ))}
          </div>
          {/* Instructions for a control this reader does not have are worse
              than no instructions, so an affiliate gets the reading of the
              pills instead of the recipe for changing them. */}
          {canEdit ? (
            <p className="plain mt-3">
              Every lead starts <strong>pending</strong>. Mark one approved once they have signed up,
              either here or in column N of the sheet.
            </p>
          ) : (
            <p className="plain mt-3">
              Every lead starts <strong>pending</strong> and is marked approved once they have signed
              up.
            </p>
          )}
          {/* Said only when it applies. An explanation of something that is not
              happening on this list is just one more line to read past. */}
          {fromApprovals > 0 ? (
            <p className="plain mt-2 text-ink-soft">
              {fromApprovals === 1 ? 'One of them reads' : `${fromApprovals} of them read`} approved
              because there is an approval on file, which is the merchant confirming it went
              through. Removing the approval is what changes that back.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="field-error">
              {error}
            </p>
          ) : null}

          {matching.length === 0 ? (
            <p className="py-12 text-center text-[19px] text-ink-soft">
              No {filter} leads in this list.
            </p>
          ) : (
            <ul className="mt-5 flex flex-col gap-4">
              {/* Stacked on a phone, one row from lg up — fixed-width columns
                  cannot survive a 390px viewport. */}
              {visible.map((row) => (
                <li
                  key={row.id}
                  className="card-row flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:gap-6"
                >
                  <div className="flex min-w-0 items-start justify-between gap-4 lg:flex-1">
                    <span className="min-w-0">
                      <span className="block text-[21px] font-semibold">{row.fullName || 'No name given'}</span>
                      <a
                        href={`mailto:${row.email}`}
                        className="link-text mt-1 block truncate text-[18px]"
                      >
                        {row.email}
                      </a>
                      {/* The phone is captured but had nowhere to be read. */}
                      {row.phone ? (
                        <a
                          href={`tel:${row.phone.replace(/[^\d+]/g, '')}`}
                          className="link-text mt-1 block truncate text-[18px]"
                        >
                          {row.phone}
                        </a>
                      ) : null}
                      {/* The value this lead was forwarded to the merchant
                          with. It is what turns up in the report's var3
                          column, so it is the thing to search for when an
                          approval needs tracing back to a person. Leads
                          captured before references existed have a uuid
                          instead, which never travelled anywhere, so showing
                          it would only invite a fruitless search. */}
                      {isLeadId(row.id) ? (
                        <span className="mt-1.5 block text-[17px] text-ink-dim">
                          ref <span className="tnum font-semibold text-ink-soft">{row.id}</span>
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="flex-none text-[18px] text-ink-soft lg:hidden"
                      title={row.capturedAt}
                    >
                      {row.age}
                    </span>
                  </div>

                  <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 lg:flex-none">
                    {/* Campaign names are free text and can be very long — cap
                        it so one row cannot push the whole panel sideways. */}
                    <span
                      className="chip chip-quiet max-w-[260px]"
                      title={row.campaign || row.slug}
                    >
                      <span className="block min-w-0 truncate">{row.campaign || row.slug}</span>
                    </span>
                    {showAssignee ? (
                      <span className="truncate text-[18px] text-ink-soft lg:w-[150px]">
                        {row.assignee || 'Unassigned'}
                      </span>
                    ) : null}
                  </div>

                  <div className="lg:w-[150px] lg:flex-none">
                    {/* No toggle where an approval decides it: pressing it
                        would write a status the next render overrules, which
                        is a control that lies about what it does. */}
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
                  </div>

                  <span
                    className="hidden text-right text-[18px] text-ink-soft lg:block lg:w-[110px]"
                    title={row.capturedAt}
                  >
                    {row.age}
                  </span>
                </li>
              ))}
            </ul>
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
