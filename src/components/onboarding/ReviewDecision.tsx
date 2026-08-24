'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BusyLabel } from '@/components/Spinner';
import { reviewProblems, type Approval, type ReviewDecision as Decision } from '@/lib/approval';

/**
 * Approve, decline, or put it back in the queue.
 *
 * The decision and the email are reported separately on purpose. Approving
 * somebody and failing to tell them are two different outcomes, and a control
 * that says only "saved" would hide the second one until the affiliate asked
 * why they had never heard anything.
 */
export function ReviewDecision({
  userId,
  approval,
  hasEmail,
  paperworkComplete,
}: {
  userId: string;
  approval: Approval;
  /** False when there is no address to send to, which is worth saying before
   *  the button is pressed rather than after. */
  hasEmail: boolean;
  /** False when the required steps are not all done. Approving anyway is
   *  allowed; doing it unawares is not. */
  paperworkComplete: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState(approval.note);
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [result, setResult] = useState<{ emailed: boolean; problem: string } | null>(null);

  async function decide(decision: Decision) {
    setError(null);
    setFieldError(null);
    setResult(null);

    const problems = reviewProblems({ decision, note });
    if (problems.note) {
      setFieldError(problems.note);
      return;
    }

    setBusy(decision);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(userId)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'That did not save.');
        if (data.fields?.note) setFieldError(data.fields.note);
        return;
      }
      setResult({ emailed: data.emailed === true, problem: data.emailProblem || '' });
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  const decided = approval.status !== 'pending';

  return (
    <div>
      {error ? (
        <p role="alert" className="warn-note mb-4">
          <span aria-hidden className="warn-note-mark">
            ⚠
          </span>
          <span>{error}</span>
        </p>
      ) : null}

      {result ? (
        <p
          className={`mb-4 rounded-[3px] border p-3 text-[13px] ${
            result.emailed
              ? 'border-leaf-edge bg-leaf-wash text-leaf-text'
              : 'border-gold-edge bg-gold-faint text-gold-deep'
          }`}
          role="status"
        >
          {result.emailed
            ? 'Saved, and the approval email has gone out.'
            : `Saved. ${result.problem || 'No email was sent.'}`}
        </p>
      ) : null}

      {!paperworkComplete ? (
        <p className="plain-note mb-4">
          Their paperwork is not finished yet. You can still approve the account, but there may be
          nothing to read.
        </p>
      ) : null}

      <label className="block">
        <span className="field-label">
          {approval.status === 'declined' ? 'Reason they were declined' : 'Note'}
        </span>
        <textarea
          className="field mt-1.5 min-h-[72px] py-2"
          rows={3}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setFieldError(null);
          }}
          placeholder="Required to decline. They see this."
          aria-invalid={fieldError ? true : undefined}
        />
        <span className="field-note">
          Shown to them on their waiting page. An approval note also goes into the email.
        </span>
        {fieldError ? <span className="field-error">{fieldError}</span> : null}
      </label>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {approval.status === 'approved' ? null : (
          <button
            type="button"
            className="btn-gold"
            onClick={() => decide('approved')}
            disabled={busy !== null}
            aria-busy={busy === 'approved'}
          >
            <BusyLabel
              busy={busy === 'approved'}
              idle="Approve and email them"
              busyLabel="Approving…"
            />
          </button>
        )}

        {approval.status === 'declined' ? null : (
          <button
            type="button"
            className="btn-outline"
            onClick={() => decide('declined')}
            disabled={busy !== null}
            aria-busy={busy === 'declined'}
          >
            <BusyLabel busy={busy === 'declined'} idle="Decline" busyLabel="Declining…" />
          </button>
        )}

        {decided ? (
          <button
            type="button"
            className="btn-quiet btn-sm"
            onClick={() => decide('pending')}
            disabled={busy !== null}
            aria-busy={busy === 'pending'}
          >
            <BusyLabel busy={busy === 'pending'} idle="Put back in the queue" busyLabel="Saving…" />
          </button>
        ) : null}
      </div>

      {!hasEmail ? (
        <p className="plain mt-3">
          This account has no email address, so approving it cannot notify anyone. Add one on their
          details step first if you want them told.
        </p>
      ) : null}
    </div>
  );
}
