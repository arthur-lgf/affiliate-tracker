import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorPanel } from '@/components/ErrorPanel';
import { PayslipActions } from '@/components/PayslipActions';
import { PayslipCards } from '@/components/PayslipCards';
import { formatMoney } from '@/lib/analytics';
import { COMPANY } from '@/lib/agreement';
import { loadAll } from '@/lib/load';
import { shortDay } from '@/lib/payout';
import {
  payoutsEnabled,
  readPayoutRequest,
  type PayoutRequestRecord,
} from '@/lib/payout-request-store';
import { isRequestId, payslipLines, receiptHref, statusChip } from '@/lib/payslip-view';
import { BLANK } from '@/lib/report-table';
import { findUserById } from '@/lib/users';
import { requireViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Payslip' };

/**
 * One payslip, as a document: one payout request.
 *
 * Set as a statement rather than as a screen: a masthead, the two parties, a
 * ruled table of the cards asked for, and a total. People send these to
 * landlords and accountants, so it has a URL of its own and prints without the
 * navigation around it, and what it prints is what is on the screen rather than
 * a second rendering that could disagree with it.
 *
 * The table is the request's own record, not a fresh reading of the approvals.
 * Every amount on it, and the total under them, was fixed the moment the
 * request was made, so the document says the same thing on the day it is paid
 * as on the day it was asked for. The approvals are read only to put a card and
 * a customer beside each amount.
 *
 * A request id is a small number anybody could guess, so the record is read on
 * behalf of the viewer: their own id goes into the query, and a request that is
 * not theirs is never fetched at all. It comes back as nothing, which is a 404,
 * the same page as an id that does not exist.
 */
export default async function PayslipPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const viewer = await requireViewer();

  if (viewer.role === 'admin' || !viewer.id) {
    return (
      <div className="mx-auto w-full max-w-[900px]">
        <h1 className="font-display text-[26px] leading-[1.05]">Payslip</h1>
        <p className="panel mt-5 p-5 text-[13px] text-ink-soft">
          This account is not paid through Ledger, so it has no payslips.{' '}
          <Link href="/payouts" className="link-text font-medium">
            Payouts
          </Link>{' '}
          has everybody else&rsquo;s requests.
        </p>
      </div>
    );
  }

  // Not a request id at all, such as a bookmark from the old pay periods. A
  // 404 before anything is read.
  if (!isRequestId(requestId)) notFound();

  if (!payoutsEnabled()) {
    return (
      <ErrorPanel
        title="Payslips need a database"
        message="Payments are recorded in Supabase. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then reload this page."
        hint=""
      />
    );
  }

  /*
   * Started now and awaited once the request is known to exist, so a real
   * payslip does not wait for one read to finish before the other begins.
   * loadAll never throws; it hands its failure back as `error`.
   */
  const loading = loadAll(viewer);

  let record: PayoutRequestRecord | null = null;
  let fullName = viewer.username;
  let email = '';
  let readError: string | null = null;
  try {
    const [found, account] = await Promise.all([
      readPayoutRequest(requestId, viewer.id),
      findUserById(viewer.id),
    ]);
    record = found;
    fullName = account?.fullName || viewer.username;
    email = account?.email ?? '';
  } catch (caught) {
    readError = caught instanceof Error ? caught.message : 'Could not read this payslip.';
  }

  if (readError) {
    return <ErrorPanel title="Could not read this payslip" message={readError} hint="" />;
  }
  if (!record) notFound();

  const { links, conversions, submissions, error } = await loading;
  const lines = payslipLines(record.items, { links, conversions, submissions });
  const chip = statusChip(record.status);
  const cancelled = record.status === 'cancelled';

  return (
    <div className="mx-auto w-full max-w-[900px]">
      <div className="no-print flex flex-wrap items-center justify-between gap-4">
        <Link href="/payslips" className="link-text text-[13px] font-medium">
          Back to my payslips
        </Link>
        <PayslipActions
          requestId={record.id}
          paid={Boolean(record.paidAt)}
          confirmed={Boolean(record.confirmedAt)}
        />
      </div>

      {/* The amounts do not depend on this read, only the card and customer
          names do, so the document still renders beneath it. */}
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
            <dt className="field-label">Requested</dt>
            <dd className="tnum mt-1 text-[13px] text-ink">{shortDay(record.requestedAt)}</dd>
          </div>
        </dl>

        <h2 className="mt-7 text-[13px] font-semibold text-ink">Cards on this request</h2>
        <p className="mt-1 text-[12px] text-ink-dim">
          The cards chosen for this payment, and what each one was worth when it was requested.
        </p>

        {lines.length === 0 ? (
          <p className="panel-sunk mt-3 px-5 py-10 text-center text-[13px] text-ink-soft">
            No cards are recorded on this request.
          </p>
        ) : (
          <PayslipCards lines={lines} total={record.totalAmount} />
        )}

        <div className="mt-7 grid gap-5 border-t border-edge pt-5 sm:grid-cols-3">
          <div>
            <span className="field-label">Status</span>
            <p className="mt-1.5">
              <span className={`chip ${chip.className}`}>{chip.label}</span>
            </p>
          </div>

          <div>
            <span className="field-label">Payment</span>
            <p className="tnum mt-1.5 text-[13px] text-ink">
              {record.paidAt ? shortDay(record.paidAt) : cancelled ? 'Not sent' : 'Not yet sent'}
              {record.paidAt && record.amount !== null ? (
                <span className="block text-[12px] text-ink-dim">Sent {formatMoney(record.amount)}</span>
              ) : null}
              {record.reference ? (
                <span className="block text-[12px] text-ink-dim">Ref {record.reference}</span>
              ) : null}
            </p>
          </div>

          <div>
            <span className="field-label">Payment proof</span>
            <p className="mt-1.5 text-[13px]">
              {record.proof ? (
                <a
                  href={receiptHref(record.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="link-text font-medium"
                >
                  View receipt
                </a>
              ) : (
                <span className="text-ink-dim">
                  {cancelled ? 'None, as nothing was sent' : 'Awaiting proof from an admin'}
                </span>
              )}
            </p>
          </div>
        </div>

        {record.note ? <p className="plain mt-5 text-[12px]">{record.note}</p> : null}

        <p className="plain mt-5 text-[12px]">
          These are the cards chosen for this request. The amount is fixed at the moment you requested
          it.
        </p>
        {cancelled ? (
          <p className="plain mt-2 text-[12px]">
            This request was cancelled. Its cards can be requested again once they are put on a new
            request.
          </p>
        ) : null}
      </article>
    </div>
  );
}
