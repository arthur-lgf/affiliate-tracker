'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { BusyLabel } from './Spinner';

export type ApprovalTarget = {
  id: string;
  slug: string;
  usr: string;
  assignee: string;
  card: string;
  /** "Arthur Reyes · Cash Back Credit Cards" */
  label: string;
};

/** Today in UTC — the same clock every figure on the dashboard is bucketed by. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Record an approval.
 *
 * Nothing produces these automatically: the affiliate network reports approvals
 * on its own schedule, and until that feed is wired up someone enters them here
 * or types them into the Conversions tab. Picking a link rather than typing a
 * name is what keeps a row's person and card matching the ones the table groups
 * by — free text would quietly create a second row for "Cash Back" vs
 * "Cash back credit cards".
 */
export function ConversionForm({ targets }: { targets: ApprovalTarget[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [approvedOn, setApprovedOn] = useState(todayKey());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState('');

  if (targets.length === 0) {
    return (
      <p className="plain">
        Create a link first. An approval is recorded against the link it came through.
      </p>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const target = targets.find((t) => t.id === targetId);
    if (!target) {
      setError('Pick which link this approval came through.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/conversions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Just the link — the person and the card are read back through it, so
        // they are never stored twice and never disagree.
        body: JSON.stringify({
          slug: target.slug,
          usr: target.usr,
          amount: amount.trim() === '' ? 0 : amount,
          approvedOn,
          notes,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Request failed (${res.status})`);
      }
      setDone(`Recorded for ${target.label}.`);
      setAmount('');
      setNotes('');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that approval');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        + Record an approval
      </button>
    );
  }

  return (
    /* w-full so opening the form drops it onto its own row rather than squeezing
       it into the gap beside the heading. */
    <form onSubmit={submit} className="panel-sunk mt-2 w-full p-5 sm:p-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,160px)_minmax(0,200px)]">
        <label className="block min-w-0">
          <span className="field-label mb-2 block">Which link</span>
          <select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            className="field"
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block min-w-0">
          <span className="field-label mb-2 block">Payout</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            className="field"
          />
        </label>

        <label className="block min-w-0">
          <span className="field-label mb-2 block">Approved on</span>
          <input
            type="date"
            required
            value={approvedOn}
            onChange={(event) => setApprovedOn(event.target.value)}
            className="field"
          />
        </label>
      </div>

      <label className="mt-5 block">
        <span className="field-label mb-2 block">Note</span>
        <input
          type="text"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Reference, applicant initials, anything that helps you reconcile"
          className="field"
        />
        <span className="field-note">Optional. Only you ever see it.</span>
      </label>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={busy} aria-busy={busy} className="btn-primary">
          <BusyLabel busy={busy} idle="Save approval" busyLabel="Saving…" />
        </button>
        <button
          type="button"
          className="btn-quiet"
          onClick={() => {
            setOpen(false);
            setError(null);
            setDone('');
          }}
        >
          Close
        </button>
        {done ? (
          <span role="status" className="text-[13px] font-semibold text-leaf-text">
            {done}
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
