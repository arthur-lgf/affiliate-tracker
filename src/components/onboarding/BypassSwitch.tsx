'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BusyLabel } from '@/components/Spinner';
import { isBypassed, type Bypass } from '@/lib/approval';
import { stepsFor, waivedSteps, type OnboardingState } from '@/lib/onboarding';

/**
 * Letting somebody in without the paperwork, and taking it back.
 *
 * The wording is doing real work here. "Bypass onboarding" sounds like a
 * setting; what it actually does is hand somebody the dashboard on this
 * admin's say-so and drop the two documents they would have signed. So the
 * button says what happens, the panel names what is dropped and what is still
 * to come, and turning it off says plainly that it will shut them out again.
 */
export function BypassSwitch({
  userId,
  bypass,
  state,
}: {
  userId: string;
  bypass: Bypass;
  /** What they have done so far. Both lists below are read off it, because
   *  "waive the gate" reads very differently when it is one item left and when
   *  it is everything. */
  state: OnboardingState;
}) {
  const router = useRouter();
  const [note, setNote] = useState(bypass.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = isBypassed(bypass);
  // What a waiver drops is fixed. What is left to fill in depends on whether
  // one is in force, which is exactly the difference the panel has to show.
  const dropped = waivedSteps({ bypassed: true }).map((step) => step.label);
  const outstanding = stepsFor({ bypassed: on })
    .filter((step) => !state[step.key])
    .map((step) => step.label);

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
          ? `This account is not gated. The ${dropped.join(' and the ')} are waived, so there is nothing left for them to sign. Their own details and their bank details are on their profile, to fill in whenever they need to.`
          : `Lets this person use the dashboard now, without waiting to be approved. The ${dropped.join(' and the ')} are skipped outright, so they are never asked to sign either one. Their own details and their bank details stay on their profile, to fill in in any order.`}
      </p>

      {outstanding.length > 0 ? (
        <p className="plain-note mt-3">
          Still to fill in: <strong>{outstanding.join(', ')}</strong>.{' '}
          {on
            ? 'Nothing is stopping them working, but a payment still needs their bank details.'
            : 'Waiving the gate collects none of it; it only stops the app asking for the two documents.'}
        </p>
      ) : (
        <p className="plain mt-3">
          {on
            ? 'Everything that still applies to them is in.'
            : 'Their required paperwork is all in.'}
        </p>
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
            Turning this off asks for both documents again and sends them back to the step they owe
            on their next page load.
          </span>
        ) : null}
      </div>
    </div>
  );
}
