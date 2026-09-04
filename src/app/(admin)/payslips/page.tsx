import type { Metadata } from 'next';
import Link from 'next/link';
import { ErrorPanel } from '@/components/ErrorPanel';
import { formatMoney } from '@/lib/analytics';
import { loadAll } from '@/lib/load';
import { readProgress } from '@/lib/onboarding-store';
import {
  anchorFor,
  hasAnchor,
  linesIn,
  PAYOUT_DAYS,
  periodLabel,
  periodsThrough,
  shortDay,
  statusOf,
  totalOf,
} from '@/lib/payout';
import { listPayoutsFor, payoutsEnabled, type PayoutRecord } from '@/lib/payout-store';
import { findUserById } from '@/lib/users';
import { requireViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'My payslip' };

/**
 * Your own pay history.
 *
 * One card per 45-day cycle, newest first, because the one at the top is the
 * one somebody is waiting on. Each says what the period came to, when it is
 * paid, and where the payment has got to. The payslip itself is a page of its
 * own, so it has a URL that can be sent on and printed without the navigation
 * around it.
 *
 * Nothing on this page or the one behind it names a percentage or a merchant
 * rate. What an affiliate is shown is their own money, per approval and in
 * total, which is the only figure that means anything to the person being paid.
 */
export default async function PayslipsPage() {
  const viewer = await requireViewer();
  const today = new Date().toISOString().slice(0, 10);

  /*
   * An admin has no payslips: they are not paid through this. Rather than a
   * blank page, the door to the other side of the same records.
   */
  if (viewer.role === 'admin' || !viewer.id) {
    return (
      <div className="mx-auto w-full max-w-[900px]">
        <h1 className="font-display text-[26px] leading-[1.05]">My payslip</h1>
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

  if (!payoutsEnabled()) {
    return (
      <ErrorPanel
        title="Payslips need a database"
        message="Payments are recorded in Supabase. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then reload this page."
      />
    );
  }

  const { conversions, error } = await loadAll(viewer);

  let records: PayoutRecord[] = [];
  let signedAt: string | null = null;
  let bypassedAt: string | null = null;
  let createdAt = '';
  let readError: string | null = null;
  try {
    const [progress, account, paid] = await Promise.all([
      readProgress(viewer.id),
      findUserById(viewer.id),
      listPayoutsFor(viewer.id),
    ]);
    signedAt = progress.signedAt.agreement;
    bypassedAt = progress.bypass.at;
    createdAt = account?.createdAt ?? '';
    records = paid;
  } catch (caught) {
    readError = caught instanceof Error ? caught.message : 'Could not read your payments.';
  }

  const anchor = anchorFor({ agreementSignedAt: signedAt, bypassedAt, createdAt });
  const byPeriod = new Map(records.map((row) => [row.periodStart, row]));
  const periods = hasAnchor(anchor) ? periodsThrough(anchor.day, today) : [];

  return (
    <div className="mx-auto w-full max-w-[900px]">
      <div className="rise">
        <h1 className="font-display text-[26px] leading-[1.05]">My payslip</h1>
        <p className="plain mt-2.5">
          Your pay history. Open a period to see the payslip and the approvals behind it. Each one
          runs {PAYOUT_DAYS} days from{' '}
          {anchor.source === 'joined' ? 'the day you joined' : 'the day you signed'}
          {hasAnchor(anchor) ? `, ${shortDay(anchor.day)}` : ''}.
        </p>
      </div>

      {error ? (
        <div className="mt-5">
          <ErrorPanel title="Could not read your approvals" message={error} />
        </div>
      ) : null}
      {readError ? (
        <div className="mt-5">
          <ErrorPanel title="Could not read your payments" message={readError} />
        </div>
      ) : null}

      {periods.length === 0 && !readError ? (
        <p className="panel mt-5 px-5 py-14 text-center text-[13px] text-ink-soft">
          Your pay periods start once your agreement is signed. Nothing is missing: there is simply
          no clock running yet.
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-4">
        {periods.map((period) => {
          const lines = linesIn(period, conversions);
          const total = totalOf(lines);
          const record = byPeriod.get(period.from) ?? null;
          const status = statusOf(period, today, record?.paidAt ?? null);

          return (
            <section key={period.from} className="panel p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <div>
                  <h2 className="tnum text-[16px] font-semibold text-ink">{periodLabel(period)}</h2>
                  <p className="mt-0.5 text-[12px] text-ink-dim">
                    Payday {shortDay(period.to)}
                    {record?.paidAt ? `, paid ${shortDay(record.paidAt)}` : ''}
                  </p>
                </div>
                <p className="tnum text-[22px] font-semibold leading-none text-ink">
                  {formatMoney(total)}
                </p>
              </div>

              {/*
                The three states worth reporting, each said in words as well as
                marked. The picture this is modelled on carries four columns of
                approval chrome; these are the ones that are true here.
              */}
              <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4 border-t border-edge-faint pt-4">
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
                  <span className="field-label">Payment proof</span>
                  <p className="mt-1.5">
                    {record?.proof ? (
                      <a
                        href={`/api/payouts/receipt?user=${encodeURIComponent(viewer.id)}&period=${period.from}`}
                        target="_blank"
                        rel="noreferrer"
                        className="link-text text-[13px] font-medium"
                      >
                        View receipt
                      </a>
                    ) : (
                      <span className="text-[13px] text-ink-dim">Awaiting proof</span>
                    )}
                  </p>
                </div>

                <div>
                  <span className="field-label">Confirmed by you</span>
                  <p className="mt-1.5 text-[13px]">
                    {record?.confirmedAt ? (
                      <span className="font-medium text-leaf-text">Yes</span>
                    ) : (
                      <span className="text-ink-dim">Not yet</span>
                    )}
                  </p>
                </div>

                <div className="ml-auto">
                  <Link href={`/payslips/${period.from}`} className="btn-outline btn-sm">
                    View payslip
                  </Link>
                </div>
              </div>

              <p className="mt-3 text-[12px] text-ink-dim">
                {lines.length === 0
                  ? 'No approvals in this period yet.'
                  : lines.length === 1
                    ? '1 approved customer'
                    : `${lines.length} approved customers`}
              </p>
            </section>
          );
        })}
      </div>
    </div>
  );
}
