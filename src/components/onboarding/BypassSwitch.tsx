'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BusyLabel } from '@/components/Spinner';
import { isBypassed, type Bypass } from '@/lib/approval';

/**
 * Letting somebody in without the paperwork, and taking it back.
 *
 * The wording is doing real work here. "Bypass onboarding" sounds like a
 * setting; what it actually does is hand somebody the dashboard on this
 * admin's say-so, before anyone has read a W-9 or an agreement. So the button
 * says what happens, the panel says what is still outstanding, and turning it
 * off says plainly that it will shut them out again.
 */
export function BypassSwitch({
  userId,
  bypass,
  outstanding,
}: {
  userId: string;
  bypass: Bypass;
  /** The required steps they still have not done. Named, because "waive the
   *  gate" reads very differently when it is one item and when it is all
   *  three. */
  outstanding: string[];
}) {
  const router = useRouter();
  const [note, setNote] = useState(bypass.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = isBypassed(bypass);

  async function set(next: boolean) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(userId)}/bypass`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ on: next, note }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'That did not save.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

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

      <p className="text-[13px] leading-relaxed text-ink-soft">
        {on
          ? 'This account is not gated. They reached the dashboard without finishing onboarding, and the four forms are on their profile to work through whenever they need to.'
          : 'Lets this person use the dashboard now, without finishing onboarding and without waiting to be approved. The forms stay on their profile and they can fill in whichever ones they need, in any order.'}
      </p>

      {outstanding.length > 0 ? (
        <p className="plain-note mt-3">
          Still outstanding: <strong>{outstanding.join(', ')}</strong>.{' '}
          {on
            ? 'Nothing is stopping them working, but a payment still needs the W-9 and their bank details.'
            : 'Waiving the gate does not collect any of it.'}
        </p>
      ) : (
        <p className="plain mt-3">Their required paperwork is all in.</p>
      )}

      <label className="mt-4 block">
        <span className="field-label">Why</span>
        <input
          className="field mt-1.5"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Signed on paper in July"
          disabled={on}
        />
        <span className="field-note">
          {on
            ? 'Recorded when the waiver was granted. It stays on the account afterwards.'
            : 'Optional, and worth a line. A year from now this is the only record of why.'}{' '}
          Only admins see this; the affiliate is told they were let in, not why.
        </span>
      </label>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {on ? (
          <button
            type="button"
            className="btn-outline"
            onClick={() => set(false)}
            disabled={busy}
            aria-busy={busy}
          >
            <BusyLabel busy={busy} idle="Stop bypassing" busyLabel="Saving…" />
          </button>
        ) : (
          <button
            type="button"
            className="btn-outline"
            onClick={() => set(true)}
            disabled={busy}
            aria-busy={busy}
          >
            <BusyLabel busy={busy} idle="Let them in without it" busyLabel="Saving…" />
          </button>
        )}

        {on ? (
          <span className="text-[12px] text-ink-dim">
            Turning this off sends them back to the step they owe on their next page load.
          </span>
        ) : null}
      </div>
    </div>
  );
}
