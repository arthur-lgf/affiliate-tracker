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
  describeConversions,
  formatDateTime,
  formatDay,
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
              className="pill-filter"
              data-active={option.key === period}
              aria-current={option.key === period ? 'page' : undefined}
            >
              {option.label}
            </Link>
          );
        })}
        <span aria-hidden className="mx-2 hidden h-9 w-0.5 bg-edge lg:block" />
        <PersonFilter people={view.people} value={usr} />
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
              ? `of ${view.totals.visits.toLocaleString()} visits — ${formatPercent(
                  view.totals.approvalRate,
                  1,
                )}`
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
              : '—'
          }
          unit={view.totals.approved > 0 ? '' : 'nothing approved yet'}
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
          // Wide content scrolls inside its own container so the page never
          // does. `relative` matters: an absolutely positioned descendant (an
          // sr-only label, say) would otherwise resolve against the document
          // and stretch it to the table's full 760px on a phone.
          <div className="relative -mx-2 mt-5 overflow-x-auto px-2">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b-2 border-edge">
                  <Th>Person</Th>
                  <Th align="right">Visits</Th>
                  <Th align="right">Approved</Th>
                  <Th align="right">Total earnings</Th>
                  {/* Deliberately empty: every button in the column carries its
                      own "Open <person>" label, so a header here would only
                      repeat itself once per row. */}
                  <th className="pb-3" />

                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.key} className="divider-row last:border-0">
                    <td className="py-5 pr-4">
                      <div className="flex items-center gap-4.5">
                        <span aria-hidden className="disc h-14 w-14 text-[19px]">
                          {row.usr ? initialsOf(row.person) : '—'}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[23px] font-semibold">
                            {row.person}
                          </span>
                          <span className="mt-1 block truncate text-[18px] text-ink-soft">
                            {row.cardCount} card{row.cardCount === 1 ? '' : 's'}
                            {row.usr ? ` · usr=${row.usr}` : ' · no usr'}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="tnum py-5 pr-4 text-right text-[28px] font-semibold">
                      {row.visits.toLocaleString()}
                    </td>
                    <td className="py-5 pr-4 text-right">
                      <span className="tnum block text-[28px] font-semibold">{row.approved}</span>
                      {row.visits > 0 && row.approved > 0 ? (
                        <span className="mt-0.5 block text-[17px] text-ink-soft">
                          {formatPercent(row.approvalRate, 1)} of visits
                        </span>
                      ) : null}
                    </td>
                    <td className="tnum py-5 pr-4 text-right font-display text-[30px] font-semibold">
                      {formatMoney(row.earnings)}
                    </td>
                    <td className="py-5 text-right">
                      {/* One link per row rather than a whole-row target: the
                          thing you can click is then something you can see. */}
                      <Link
                        href={affiliateHref(row.usr, period)}
                        className="btn-outline btn-sm"
                        aria-label={`Open ${row.person}`}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-edge-strong">
                  <td className="py-5 text-[21px] font-bold">Total</td>
                  <td className="tnum py-5 pr-4 text-right text-[26px] font-semibold">
                    {view.totals.visits.toLocaleString()}
                  </td>
                  <td className="tnum py-5 pr-4 text-right text-[26px] font-semibold">
                    {view.totals.approved.toLocaleString()}
                  </td>
                  <td className="py-5 pr-4 text-right">
                    <span className="mark tnum font-display text-[30px] font-bold">
                      {formatMoney(view.totals.earnings)}
                    </span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Recording approvals */}
      <section className="rise panel mt-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div>
            <h2 className="font-display text-[32px]">Approvals</h2>
            <p className="plain mt-1">
              {conversions.length} recorded · all time. Nothing adds these on its own.
            </p>
          </div>
          <ConversionForm targets={targets} />
        </div>

        {recentApprovals.length > 0 ? (
          <ul className="mt-6 flex flex-col gap-4">
            {recentApprovals.map((row) => (
              <li
                key={row.id}
                className="card-row-lit flex flex-wrap items-center gap-x-6 gap-y-4 p-5 sm:px-6"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[22px] font-semibold">{row.person}</span>
                  <span className="mt-0.5 block truncate text-[18px] text-ink-soft">
                    {row.card}
                    {row.notes ? ` · ${row.notes}` : ''}
                  </span>
                </span>
                <span className="text-[19px] text-ink-soft">{formatDay(row.approvedOn)}</span>
                <span className="tnum min-w-[110px] text-right font-display text-[30px] font-semibold">
                  {formatMoney(row.amount)}
                </span>
                <DeleteApproval id={row.id} label={`${row.person} · ${row.card}`} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="plain mt-6">
            None recorded yet. Add one here, or type it straight into the Conversions tab of your
            sheet.
          </p>
        )}
      </section>

      {/* Lead capture, only while the form is switched on */}
      {capture ? <LeadsPanel rows={leadRows} total={submissions.length} /> : null}
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`label-cap pb-3 pr-4 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
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
