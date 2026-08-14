import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DeleteApproval } from '@/components/DeleteApproval';
import { EarningsChart } from '@/components/EarningsChart';
import { ErrorPanel } from '@/components/ErrorPanel';
import { LinkPending } from '@/components/LinkPending';
import {
  buildEarnings,
  describeConversions,
  formatDay,
  formatMoney,
  formatPercent,
  HOUSE_KEY,
  initialsOf,
  PERIODS,
  type Period,
} from '@/lib/analytics';
import { loadAll } from '@/lib/load';
import { ownsKey } from '@/lib/scope';
import { normalizeKey } from '@/lib/validate';
import { requireViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

const RECENT_APPROVALS = 12;

type PageProps = {
  params: Promise<{ usr: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function parsePeriod(raw: string): Period {
  return (PERIODS.find((p) => p.key === raw)?.key ?? 'month') as Period;
}

/**
 * `_house` is the one key that isn't a tracking key — it stands for clicks that
 * arrived with no ?usr= at all. Everything else is normalised the same way the
 * links are, so /affiliate/Arthur resolves to the same page as /affiliate/arthur.
 */
function decodeUsr(raw: string): string {
  const decoded = decodeURIComponent(raw);
  return decoded === HOUSE_KEY ? '' : normalizeKey(decoded);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { usr } = await params;
  return { title: decodeUsr(usr) || 'Unassigned' };
}

export default async function AffiliatePage({ params, searchParams }: PageProps) {
  const { usr: rawUsr } = await params;
  const query = await searchParams;
  const period = parsePeriod(firstValue(query.period));
  const usr = decodeUsr(rawUsr);
  const personKey = usr || HOUSE_KEY;

  const viewer = await requireViewer();
  const isAdmin = viewer.role === 'admin';

  // An affiliate asking for anybody else's page gets the same 404 as a key that
  // was never used. notFound() rather than a redirect or a "forbidden" on
  // purpose: telling someone that a key exists but is not theirs is itself a
  // fact about who else works here and what their key is.
  if (!ownsKey(viewer, usr)) notFound();

  const { links, submissions, visits, conversions, error } = await loadAll(viewer);
  if (error) {
    return <ErrorPanel title="Could not read your data" message={error} />;
  }

  // Cards for this person only. All time is checked separately from the
  // selected window, so a person with no activity *this month* still gets their
  // page (showing an empty window) rather than a 404 that reads as "no such
  // person" — only a key that has never been seen at all is a 404.
  const everView = buildEarnings(links, visits, conversions, {
    period: 'all',
    usr: personKey,
    groupBy: 'card',
  });
  if (everView.rows.length === 0) notFound();

  const view = buildEarnings(links, visits, conversions, {
    period,
    usr: personKey,
    groupBy: 'card',
  });

  const person = everView.people.find((p) => p.usr === personKey);
  const name = person?.name ?? usr;
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? '30 days';

  // Leads are passed in so each approval can name the client behind it. They
  // are already scoped to this viewer, so an approval whose lead belongs to
  // somebody else resolves to a dash rather than to a name they may not see.
  const theirApprovals = describeConversions(
    links,
    conversions.filter((row) => (row.usr || HOUSE_KEY) === personKey).slice(0, RECENT_APPROVALS),
    submissions,
  );

  const theirLinks = links.filter((link) => (link.usr || HOUSE_KEY) === personKey);

  return (
    <div className="w-full">
      <Link
        href={period === 'month' ? '/' : `/?period=${period}`}
        className="btn-quiet btn-sm"
      >
        {isAdmin ? '← Back to all people' : '← Back to your dashboard'}
      </Link>

      <div className="rise mt-6 flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
        <div className="flex min-w-0 items-center gap-5">
          <span aria-hidden className="disc h-20 w-20 flex-none text-[26px]">
            {usr ? initialsOf(name) : 'H'}
          </span>
          <div className="min-w-0">
            {/* A tracking key can be one long unbreakable word, and the avatar
                has already taken 80px of a 320px screen. */}
            <h1 className="font-display leading-[1.05] text-[clamp(1.625rem,6vw,2.875rem)]">
              {name}
            </h1>
            <p className="mt-1.5 text-[20px] text-ink-soft">
              {usr ? `Tracking key usr=${usr}` : 'Clicks that arrived with no usr'} ·{' '}
              {theirLinks.length} link{theirLinks.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        {/* Period filter — same windows as the dashboard, kept in the URL. */}
        <nav aria-label="Period" className="flex flex-wrap gap-3">
          {PERIODS.map((option) => (
            <Link
              key={option.key}
              href={
                option.key === 'month'
                  ? `/affiliate/${encodeURIComponent(personKey)}`
                  : `/affiliate/${encodeURIComponent(personKey)}?period=${option.key}`
              }
              className="pill-filter relative"
              data-active={option.key === period}
              aria-current={option.key === period ? 'page' : undefined}
            >
              {option.label}
              {/* Same page, different query string: no route change, so no
                  skeleton. The pill says it is working instead. */}
              <LinkPending />
            </Link>
          ))}
        </nav>
      </div>

      <section className="rise panel mt-5 grid gap-10 p-6 sm:p-8 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h2 className="label-cap">
            {usr ? `${name.split(' ')[0]}'s earnings` : 'House earnings'} ·{' '}
            {periodLabel.toLowerCase()}
          </h2>
          {/* See the dashboard hero: clamped so a long total cannot widen the page. */}
          <p className="tnum mt-4 font-display leading-[0.95] text-[clamp(2rem,9vw,5.125rem)]">
            {formatMoney(view.totals.earnings)}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <span className="chip chip-gold">{view.totals.approved} approved</span>
            <span className="text-[20px] text-ink-soft">
              from {view.totals.visits.toLocaleString()} visit
              {view.totals.visits === 1 ? '' : 's'}
              {view.rows.length > 0
                ? `, across ${view.rows.length} card${view.rows.length === 1 ? '' : 's'}`
                : ''}
            </span>
          </div>
          <p className="plain-note mt-6">
            {view.rows.length === 0
              ? 'Nothing landed in this window. Try a longer period. The numbers below follow the same dates.'
              : `Everything here is ${usr ? `${name}'s` : 'house'} traffic only. Visits count when the click happens, approvals on the day they were approved.`}
          </p>
        </div>

        <EarningsChart series={view.series} />
      </section>

      {/* Per card — the reason this page exists. Cards rather than a table:
          three or four numbers per row reads better stacked than columned. */}
      <section className="rise panel mt-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
          <h2 className="font-display text-[32px]">Card by card</h2>
          <span className="text-[19px] text-ink-soft">{periodLabel}</span>
        </div>

        {view.rows.length === 0 ? (
          <p className="py-12 text-center text-[19px] text-ink-soft">
            No visits or approvals in this window.
          </p>
        ) : (
          <>
            <ul className="mt-5 flex flex-col gap-4">
              {view.rows.map((row) => {
                const earned = row.earnings > 0;
                return (
                  <li
                    key={row.key}
                    className={`${
                      earned ? 'card-row-lit' : 'card-row'
                    } grid gap-x-6 gap-y-4 p-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_130px_170px_200px] lg:items-center`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[24px] font-semibold" title={row.card}>
                        {row.card}
                      </p>
                      <p className="mt-0.5 text-[18px] text-ink-soft">
                        {row.approved > 0
                          ? `Earning · ${formatPercent(row.approvalRate, 1)} approved`
                          : 'No approvals yet'}
                      </p>
                    </div>
                    <CardStat label="Visits" value={row.visits.toLocaleString()} />
                    <CardStat label="Approved" value={row.approved.toLocaleString()} muted={row.approved === 0} />
                    <CardStat
                      label="Earnings"
                      value={formatMoney(row.earnings)}
                      muted={!earned}
                      display
                    />
                  </li>
                );
              })}
            </ul>

            <div className="mt-5 grid gap-x-6 gap-y-2 border-t-2 border-edge px-1 pt-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_130px_170px_200px] lg:items-center">
              <p className="text-[21px] font-bold">
                Total across {view.rows.length} card{view.rows.length === 1 ? '' : 's'}
              </p>
              <CardStat label="Visits" value={view.totals.visits.toLocaleString()} />
              <CardStat label="Approved" value={view.totals.approved.toLocaleString()} />
              <div className="lg:text-right">
                <span className="label-cap block">Earnings</span>
                <span className="mark tnum mt-1 inline-block font-display text-[32px] font-bold">
                  {formatMoney(view.totals.earnings)}
                </span>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Their approvals, all time — the rows behind the earnings figure */}
      <section className="rise panel mt-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
          <h2 className="font-display text-[32px]">{usr ? `${name}'s approvals` : 'House approvals'}</h2>
          <span className="text-[19px] text-ink-soft">All time</span>
        </div>

        {theirApprovals.length === 0 ? (
          <p className="py-10 text-center text-[19px] text-ink-soft">
            None recorded for {name} yet.
          </p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {theirApprovals.map((row) => (
              <li
                key={row.id}
                className="card-row-lit flex flex-wrap items-center gap-x-6 gap-y-4 p-5 sm:px-6"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[22px] font-semibold">{row.card}</span>
                  {/* Who the approval was for. A dash means the report row
                      carried no var3, or one that matches no lead here. */}
                  <span className="mt-0.5 block truncate text-[18px]">
                    <span className="text-ink-soft">Client </span>
                    <span className={row.client === '-' ? 'text-ink-dim' : 'font-semibold'}>
                      {row.client}
                    </span>
                    {row.note ? <span className="text-ink-soft"> · {row.note}</span> : null}
                  </span>
                </span>
                <span className="text-[19px] text-ink-soft">{formatDay(row.approvedOn)}</span>
                <span className="tnum min-w-[110px] text-right font-display text-[30px] font-semibold">
                  {formatMoney(row.amount)}
                </span>
                {isAdmin ? <DeleteApproval id={row.id} label={`${name} · ${row.card}`} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CardStat({
  label,
  value,
  muted = false,
  display = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
  display?: boolean;
}) {
  return (
    <div className="lg:text-right">
      <span className="label-cap block">{label}</span>
      <span
        className={`tnum mt-1 block font-semibold ${
          display ? 'font-display text-[32px]' : 'text-[30px]'
        } ${muted ? 'text-ink-dim' : 'text-ink'}`}
      >
        {value}
      </span>
    </div>
  );
}
