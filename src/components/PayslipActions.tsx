'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
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
 *
 * A payslip is one payout request now, so what is confirmed is named by the
 * request's id. Whose request it is still comes from the session on the server,
 * never from this body: the id says which, the session says whether they may.
 *
 * PayslipActions calls useRouter, which cannot be mounted outside a Next
 * request, so what it draws is exported on its own as PayslipActionsView,
 * taking its state as props. That is what scripts/payslip-render-checks.tsx
 * renders to see the busy and confirmed states without clicking towards them.
 */
export function PayslipActions({
  requestId,
  paid,
  confirmed,
}: {
  requestId: string;
  paid: boolean;
  confirmed: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /*
   * A ref, not the button. The button is never disabled while it saves (see the
   * view), and a double click lands both clicks before React renders anyway. A
   * second confirmation would say the same thing, but it is a second write.
   */
  const sending = useRef(false);

  async function confirm() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/payslips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', requestId }),
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
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <PayslipActionsView
      paid={paid}
      confirmed={confirmed}
      done={done}
      busy={busy}
      error={error}
      onConfirm={confirm}
    />
  );
}

/**
 * The two buttons and what they say, drawn from props alone.
 *
 * While it saves, Confirm is marked busy rather than disabled. It has the
 * keyboard, since Enter was just pressed on it, and a focused button that turns
 * disabled throws focus back to the top of the page. Once it has worked, the
 * button is replaced by the sentence saying so, and focus follows it there for
 * the same reason: the control that had it is gone.
 */
export function PayslipActionsView({
  paid,
  confirmed,
  done,
  busy,
  error,
  onConfirm,
}: {
  paid: boolean;
  confirmed: boolean;
  /** Confirmed from this page just now, as opposed to before it loaded. */
  done: boolean;
  busy: boolean;
  /** The server's refusal, word for word, or null. */
  error: string | null;
  onConfirm: () => void;
}) {
  const outcome = useRef<HTMLSpanElement | null>(null);

  // Only for a confirmation made here. A payslip confirmed before the page
  // loaded does not take the keyboard from wherever it is.
  useEffect(() => {
    if (done) outcome.current?.focus();
  }, [done]);

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
            aria-disabled={busy || undefined}
            aria-busy={busy}
            onClick={busy ? undefined : onConfirm}
          >
            <BusyLabel busy={busy} idle="Confirm it arrived" busyLabel="Saving…" />
          </button>
        ) : null}

        {confirmed || done ? (
          <span
            ref={outcome}
            tabIndex={-1}
            role="status"
            className="text-[13px] font-semibold text-leaf-text"
          >
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
