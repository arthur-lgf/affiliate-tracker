import type { Metadata } from 'next';
import { CpaBrowser } from '@/components/CpaBrowser';
import { CpaUpload } from '@/components/CpaUpload';
import { EmptyState } from '@/components/EmptyState';
import { ErrorPanel } from '@/components/ErrorPanel';
import { formatDateTime, formatDay } from '@/lib/analytics';
import { getStore } from '@/lib/store';
import { requireViewer } from '@/lib/viewer';
import type { CpaReport } from '@/lib/types';

/**
 * The CPA rate card.
 *
 * Readable by everyone signed in, on purpose: an affiliate quoting a card needs
 * to know what it pays as much as an admin does, and none of it is anybody's
 * personal data. Replacing it is admin only, because these are the numbers the
 * whole team quotes from.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'CPA report' };

export default async function CpaPage() {
  const viewer = await requireViewer();
  const isAdmin = viewer.role === 'admin';

  let report: CpaReport | null = null;
  let error: string | null = null;
  try {
    report = await getStore().readCpaReport();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'Unknown storage error';
  }

  const rates = report?.rows ?? [];
  const cards = new Set(rates.map((rate) => `${rate.issuer}|${rate.card}`)).size;
  // One placement today, but the export has a column for it, so read it rather
  // than assume it. Shown once here instead of repeated down every row.
  const placements = [...new Set(rates.map((rate) => rate.placement).filter(Boolean))];
  // Only what the table draws crosses to the browser.
  const rows = rates.map(({ placement: _placement, ...rate }) => rate);

  return (
    <div className="w-full">
      <div className="rise">
        <h1 className="font-display leading-[1.05] text-[clamp(1.75rem,7vw,3rem)]">CPA report</h1>
        <p className="mt-3 max-w-[720px] text-[20px] leading-relaxed text-ink-soft">
          What each card pays for an approval, and half of it beside, which is what the affiliate
          keeps. Where a card is tiered, every tier is listed separately, because the tier is what
          decides the payout.
        </p>
      </div>

      {error ? (
        <div className="mt-5">
          <ErrorPanel title="Could not read the rate card" message={error} />
        </div>
      ) : null}

      <section className="rise panel mt-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
          <h2 className="font-display text-[32px]">
            {rows.length === 0 ? 'Nothing uploaded yet' : `${cards.toLocaleString()} cards`}
          </h2>
          {/* When the rates were read, and when they were put here. Both,
              because they answer different questions: the report day is how
              current the rates are, and the upload is how current this page is
              — and a stale upload of a fresh report is the failure worth
              seeing. */}
          <span className="text-[19px] text-ink-soft">
            {report?.updatedAt
              ? `Updated ${formatDateTime(report.updatedAt)}${
                  report.updatedBy ? ` by ${report.updatedBy}` : ''
                }`
              : 'Never updated'}
          </span>
        </div>

        {report?.reportDate || report?.source ? (
          <p className="plain-note mt-2">
            {report.reportDate ? `Rates as QMP read them on ${formatDay(report.reportDate)}` : ''}
            {report.reportDate && report.source ? ' · ' : ''}
            {report.source ? `from ${report.source}` : ''}
            {placements.length > 0 ? ` · ${placements.join(', ')}` : ''}
          </p>
        ) : null}

        {isAdmin ? <CpaUpload /> : null}

        {rows.length === 0 && !error ? (
          <div className="mt-6">
            {isAdmin ? (
              <EmptyState
                title="No rate card here yet"
                body="Export the CPA report from QMP, save it as CSV, and upload it above. Everyone signed in will be able to read it."
              />
            ) : (
              <EmptyState
                title="No rate card here yet"
                body="Your admin has not uploaded one. Once they do, every card and what it pays will be listed here."
              />
            )}
          </div>
        ) : (
          <CpaBrowser rows={rows} />
        )}
      </section>
    </div>
  );
}
