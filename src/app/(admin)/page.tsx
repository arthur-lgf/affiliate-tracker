import Link from 'next/link';
import { ConversionForm, type ApprovalTarget } from '@/components/ConversionForm';
import { DeleteApproval } from '@/components/DeleteApproval';
import { EarningsChart } from '@/components/EarningsChart';
import { EmptyState } from '@/components/EmptyState';
import { ErrorPanel } from '@/components/ErrorPanel';
import { LeadsPanel, type LeadRow } from '@/components/LeadsPanel';
import { PersonFilter } from '@/components/PersonFilter';
import {
  affiliateHref,
  buildEarnings,
  buildStats,
  describeConversions,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatRelative,
  initialsOf,
  PERIODS,
  type Period,
} from '@/lib/analytics';
import { captureFormEnabled } from '@/lib/config';
import { loadAll } from '@/lib/load';

export const dynamic = 'force-dynamic';

const RECENT_LIMIT = 200;
const RECENT_APPROVALS = 8;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function parsePeriod(raw: string): Period {
  return (PERIODS.find((p) => p.key === raw)?.key ?? 'month') as Period;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const period = parsePeriod(firstValue(query.period));
  const capture = captureFormEnabled();

  const { links, submissions, visits, conversions, error } = await loadAll();

  if (error) {
    return <ErrorPanel title="Could not read your data" message={error} />;
  }

  // Only honour a person filter that exists, so a stale bookmark shows the whole
  // table rather than a convincing but empty one.
  const requestedUsr = firstValue(query.usr);
  const earningsAll = buildEarnings(links, visits, conversions, { period });
  const usr = earningsAll.people.some((p) => p.usr === requestedUsr) ? requestedUsr : '';
  const view = usr ? buildEarnings(links, visits, conversions, { period, usr }) : earningsAll;

  const hasAnything = links.length > 0 || visits.length > 0 || conversions.length > 0;
  if (!hasAnything) {
    return (
      <>
        <h1 className="sr-only">Dashboard</h1>
        <EmptyState
          title="Nothing has come in yet"
          body="Create an affiliate link, share it with the person it belongs to, and every click will land here."
          ctaHref="/links/new"
          ctaLabel="Create your first link"
        />
      </>
    );
  }

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? '30 days';
  const person = view.people.find((p) => p.usr === usr);

  // One option per link, newest first — an approval is recorded against the link
  // it came through, which is what keeps its person and card matching the table.
  const targets: ApprovalTarget[] = links.map((link) => ({
    id: link.id,
    slug: link.slug,
    usr: link.usr,
    assignee: link.assignee,
    card: link.campaign || link.slug,
    label: `${link.assignee || 'House'} · ${link.campaign || link.slug}`,
  }));

  // Person and card are resolved through each row's link, not stored on it.
  const recentApprovals = describeConversions(links, conversions.slice(0, RECENT_APPROVALS));

  const leadRows: LeadRow[] = capture
    ? submissions.slice(0, RECENT_LIMIT).map((row) => ({
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
      }))
    : [];
  const stats = capture ? buildStats(links, submissions, visits, 30) : null;

  return (
    <div className="w-full">
      <h1 className="sr-only">Dashboard</h1>

      {/* Filters. Links rather than client state: the filter lives in the URL, so
          a view can be bookmarked and the table stays server-rendered. */}
      <section className="rise flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <span className="flex flex-wrap gap-2">
          {PERIODS.map((option) => {
            const params = new URLSearchParams();
            if (option.key !== 'month') params.set('period', option.key);
            if (usr) params.set('usr', usr);
            const search = params.toString();
            return (
              <Link
                key={option.key}
                href={search ? `/?${search}` : '/'}
                className="pill-action"
                data-active={option.key === period}
                aria-current={option.key === period ? 'page' : undefined}
              >
                {option.label}
              </Link>
            );
          })}
        </span>
        <PersonFilter people={view.people} value={usr} />
      </section>

      {/* Hero — earnings for the selected window */}
      <section className="rise panel mt-4 grid gap-8 p-6 sm:p-7 lg:grid-cols-[330px_1fr] lg:gap-8">
        <div>
          <p className="label-micro">
            Total earnings · {periodLabel}
            {person ? ` · ${person.name}` : ''}
          </p>
          <p className="tnum mt-4 font-display text-[62px] leading-[0.9] sm:text-[78px]">
            {formatMoney(view.totals.earnings)}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <span className="pill bg-mustard px-3 py-1.5 text-pine-900">
              {view.totals.approved} approved
            </span>
            <span className="text-[12.5px] text-sage">
              from {view.totals.visits.toLocaleString()} visit
              {view.totals.visits === 1 ? '' : 's'}
            </span>
          </div>
          <p className="mt-6 max-w-[270px] text-[13px] leading-relaxed text-sage">
            Visits are counted the moment someone follows a link. Approvals are recorded here or in
            the Conversions tab of your sheet.
          </p>
        </div>

        <EarningsChart series={view.series} />
      </section>

      {/* Supporting figures */}
      <section className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Visits"
          value={view.totals.visits.toLocaleString()}
          note={periodLabel.toLowerCase()}
        />
        <StatCard
          label="Approved"
          value={view.totals.approved.toLocaleString()}
          note={
            view.totals.visits > 0
              ? `${formatPercent(view.totals.approvalRate, 1)} of visits`
              : 'no visits yet'
          }
          noteColor="var(--color-moss)"
          delay={40}
        />
        <StatCard
          label="Per approval"
          value={
            view.totals.approved > 0
              ? formatMoney(view.totals.earnings / view.totals.approved)
              : '—'
          }
          note={view.totals.approved > 0 ? 'average payout' : 'nothing approved yet'}
          delay={80}
        />
      </section>

      {/* The table */}
      <section className="rise panel mt-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 className="font-display text-[22px]">Who is earning</h2>
          <span className="text-xs text-sage">
            {view.rows.length} {view.rows.length === 1 ? 'person' : 'people'} · {periodLabel} · open
            one for its cards
          </span>
        </div>

        {view.rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-sage-dim">
            Nothing in this window. Try a longer period{usr ? ' or everyone' : ''}.
          </p>
        ) : (
          // Wide content scrolls inside its own container so the page never does.
          <div className="mt-4 -mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[480px] border-collapse text-left">
              <thead>
                <tr className="border-b border-pine-line">
                  <Th>Person</Th>
                  <Th align="right">Visits</Th>
                  <Th align="right">Approved</Th>
                  <Th align="right">Total earnings</Th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr
                    key={row.key}
                    className="row-link border-b border-pine-line last:border-0"
                  >
                    <td className="py-3.5 pr-4">
                      {/* The whole name cell is the link into their own page —
                          the row is the thing you want to click, not a word. */}
                      <Link
                        href={affiliateHref(row.usr, period)}
                        className="flex items-center gap-2.5 rounded-lg"
                      >
                        <span aria-hidden className="disc h-[30px] w-[30px] flex-none text-[10.5px]">
                          {row.usr ? initialsOf(row.person) : '—'}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-medium">
                            {row.person}
                            <span aria-hidden className="row-link-arrow ml-1.5 text-sage-dim">
                              →
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-sage-dim">
                            {row.cardCount} card{row.cardCount === 1 ? '' : 's'}
                            {row.usr ? ` · usr=${row.usr}` : ' · no usr'}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="tnum py-3.5 pr-4 text-right text-[13.5px]">
                      {row.visits.toLocaleString()}
                    </td>
                    <td className="py-3.5 pr-4 text-right">
                      <span className="tnum block text-[13.5px]">{row.approved}</span>
                      {row.visits > 0 && row.approved > 0 ? (
                        <span className="mt-0.5 block text-[11px] text-sage-dim">
                          {formatPercent(row.approvalRate, 1)}
                        </span>
                      ) : null}
                    </td>
                    <td className="tnum py-3.5 text-right font-display text-xl">
                      {formatMoney(row.earnings)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-pine-700">
                  <td className="py-3.5 text-[12.5px] text-sage">Total</td>
                  <td className="tnum py-3.5 pr-4 text-right text-[13.5px]">
                    {view.totals.visits.toLocaleString()}
                  </td>
                  <td className="tnum py-3.5 pr-4 text-right text-[13.5px]">
                    {view.totals.approved.toLocaleString()}
                  </td>
                  <td
                    className="tnum py-3.5 text-right font-display text-xl"
                    style={{ color: 'var(--color-mustard)' }}
                  >
                    {formatMoney(view.totals.earnings)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Recording approvals */}
      <section className="rise panel mt-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 className="font-display text-[22px]">Approvals</h2>
          <span className="text-xs text-sage">
            {conversions.length} recorded · all time
          </span>
        </div>

        <div className="mt-4">
          <ConversionForm targets={targets} />
        </div>

        {recentApprovals.length > 0 ? (
          <ul className="mt-5">
            {recentApprovals.map((row) => (
              <li
                key={row.id}
                className="divider-row flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-[13px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {row.person} · {row.card}
                  </span>
                  {row.notes ? (
                    <span className="mt-0.5 block truncate text-[11.5px] text-sage-dim">
                      {row.notes}
                    </span>
                  ) : null}
                </span>
                <span className="text-[12px] text-sage-dim">{row.approvedOn}</span>
                <span className="tnum w-[86px] text-right font-display text-lg">
                  {formatMoney(row.amount)}
                </span>
                <DeleteApproval id={row.id} label={`${row.person} · ${row.card}`} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-5 text-[12.5px] text-sage-dim">
            None recorded yet. Add them here, or type them straight into the Conversions tab.
          </p>
        )}
      </section>

      {/* Lead capture, only while the form is switched on */}
      {capture && stats ? <LeadsPanel rows={leadRows} total={submissions.length} /> : null}
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`label-micro pb-2.5 font-medium ${align === 'right' ? 'text-right' : 'text-left'} ${
        align === 'right' ? 'pr-4 last:pr-0' : 'pr-4'
      }`}
    >
      {children}
    </th>
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
