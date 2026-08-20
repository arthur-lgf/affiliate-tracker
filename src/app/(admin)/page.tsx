import Link from 'next/link';
import { ApprovalsList } from '@/components/ApprovalsList';
import { ConversionForm, type ApprovalTarget } from '@/components/ConversionForm';
import { EarnersTable } from '@/components/EarnersTable';
import { EarningsChart } from '@/components/EarningsChart';
import { EmptyState } from '@/components/EmptyState';
import { ErrorPanel } from '@/components/ErrorPanel';
import { LeadsPanel, type LeadRow } from '@/components/LeadsPanel';
import { LinkPending } from '@/components/LinkPending';
import { PersonFilter } from '@/components/PersonFilter';
import {
  affiliateHref,
  buildEarnings,
  describeConversions,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatRelative,
  PERIODS,
  type Period,
} from '@/lib/analytics';
import { captureFormEnabled } from '@/lib/config';
import { loadAll } from '@/lib/load';
import { approvedLeadIds } from '@/lib/qmp-sync';
import { requireViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

/**
 * How much history the two paged lists carry.
 *
 * The approvals list used to stop at eight, which is as far as a list with no
 * controls can honestly go. It pages now, so it gets the same window the leads
 * do — far enough back to be worth paging through, short enough that the page
 * is not shipping a year of rows to a browser that will show ten.
 */
const RECENT_LIMIT = 200;

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

  const viewer = await requireViewer();
  const isAdmin = viewer.role === 'admin';

  // Already cut to this viewer's tracking key. Everything below counts, sums
  // and charts whatever came back, so scoping once here is what makes every
  // figure on the page theirs.
  const { links, submissions, visits, conversions, error } = await loadAll(viewer);

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
        {isAdmin ? (
          <EmptyState
            title="Nothing has come in yet"
            body="Create an affiliate link, share it with the person it belongs to, and every click will land here."
            ctaHref="/links/new"
            ctaLabel="Create your first link"
          />
        ) : (
          <EmptyState
            title="Nothing has come in yet"
            body={`Nothing has been recorded against usr=${viewer.usr} so far. Create a link of your own, share it, and every click will show up here.`}
            ctaHref="/links/new"
            ctaLabel="Create your first link"
          />
        )}
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
  // The client comes from the lead reference the sync kept on the row.
  const recentApprovals = describeConversions(
    links,
    conversions.slice(0, RECENT_LIMIT),
    submissions,
  );

  // Who the approvals below name. Worked out once for the whole list rather
  // than per row, and from every approval rather than the page's slice, so a
  // lead reads approved whether the approval was imported this morning or six
  // syncs ago.
  const approvedLeads = approvedLeadIds(conversions);

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
        hasApproval: approvedLeads.has(row.id),
        age: formatRelative(row.createdAt),
        capturedAt: formatDateTime(row.createdAt),
      }))
    : [];

  return (
    <div className="w-full">
      <h1 className="sr-only">Dashboard</h1>

      {/* Filters. Links rather than client state: the filter lives in the URL, so
          a view can be bookmarked and the table stays server-rendered. */}
      <section className="rise flex flex-wrap items-center gap-x-3 gap-y-3">
        <span className="text-[19px] font-semibold text-ink-soft">Show me</span>
        {PERIODS.map((option) => {
          const params = new URLSearchParams();
          if (option.key !== 'month') params.set('period', option.key);
          if (usr) params.set('usr', usr);
          const search = params.toString();
          return (
            <Link
              key={option.key}
              href={search ? `/?${search}` : '/'}
              /* relative, so the pending overlay can sit on top of the pill. */
              className="pill-filter relative"
              data-active={option.key === period}
              aria-current={option.key === period ? 'page' : undefined}
            >
              {option.label}
              {/* Only the query string changes here, so this page is never
                  unmounted and its loading.tsx never appears. Without this,
                  clicking a period does nothing visible until the new numbers
                  land. */}
              <LinkPending />
            </Link>
          );
        })}
        {/* One person cannot be filtered down to one person. */}
        {isAdmin ? (
          <>
            <span aria-hidden className="mx-2 hidden h-9 w-0.5 bg-edge lg:block" />
            <PersonFilter people={view.people} value={usr} />
          </>
        ) : null}
      </section>

      {/* Hero — earnings for the selected window */}
      <section className="rise panel mt-5 grid gap-10 p-6 sm:p-8 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h2 className="label-cap">
            {person ? `${person.name}'s earnings` : 'Total earnings'} · {periodLabel.toLowerCase()}
          </h2>
          {/* Clamped, not stepped: a money figure is one unbreakable token, so
              the type has to scale with the box or a seven-figure total pushes
              the whole page sideways on a phone. */}
          <p className="tnum mt-4 font-display leading-[0.95] text-[clamp(2rem,9vw,5.125rem)]">
            {formatMoney(view.totals.earnings)}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <span className="chip chip-gold">
              {view.totals.approved} approved
            </span>
            <span className="text-[20px] text-ink-soft">
              from {view.totals.visits.toLocaleString()} visit
              {view.totals.visits === 1 ? '' : 's'}
            </span>
          </div>

          <p className="plain-note mt-6">
            A <strong>visit</strong> is counted the moment someone opens one of your links. An{' '}
            <strong>approval</strong> is a visit the merchant agreed to pay you for.
          </p>

          <Link
            href={usr ? affiliateHref(usr, period) : '#who-is-earning'}
            className="btn-outline btn-sm mt-6"
          >
            {usr && person ? `See ${person.name}'s cards` : 'See where it came from'}
          </Link>
        </div>

        <EarningsChart series={view.series} />
      </section>

      {/* Supporting figures. Each one says in words what it counts. */}
      <section className="mt-5 grid gap-5 lg:grid-cols-3">
        <StatCard
          label="Visits"
          value={view.totals.visits.toLocaleString()}
          unit={`in ${periodLabel.toLowerCase()}`}
          plain="People who opened one of your links."
        />
        <StatCard
          label="Approved"
          value={view.totals.approved.toLocaleString()}
          unit={
            view.totals.visits > 0
              ? `${formatPercent(view.totals.approvalRate, 1)} of ${view.totals.visits.toLocaleString()} visits`
              : 'no visits yet'
          }
          plain="Visits the merchant agreed to pay for."
          delay={40}
        />
        <StatCard
          label="Per approval"
          value={
            view.totals.approved > 0
              ? formatMoney(view.totals.earnings / view.totals.approved)
              : 'None yet'
          }
          unit=""
          plain="Average payout each time one is approved."
          delay={80}
        />
      </section>

      {/* The table */}
      <section id="who-is-earning" className="rise panel mt-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
          <h2 className="font-display text-[32px]">Who is earning</h2>
          <span className="text-[19px] text-ink-soft">
            {view.rows.length} {view.rows.length === 1 ? 'person' : 'people'} ·{' '}
            {periodLabel.toLowerCase()}
          </span>
        </div>
        <p className="plain mt-2">
          One row per person. Open a row to see the cards behind their numbers.
        </p>

        {view.rows.length === 0 ? (
          <p className="py-12 text-center text-[19px] text-ink-soft">
            Nothing in this window. Try a longer period{usr ? ' or everyone' : ''}.
          </p>
        ) : (
          <EarnersTable rows={view.rows} totals={view.totals} period={period} />
        )}
      </section>

      {/* Recording approvals */}
      <section className="rise panel mt-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div>
            <h2 className="font-display text-[32px]">Approvals</h2>
            <p className="plain mt-1">
              {conversions.length > recentApprovals.length
                ? `Latest ${recentApprovals.length} of ${conversions.length.toLocaleString()}.`
                : `${conversions.length} recorded · all time.`}{' '}
              {isAdmin
                ? 'Nothing adds these on its own.'
                : 'Recorded by your admin as the merchant confirms them.'}
            </p>
          </div>
          {isAdmin ? <ConversionForm targets={targets} /> : null}
        </div>

        <ApprovalsList
          rows={recentApprovals}
          canEdit={isAdmin}
          empty={
            isAdmin
              ? 'None recorded yet. Add one here, or type it straight into the Conversions tab of your sheet.'
              : 'None recorded against your links yet.'
          }
        />
      </section>

      {/* Lead capture, only while the form is switched on */}
      {capture ? (
        <LeadsPanel rows={leadRows} total={submissions.length} canEdit={isAdmin} />
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  plain,
  delay = 0,
}: {
  label: string;
  value: string;
  unit: string;
  plain: string;
  delay?: number;
}) {
  return (
    <div className="rise panel p-6 sm:p-7" style={{ animationDelay: `${delay}ms` }}>
      <h3 className="label-cap">{label}</h3>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="tnum font-display text-[52px] leading-none sm:text-[58px]">{value}</span>
        {unit ? <span className="text-[19px] text-ink-soft">{unit}</span> : null}
      </div>
      <p className="plain mt-3">{plain}</p>
    </div>
  );
}
