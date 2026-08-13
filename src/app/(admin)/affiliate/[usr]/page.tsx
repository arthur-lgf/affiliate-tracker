import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DeleteApproval } from '@/components/DeleteApproval';
import { EarningsChart } from '@/components/EarningsChart';
import { ErrorPanel } from '@/components/ErrorPanel';
import {
  buildEarnings,
  describeConversions,
  formatMoney,
  formatPercent,
  HOUSE_KEY,
  initialsOf,
  PERIODS,
  type Period,
} from '@/lib/analytics';
import { loadAll } from '@/lib/load';
import { normalizeKey } from '@/lib/validate';

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

  const { links, visits, conversions, error } = await loadAll();
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

  const theirApprovals = describeConversions(
    links,
    conversions.filter((row) => (row.usr || HOUSE_KEY) === personKey).slice(0, RECENT_APPROVALS),
  );

  const theirLinks = links.filter((link) => (link.usr || HOUSE_KEY) === personKey);

  return (
    <div className="w-full">
      <Link
        href={period === 'month' ? '/' : `/?period=${period}`}
        className="text-[12.5px] text-sage transition-colors hover:text-cream"
      >
        ← All people
      </Link>

      <div className="rise mt-4 flex flex-wrap items-center gap-3.5">
        <span aria-hidden className="disc h-[46px] w-[46px] flex-none text-[14px]">
          {usr ? initialsOf(name) : '—'}
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-[30px] leading-tight">{name}</h1>
          <p className="mt-0.5 text-[12px] text-sage-dim">
            {usr ? `usr=${usr}` : 'clicks that arrived with no usr'} ·{' '}
            {theirLinks.length} link{theirLinks.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* Period filter — same windows as the dashboard, kept in the URL. */}
      <section className="rise mt-4 flex flex-wrap gap-2">
        {PERIODS.map((option) => (
          <Link
            key={option.key}
            href={
              option.key === 'month'
                ? `/affiliate/${encodeURIComponent(personKey)}`
                : `/affiliate/${encodeURIComponent(personKey)}?period=${option.key}`
            }
            className="pill-action"
            data-active={option.key === period}
            aria-current={option.key === period ? 'page' : undefined}
          >
            {option.label}
          </Link>
        ))}
      </section>

      <section className="rise panel mt-4 grid gap-8 p-6 sm:p-7 lg:grid-cols-[330px_1fr] lg:gap-8">
        <div>
          <p className="label-micro">Earnings · {periodLabel}</p>
          <p className="tnum mt-4 font-display text-[62px] leading-[0.9] sm:text-[72px]">
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
            {view.rows.length === 0
              ? 'Nothing in this window. Try a longer period.'
              : `Across ${view.rows.length} card${view.rows.length === 1 ? '' : 's'}.`}
          </p>
        </div>

        <EarningsChart series={view.series} />
      </section>

      {/* Per card — the reason this page exists */}
      <section className="rise panel mt-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 className="font-display text-[22px]">By card</h2>
          <span className="text-xs text-sage">{periodLabel}</span>
        </div>

        {view.rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-sage-dim">
            No visits or approvals in this window.
          </p>
        ) : (
          <div className="mt-4 -mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[480px] border-collapse text-left">
              <thead>
                <tr className="border-b border-pine-line">
                  <Th>Card</Th>
                  <Th align="right">Visits</Th>
                  <Th align="right">Approved</Th>
                  <Th align="right">Total earnings</Th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.key} className="border-b border-pine-line last:border-0">
                    <td className="max-w-[320px] py-3.5 pr-4">
                      <span className="block truncate text-[13.5px] font-medium" title={row.card}>
                        {row.card}
                      </span>
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

      {/* Their approvals, all time — the rows behind the earnings figure */}
      <section className="rise panel mt-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 className="font-display text-[22px]">Their approvals</h2>
          <span className="text-xs text-sage">all time</span>
        </div>

        {theirApprovals.length === 0 ? (
          <p className="py-8 text-center text-sm text-sage-dim">
            None recorded for {name} yet.
          </p>
        ) : (
          <ul className="mt-2">
            {theirApprovals.map((row) => (
              <li
                key={row.id}
                className="divider-row flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-[13px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{row.card}</span>
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
                <DeleteApproval id={row.id} label={`${name} · ${row.card}`} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`label-micro pb-2.5 pr-4 font-medium ${
        align === 'right' ? 'text-right last:pr-0' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}
