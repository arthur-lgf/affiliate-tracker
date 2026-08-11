import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { ErrorPanel } from '@/components/ErrorPanel';
import { LeadsChart } from '@/components/LeadsChart';
import { LeadsPanel, type LeadRow } from '@/components/LeadsPanel';
import {
  buildStats,
  formatDateTime,
  formatPercent,
  formatRelative,
  initialsOf,
  type PerformanceRow,
} from '@/lib/analytics';
import { loadAll } from '@/lib/load';

export const dynamic = 'force-dynamic';

/**
 * How many leads are handed to the browser. Enough to filter and work through
 * without shipping a spreadsheet's worth of names and phone numbers into a
 * page; the sheet holds the rest.
 */
const RECENT_LIMIT = 200;

/** Segment colours for the campaign split, in priority order. */
const SEGMENT_COLORS = [
  'var(--color-mustard)',
  'var(--color-moss)',
  '#d7cfbb',
  '#5f8f86',
  '#a07a1e',
  'var(--color-sage-dim)',
];

export default async function DashboardPage() {
  const { links, submissions, visits, error } = await loadAll();

  if (error) {
    return <ErrorPanel title="Could not read your data" message={error} />;
  }

  const stats = buildStats(links, submissions, visits, 30);
  // Built here rather than exported from LeadsPanel: every runtime export of a
  // 'use client' module is a client reference and cannot be called on the server.
  const recent: LeadRow[] = submissions.slice(0, RECENT_LIMIT).map((row) => ({
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    campaign: row.campaign,
    slug: row.slug,
    assignee: row.assignee,
    status: row.status,
    age: formatRelative(row.createdAt),
    capturedAt: formatDateTime(row.createdAt),
  }));
  const hasAnything = links.length > 0 || submissions.length > 0;

  if (!hasAnything) {
    return (
      <>
        <h1 className="sr-only">Dashboard</h1>
        <EmptyState
          title="Nothing has come in yet"
          body="Create an affiliate link, share it with the person it belongs to, and every form fill will land here and in your sheet."
          ctaHref="/links/new"
          ctaLabel="Create your first link"
        />
      </>
    );
  }

  const dayNote =
    stats.trendDay === null
      ? stats.submissionsYesterday === 0 && stats.submissionsToday > 0
        ? 'nothing yesterday'
        : 'no change on yesterday'
      : `${Math.abs(Math.round(stats.trendDay * 100))}% ${
          stats.trendDay >= 0 ? 'above' : 'below'
        } yesterday`;

  // Shares are computed against the campaigns actually drawn, so the bar always
  // fills its track even when there are more than six campaigns.
  const shown = stats.byCampaign.slice(0, 6);
  const shownTotal = shown.reduce((sum, row) => sum + row.submissions, 0);
  const segments = shown.map((row, index) => ({
    ...row,
    color: SEGMENT_COLORS[index] ?? 'var(--color-sage-dim)',
    share: shownTotal > 0 ? row.submissions / shownTotal : 0,
  }));
  // Visits are logged before anyone submits, so "campaigns exist but no leads
  // yet" is an ordinary early state, not an empty one.
  const hasCampaignLeads = shownTotal > 0;

  return (
    <div className="w-full">
      <h1 className="sr-only">Dashboard</h1>
      {/* Hero — the one number that matters, and the shape of the month */}
      <section className="rise panel grid gap-8 p-6 sm:p-7 lg:grid-cols-[330px_1fr] lg:gap-8">
        <div>
          <p className="label-micro">Leads captured</p>
          <p className="tnum mt-4 font-display text-[72px] leading-[0.86] sm:text-[92px]">
            {stats.totalSubmissions.toLocaleString()}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <span className="pill bg-mustard px-3 py-1.5 text-pine-900">
              +{stats.submissionsToday} today
            </span>
            <span className="text-[12.5px] text-sage">{dayNote}</span>
          </div>
          <p className="mt-6 max-w-[270px] text-[13px] leading-relaxed text-sage">
            Every row lands in your sheet the moment a client submits — nothing here is waiting on
            you.
          </p>
        </div>

        <LeadsChart series={stats.series} />
      </section>

      {/* Supporting figures */}
      <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Registered"
          value={stats.registered.toLocaleString()}
          note={
            stats.totalSubmissions > 0
              ? `${stats.pending.toLocaleString()} still pending`
              : 'no leads yet'
          }
          noteColor={stats.pending > 0 ? 'var(--color-mustard)' : undefined}
        />
        <StatCard
          label="Landing visits"
          value={stats.totalVisits.toLocaleString()}
          note={stats.visitsToday > 0 ? `+${stats.visitsToday} today` : 'none today'}
          noteColor="var(--color-moss)"
          delay={40}
        />
        <StatCard
          label="Conversion"
          value={stats.totalVisits > 0 ? formatPercent(stats.conversion, 1) : '—'}
          note={
            stats.totalVisits > 0
              ? `${stats.totalSubmissions.toLocaleString()} of ${stats.totalVisits.toLocaleString()} visits`
              : 'waiting on visits'
          }
          delay={80}
        />
        <StatCard
          label="Live links"
          value={stats.activeLinks.toLocaleString()}
          note={`of ${stats.totalLinks} · ${stats.totalPeople} ${
            stats.totalPeople === 1 ? 'person' : 'people'
          }`}
          delay={120}
        />
      </section>

      {/* Attribution */}
      {/* minmax(0,…) plus min-w-0 on the children: grid items default to
          min-width:auto, so a nowrap truncated label inside sets the track's
          minimum to the FULL label width and a long campaign or person name
          pushes the whole page sideways. */}
      <section className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="rise panel min-w-0 p-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-[22px]">Who is bringing them in</h2>
            <span className="text-xs text-sage">All time</span>
          </div>

          {stats.byAssignee.length === 0 ? (
            <p className="py-8 text-center text-sm text-sage-dim">
              No traffic attributed to anyone yet.
            </p>
          ) : (
            <ol className="mt-2">
              {stats.byAssignee.slice(0, 5).map((row, index) => (
                <PersonRow key={row.key} row={row} rank={index + 1} peak={stats.byAssignee[0]!} />
              ))}
            </ol>
          )}

          {stats.byAssignee.length > 5 ? (
            <p className="mt-4 text-xs text-sage-dim">
              and {stats.byAssignee.length - 5} more
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="rise panel min-w-0 p-6">
            <h2 className="font-display text-[22px]">Which offer is pulling</h2>

            {segments.length === 0 ? (
              <p className="py-8 text-center text-sm text-sage-dim">No campaign activity yet.</p>
            ) : (
              <>
                <div className="mt-[18px] flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-pine-800">
                  {hasCampaignLeads
                    ? segments.map((seg) => (
                        <span
                          key={seg.key}
                          className="sweep"
                          style={{
                            width: `${Math.max(seg.share * 100, 2)}%`,
                            background: seg.color,
                          }}
                          title={`${seg.label} — ${seg.submissions}`}
                        />
                      ))
                    : null}
                </div>
                {!hasCampaignLeads ? (
                  <p className="mt-2 text-xs text-sage-dim">
                    Visits are coming in — no leads to split yet.
                  </p>
                ) : null}
                <ul className="mt-1">
                  {segments.map((seg) => (
                    <li
                      key={seg.key}
                      className="divider-row flex items-center gap-3 py-[11px] text-[13px]"
                    >
                      <span
                        aria-hidden
                        className="h-[9px] w-[9px] flex-none rounded-full"
                        style={{ background: seg.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{seg.label}</span>
                      <span className="text-xs text-sage-dim">
                        {formatPercent(seg.share, 0)}
                      </span>
                      <span className="tnum w-10 text-right font-display text-lg">
                        {seg.submissions}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {stats.insight ? (
            <div className="rise panel-cream p-6">
              <p className="label-micro" style={{ color: 'var(--color-olive)' }}>
                Worth a look
              </p>
              <p className="mt-2.5 font-display text-[19px] leading-[1.35]">
                {stats.insight.campaign} takes {formatPercent(stats.insight.visitShare, 0)} of your
                visits and converts at {formatPercent(stats.insight.conversion, 1)}.
              </p>
              <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">
                Worth a look at its landing headline, or pausing it while you rewrite.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/links"
                  className="pill bg-pine-900 px-4 py-2.5 text-cream transition-colors hover:bg-pine-850"
                >
                  Open its link
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <LeadsPanel rows={recent} total={submissions.length} />
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
  noteColor,
  delay = 0,
}: {
  label: string;
  value: string;
  note: string;
  noteColor?: string;
  delay?: number;
}) {
  return (
    <div className="rise panel-sm p-5" style={{ animationDelay: `${delay}ms` }}>
      <p className="label-micro">{label}</p>
      <div className="mt-2.5 flex flex-wrap items-baseline gap-3">
        <span className="tnum font-display text-[38px] leading-none">{value}</span>
        <span className="text-[12.5px]" style={{ color: noteColor ?? 'var(--color-sage)' }}>
          {note}
        </span>
      </div>
    </div>
  );
}

function PersonRow({
  row,
  rank,
  peak,
}: {
  row: PerformanceRow;
  rank: number;
  peak: PerformanceRow;
}) {
  const width = peak.submissions > 0 ? (row.submissions / peak.submissions) * 100 : 0;
  return (
    <li className="divider-row flex items-center gap-3.5 py-[15px]">
      <span aria-hidden className="disc h-[34px] w-[34px] text-[11px]">
        {row.key === '(house)' ? '—' : initialsOf(row.label)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium">{row.label}</span>
        <span className="mt-0.5 block text-[11.5px] text-sage-dim">
          {row.visits.toLocaleString()} visit{row.visits === 1 ? '' : 's'}
          {row.visits > 0 ? ` · ${formatPercent(row.conversion, 0)} converting` : ''}
        </span>
      </span>
      <span
        aria-hidden
        className="hidden h-1.5 w-[120px] flex-none overflow-hidden rounded-full bg-pine-800 sm:block"
      >
        <span
          className="sweep block h-full rounded-full bg-mustard"
          style={{ width: `${width}%`, animationDelay: `${rank * 60}ms` }}
        />
      </span>
      <span className="tnum w-[52px] text-right font-display text-2xl">{row.submissions}</span>
    </li>
  );
}
