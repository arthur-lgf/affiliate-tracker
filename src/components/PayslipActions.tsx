'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BusyLabel } from './Spinner';

/**
 * The two things somebody can do with their own payslip.
 *
 * Saving it is the browser's print dialogue rather than a file this app
 * renders, and that is deliberate: a payslip is a statement of what somebody
 * was paid, and the safest version of it is the one they are looking at. A
 * second renderer is a second chance for the document and the page to disagree
 * about a number, on the one document where that matters most.
 *
 * Confirming is the affiliate's own mark on the record. It is only offered once
 * a payment has actually been recorded, because "did it arrive" is not a
 * question anybody can answer about money nobody has sent.
 */
export function PayslipActions({
  periodStart,
  paid,
  confirmed,
}: {
  periodStart: string;
  paid: boolean;
  confirmed: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/payslips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', periodStart }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          payload.hint ? `${payload.error} ${payload.hint}` : payload.error ?? 'That did not save.',
        );
      }
      setDone(true);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="no-print flex flex-wrap items-center gap-3">
        <button type="button" className="btn-outline btn-sm" onClick={() => window.print()}>
          Save as PDF
        </button>

        {paid && !confirmed && !done ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={busy}
            aria-busy={busy}
            onClick={confirm}
          >
            <BusyLabel busy={busy} idle="Confirm it arrived" busyLabel="Saving…" />
          </button>
        ) : null}

        {confirmed || done ? (
          <span role="status" className="text-[13px] font-semibold text-leaf-text">
            You confirmed this payment arrived.
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="field-error no-print">
          {error}
        </p>
      ) : null}
    </>
  );
}
