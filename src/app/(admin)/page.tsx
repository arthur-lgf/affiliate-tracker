import Link from 'next/link';
import { ActivityChart } from '@/components/ActivityChart';
import { EmptyState } from '@/components/EmptyState';
import { ErrorPanel } from '@/components/ErrorPanel';
import { Stat } from '@/components/Stat';
import { buildStats, formatDateTime, formatPercent, type PerformanceRow } from '@/lib/analytics';
import { loadAll } from '@/lib/load';
import { prettyUrl } from '@/lib/url';

export const dynamic = 'force-dynamic';

const RECENT_LIMIT = 25;

export default async function DashboardPage() {
  const { links, submissions, visits, error } = await loadAll();

  if (error) {
    return <ErrorPanel title="Could not read your data" message={error} />;
  }

  const stats = buildStats(links, submissions, visits);
  const recent = submissions.slice(0, RECENT_LIMIT);

  const trendNote =
    stats.trend7 === null
      ? `${stats.submissionsPrev7} in the previous 7`
      : `${stats.trend7 >= 0 ? '+' : ''}${(stats.trend7 * 100).toFixed(0)}% vs previous 7 days`;

  return (
    <div className="space-y-14">
      {/* Headline numbers */}
      <section aria-labelledby="figures">
        <h2 id="figures" className="sr-only">
          Key figures
        </h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-5">
          <Stat
            label="Total leads"
            value={stats.totalSubmissions.toLocaleString()}
            note="Rows written to your sheet"
            accent
            delay={0}
          />
          <Stat
            label="Today"
            value={stats.submissionsToday.toLocaleString()}
            note="Since 00:00 UTC"
            delay={60}
          />
          <Stat
            label="Last 7 days"
            value={stats.submissionsLast7.toLocaleString()}
            note={trendNote}
            delay={120}
          />
          <Stat
            label="Conversion"
            value={stats.totalVisits > 0 ? formatPercent(stats.conversion, 1) : '—'}
            note={`${stats.totalVisits.toLocaleString()} landing page visits`}
            delay={180}
          />
          <Stat
            label="Active links"
            value={stats.activeLinks.toLocaleString()}
            note={`${stats.totalLinks} created in total`}
            delay={240}
          />
        </div>
      </section>

      {/* Chart */}
      <section aria-labelledby="activity" className="rule-top pt-6">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h2 id="activity" className="font-display text-2xl">
            Last 14 days
          </h2>
          <span className="eyebrow">Submissions vs visits</span>
        </div>
        <ActivityChart series={stats.series} />
      </section>

      {/* Leaderboards */}
      <section className="grid gap-10 rule-top pt-6 lg:grid-cols-2">
        <Leaderboard
          title="By assignee"
          caption="Who is bringing the leads in"
          rows={stats.byAssignee}
          emptyLabel="No traffic attributed yet."
        />
        <Leaderboard
          title="By campaign"
          caption="Which offer is pulling"
          rows={stats.byCampaign}
          emptyLabel="No campaign activity yet."
        />
      </section>

      {/* Recent submissions */}
      <section aria-labelledby="recent" className="rule-top pt-6">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-4">
          <h2 id="recent" className="font-display text-2xl">
            Recent submissions
          </h2>
          <span className="eyebrow">
            {submissions.length > RECENT_LIMIT
              ? `Latest ${RECENT_LIMIT} of ${submissions.length}`
              : `${submissions.length} total`}
          </span>
        </div>

        {recent.length === 0 ? (
          <EmptyState
            title="No leads captured yet"
            body="Create an affiliate link, share it with your assignee, and every form fill will land here and in your Google Sheet."
            ctaHref="/links/new"
            ctaLabel="Create your first link"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[860px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Campaign</th>
                  <th>Assignee</th>
                  <th>Forwarded to</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap font-mono text-[0.75rem] text-muted">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="font-medium">{row.fullName || '—'}</td>
                    <td className="text-sm text-ink-2">
                      <a className="underline decoration-rule underline-offset-2 hover:decoration-signal" href={`mailto:${row.email}`}>
                        {row.email}
                      </a>
                      {row.phone ? (
                        <div className="font-mono text-[0.75rem] text-muted">{row.phone}</div>
                      ) : null}
                    </td>
                    <td className="text-sm">
                      {row.campaign || row.slug}
                      <div className="font-mono text-[0.6875rem] text-muted">/{row.slug}</div>
                    </td>
                    <td className="text-sm">
                      {row.assignee || <span className="text-muted">Unassigned</span>}
                      {row.usr ? (
                        <div className="font-mono text-[0.6875rem] text-muted">usr={row.usr}</div>
                      ) : null}
                    </td>
                    <td className="max-w-[260px] text-sm">
                      <a
                        href={row.destination}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="font-mono text-[0.75rem] underline decoration-rule underline-offset-2 hover:decoration-signal"
                        title={row.destination}
                      >
                        {prettyUrl(row.destination, 40)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {links.length > 0 ? (
        <p className="eyebrow">
          <Link href="/links" className="underline decoration-rule underline-offset-4 hover:text-signal">
            Manage affiliate links →
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function Leaderboard({
  title,
  caption,
  rows,
  emptyLabel,
}: {
  title: string;
  caption: string;
  rows: PerformanceRow[];
  emptyLabel: string;
}) {
  const top = rows.slice(0, 6);
  const peak = Math.max(1, ...top.map((r) => r.submissions));

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h3 className="font-display text-2xl">{title}</h3>
        <span className="eyebrow">{caption}</span>
      </div>

      {top.length === 0 ? (
        <p className="border border-dashed border-rule px-4 py-8 text-center text-sm text-muted">
          {emptyLabel}
        </p>
      ) : (
        <ol className="space-y-3">
          {top.map((row, index) => (
            <li key={row.key} className="border-b border-rule-soft pb-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="tnum font-mono text-[0.6875rem] text-muted">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="truncate text-sm font-medium">{row.label}</span>
                  <span className="shrink-0 font-mono text-[0.625rem] text-muted">
                    {row.sublabel}
                  </span>
                </span>
                <span className="tnum shrink-0 text-sm">
                  <strong className="font-display text-lg">{row.submissions}</strong>
                  {row.visits > 0 ? (
                    <span className="ml-2 font-mono text-[0.6875rem] text-muted">
                      {formatPercent(row.conversion, 0)} of {row.visits}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="mt-2 h-[3px] w-full bg-rule-soft">
                <div
                  className="draw-rule h-full"
                  style={{
                    width: `${(row.submissions / peak) * 100}%`,
                    background: index === 0 ? 'var(--color-signal)' : 'var(--color-ink)',
                    animationDelay: `${index * 70}ms`,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
