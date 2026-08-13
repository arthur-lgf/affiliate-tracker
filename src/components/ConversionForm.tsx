'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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
      <p className="text-[12.5px] text-sage-dim">
        Create a link first — an approval is recorded against the link it came through.
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
      <button type="button" className="pill-action" onClick={() => setOpen(true)}>
        Record an approval
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="w-full">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_120px_150px]">
        <label className="min-w-0">
          <span className="label-micro block">Link</span>
          <select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            className="field-dark mt-1.5 cursor-pointer"
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id} className="bg-pine-900 text-cream">
                {target.label}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-0">
          <span className="label-micro block">Payout</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            className="field-dark mt-1.5"
          />
        </label>

        <label className="min-w-0">
          <span className="label-micro block">Approved on</span>
          <input
            type="date"
            required
            value={approvedOn}
            onChange={(event) => setApprovedOn(event.target.value)}
            className="field-dark mt-1.5"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="label-micro block">Note (optional)</span>
        <input
          type="text"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Reference, applicant initials, anything that helps you reconcile"
          className="field-dark mt-1.5"
        />
      </label>

      <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
        <button type="submit" disabled={busy} className="btn-accent !px-5 !py-2.5 !text-[13px]">
          {busy ? 'Saving…' : 'Save approval'}
        </button>
        <button
          type="button"
          className="pill-action"
          onClick={() => {
            setOpen(false);
            setError(null);
            setDone('');
          }}
        >
          Close
        </button>
        {done ? (
          <span role="status" className="text-[12.5px]" style={{ color: 'var(--color-moss)' }}>
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
