import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorPanel } from '@/components/ErrorPanel';
import { PayslipActions } from '@/components/PayslipActions';
import { describeConversions, formatMoney } from '@/lib/analytics';
import { COMPANY } from '@/lib/agreement';
import { loadAll } from '@/lib/load';
import { readProgress } from '@/lib/onboarding-store';
import {
  anchorFor,
  hasAnchor,
  isDay,
  linesIn,
  periodAt,
  periodLabel,
  shortDay,
  statusOf,
  totalOf,
} from '@/lib/payout';
import { payoutsEnabled, readPayout, type PayoutRecord } from '@/lib/payout-store';
import { findUserById } from '@/lib/users';
import { BLANK } from '@/lib/report-table';
import { requireViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Payslip' };

/**
 * One payslip, as a document.
 *
 * Set as a statement rather than as a screen: a masthead, the two parties, a
 * ruled table of what was earned, and a total. People send these to landlords
 * and accountants, so it has a URL of its own and prints without the navigation
 * around it, and what it prints is what is on the screen rather than a second
 * rendering that could disagree with it.
 *
 * The table is what a payslip is actually for: not "you were paid $284.22" but
 * which approvals that is, one line each, with the customer and the card. Every
 * line is the affiliate's own money. Nothing here says what the merchant paid,
 * or what share of it this is.
 */
export default async function PayslipPage({ params }: { params: Promise<{ period: string }> }) {
  const { period: periodStart } = await params;
  const viewer = await requireViewer();
  const today = new Date().toISOString().slice(0, 10);

  if (viewer.role === 'admin' || !viewer.id) {
    return (
      <div className="mx-auto w-full max-w-[900px]">
        <h1 className="font-display text-[26px] leading-[1.05]">Payslip</h1>
        <p className="panel mt-5 p-5 text-[13px] text-ink-soft">
          This account is not paid through Ledger, so it has no payslips.{' '}
          <Link href="/payouts" className="link-text font-medium">
            The payout schedule
          </Link>{' '}
          has everybody else&rsquo;s.
        </p>
      </div>
    );
  }

  if (!isDay(periodStart)) notFound();

  if (!payoutsEnabled()) {
    return (
      <ErrorPanel
        title="Payslips need a database"
        message="Payments are recorded in Supabase. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then reload this page."
      />
    );
  }

  const { links, submissions, conversions, settings, error } = await loadAll(viewer);

  let record: PayoutRecord | null = null;
  let signedAt: string | null = null;
  let bypassedAt: string | null = null;
  let createdAt = '';
  let fullName = viewer.username;
  let email = '';
  let readError: string | null = null;
  try {
    const [progress, account, paid] = await Promise.all([
      readProgress(viewer.id),
      findUserById(viewer.id),
      readPayout(viewer.id, periodStart),
    ]);
    signedAt = progress.signedAt.agreement;
    bypassedAt = progress.bypass.at;
    createdAt = account?.createdAt ?? '';
    fullName = account?.fullName || viewer.username;
    email = account?.email ?? '';
    record = paid;
  } catch (caught) {
    readError = caught instanceof Error ? caught.message : 'Could not read your payments.';
  }

  const anchor = anchorFor({ agreementSignedAt: signedAt, bypassedAt, createdAt });
  const period = hasAnchor(anchor) ? periodAt(anchor.day, periodStart) : null;

  /*
   * A window that is not one of theirs is not a payslip. Checked against their
   * own schedule rather than merely parsed, so a hand-typed date in the URL
   * cannot produce an official-looking document for a period nobody worked.
   */
  if (!period || period.from !== periodStart) {
    if (readError) {
      return <ErrorPanel title="Could not read your payments" message={readError} />;
    }
    notFound();
  }

  const rows = describeConversions(links, conversions, submissions, {
    shares: settings.shares,
    // The rows from loadAll are already this viewer's own share. Saying so here
    // stops the decorator taking a share of a figure already shared once.
    gross: false,
  });
  const lines = linesIn(period, rows).sort((a, b) => a.approvedOn.localeCompare(b.approvedOn));
  const total = totalOf(lines.map((row) => ({ approvedOn: row.approvedOn, amount: row.affiliate })));
  const status = statusOf(period, today, record?.paidAt ?? null);

  return (
    <div className="mx-auto w-full max-w-[900px]">
      <div className="no-print flex flex-wrap items-center justify-between gap-4">
        <Link href="/payslips" className="link-text text-[13px] font-medium">
          Back to my payslips
        </Link>
        <PayslipActions
          periodStart={period.from}
          paid={Boolean(record?.paidAt)}
          confirmed={Boolean(record?.confirmedAt)}
        />
      </div>

      {error ? (
        <div className="no-print mt-5">
          <ErrorPanel title="Could not read your approvals" message={error} />
        </div>
      ) : null}

      <article className="panel mt-5 p-6 sm:p-9">
        {/* The masthead. A statement from the company that pays them, not from
            the software it was typed into. */}
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-edge pb-5">
          <div>
            <p className="flex items-center gap-2.5">
              <span aria-hidden className="h-[14px] w-[14px] flex-none bg-gold" />
              <span className="text-[15px] font-semibold tracking-[0.02em] text-ink">
                {COMPANY.name}
              </span>
            </p>
            <p className="label-cap mt-1.5">Affiliate operations</p>
          </div>
          <h1 className="font-display text-[22px] leading-none text-ink">Payslip</h1>
        </header>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="field-label">Affiliate</dt>
            <dd className="mt-1 text-[13px] text-ink">
              {fullName}
              {viewer.usr ? <span className="tnum text-ink-dim"> (usr={viewer.usr})</span> : null}
            </dd>
          </div>
          <div>
            <dt className="field-label">Email</dt>
            <dd className="mt-1 break-words text-[13px] text-ink">{email || BLANK}</dd>
          </div>
          <div>
            <dt className="field-label">Pay period</dt>
            <dd className="tnum mt-1 text-[13px] text-ink">{periodLabel(period)}</dd>
          </div>
          <div>
            <dt className="field-label">Payday</dt>
            <dd className="tnum mt-1 text-[13px] text-ink">{shortDay(period.to)}</dd>
          </div>
        </dl>

        <h2 className="mt-7 text-[13px] font-semibold text-ink">Approved customers</h2>
        <p className="mt-1 text-[12px] text-ink-dim">
          Every approval counted towards this period, and what each one earned you.
        </p>

        {lines.length === 0 ? (
          <p className="panel-sunk mt-3 px-5 py-10 text-center text-[13px] text-ink-soft">
            No approvals landed in this period. It runs to {shortDay(period.to)}.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <thead>
                <tr className="border-y border-edge bg-paper-card">
                  <th scope="col" className="label-cap px-3 py-2.5">
                    Approved
                  </th>
                  <th scope="col" className="label-cap px-3 py-2.5">
                    Customer
                  </th>
                  <th scope="col" className="label-cap px-3 py-2.5">
                    Card
                  </th>
                  <th scope="col" className="label-cap px-3 py-2.5 text-right">
                    You earned
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((row) => (
                  <tr key={row.id} className="divider-row">
                    <td className="tnum px-3 py-2.5 align-top text-[12px] text-ink-soft">
                      {shortDay(row.approvedOn)}
                    </td>
                    <td className="max-w-[220px] px-3 py-2.5 align-top text-[13px] font-medium text-ink">
                      {row.client}
                    </td>
                    <td className="max-w-[260px] px-3 py-2.5 align-top text-[12px] text-ink-soft">
                      {row.card || BLANK}
                    </td>
                    <td className="tnum px-3 py-2.5 align-top text-right text-[13px] font-semibold text-ink">
                      {formatMoney(row.affiliate)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-edge-strong">
                  <th
                    scope="row"
                    colSpan={2}
                    className="px-3 py-3 text-left text-[13px] font-semibold text-ink"
                  >
                    Total for this period
                  </th>
                  <td className="px-3 py-3 text-[12px] text-ink-dim">
                    {lines.length === 1 ? '1 approval' : `${lines.length} approvals`}
                  </td>
                  <td className="tnum mark px-3 py-3 text-right text-[16px] font-semibold text-ink">
                    {formatMoney(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="mt-7 grid gap-5 border-t border-edge pt-5 sm:grid-cols-3">
          <div>
            <span className="field-label">Period</span>
            <p className="mt-1.5">
              {status === 'paid' ? (
                <span className="chip chip-live">Paid</span>
              ) : status === 'due' ? (
                <span className="chip chip-gold">Awaiting payment</span>
              ) : (
                <span className="chip chip-quiet">Still earning</span>
              )}
            </p>
          </div>

          <div>
            <span className="field-label">Payment</span>
            <p className="tnum mt-1.5 text-[13px] text-ink">
              {record?.paidAt ? shortDay(record.paidAt) : 'Not yet sent'}
              {record?.reference ? (
                <span className="block text-[12px] text-ink-dim">Ref {record.reference}</span>
              ) : null}
            </p>
          </div>

          <div>
            <span className="field-label">Payment proof</span>
            <p className="mt-1.5 text-[13px]">
              {record?.proof ? (
                <a
                  href={`/api/payouts/receipt?user=${encodeURIComponent(viewer.id)}&period=${period.from}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link-text font-medium"
                >
                  View receipt
                </a>
              ) : (
                <span className="text-ink-dim">Awaiting proof from an admin</span>
              )}
            </p>
          </div>
        </div>

        {record?.note ? <p className="plain mt-5 text-[12px]">{record.note}</p> : null}

        <p className="plain mt-5 text-[12px]">
          This period covers approvals from {shortDay(period.from)} up to but not including{' '}
          {shortDay(period.to)}. Amounts can still change if an approval is added or reversed after
          a payment has gone out.
        </p>
      </article>
    </div>
  );
}
