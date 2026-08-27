'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { BusyLabel } from './Spinner';
import { formatDay } from '@/lib/analytics';
import {
  approvalsAffected,
  formatShare,
  orderShares,
  shareOn,
  type ShareRate,
} from '@/lib/settings';

/**
 * The commission percentage, as a history rather than a number.
 *
 * The reason the form looks like this is the promise it has to keep: changing
 * what an affiliate keeps must not change what an approval already banked was
 * worth. So a rate is never edited — a new one is added, with the first day it
 * applies to, and everything approved before that day keeps answering the rate
 * that was in force when it was approved.
 *
 * Two things follow from that, and both are visible in the form. A new rate
 * defaults to starting tomorrow, which is the only start day that cannot touch
 * anything already recorded. And whatever day is picked, the form says how many
 * recorded approvals it would restate before the button is pressed, because a
 * mistyped year is otherwise invisible until a month of payouts has moved.
 */
export function CommissionSettings({
  shares,
  today,
  approvalDays,
}: {
  shares: ShareRate[];
  /** The server's today, so the form and the page cannot disagree at midnight. */
  today: string;
  /**
   * How many approvals sit on each day, for counting what a change would move.
   *
   * Dates and counts only. The form needs to know how much history a start day
   * reaches back over, and nothing about whose it is or what it was worth.
   */
  approvalDays: { day: string; count: number }[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [percent, setPercent] = useState('');
  const [from, setFrom] = useState(() => dayAfter(today));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState('');

  const history = useMemo(() => orderShares(shares).reverse(), [shares]);
  const inForce = shareOn(today, shares);
  const affected = useMemo(() => approvalsAffected(approvalDays, from), [approvalDays, from]);

  async function send(body: Record<string, unknown>, done: string) {
    setSaving(true);
    setError(null);
    setFields({});
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFields((payload.fields ?? {}) as Record<string, string>);
        throw new Error(payload.hint ? `${payload.error} ${payload.hint}` : payload.error ?? `Could not save (${res.status})`);
      }
      setPercent('');
      setSaved(done);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the commission');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-display text-[30px] leading-none tnum">{formatShare(inForce)}</span>
        <span className="text-[13px] text-ink-soft">
          of every approval, on anything approved today.
        </span>
      </div>

      <p className="plain mt-3 max-w-[680px]">
        A rate starts on a day and covers every approval from that day on. Approvals already
        recorded keep the rate that was in force when they were approved, so changing this never
        restates work that has already been banked, or paid.
      </p>

      <h3 className="mt-7 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-dim">
        Rates
      </h3>
      <ul className="mt-2.5 divide-y divide-edge-faint border-y border-edge-faint">
        {history.map((entry) => {
          const started = entry.from === '' || entry.from <= today;
          const current = shareOn(today, shares) === entry.rate && startsLatest(entry, shares, today);
          return (
            <li key={entry.from || 'opening'} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
              <span className="tnum w-[72px] text-[15px] font-semibold">{formatShare(entry.rate)}</span>
              <span className="flex-1 text-[13px] text-ink-soft">
                {entry.from === ''
                  ? 'From the beginning'
                  : `From ${formatDay(entry.from)}`}
                {current ? (
                  <span className="chip chip-live ml-2.5">In force</span>
                ) : started ? null : (
                  <span className="chip chip-quiet ml-2.5">Not started</span>
                )}
              </span>
              {/* Only a rate that has not started can be taken away. Removing one
                  that is already in force would reprice the approvals it covers,
                  which is the whole thing this page is built not to do. */}
              {!started ? (
                <button
                  type="button"
                  className="btn-quiet btn-sm"
                  disabled={saving}
                  onClick={() => send({ action: 'remove-share', from: entry.from }, 'Rate removed.')}
                >
                  Remove
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      <h3 className="mt-7 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-dim">
        Add a rate
      </h3>
      <div className="mt-2.5 flex flex-wrap items-end gap-4">
        <div className="w-[160px]">
          <label className="block" htmlFor="share-percent">
            <span className="field-label">Affiliate keeps (%)</span>
          </label>
          <input
            id="share-percent"
            type="number"
            min={0}
            max={100}
            step="0.1"
            inputMode="decimal"
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
            placeholder="60"
            className="field tnum mt-1.5"
          />
          {fields.percent ? (
            <p role="alert" className="field-error">
              {fields.percent}
            </p>
          ) : null}
        </div>

        <div className="w-[190px]">
          <label className="block" htmlFor="share-from">
            <span className="field-label">Starting</span>
          </label>
          <input
            id="share-from"
            type="date"
            value={from}
            min={today}
            onChange={(event) => setFrom(event.target.value)}
            className="field mt-1.5"
          />
          {fields.from ? (
            <p role="alert" className="field-error">
              {fields.from}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          className="btn-primary"
          disabled={saving || percent.trim() === '' || from === ''}
          aria-busy={saving}
          onClick={() =>
            send(
              { action: 'add-share', percent: Number(percent), from },
              `Affiliates keep ${percent}% of approvals from ${formatDay(from)}.`,
            )
          }
        >
          <BusyLabel busy={saving} idle="Add rate" busyLabel="Saving…" />
        </button>
      </div>

      {/*
        What the change would move, before it moves. A start day in the future
        touches nothing, which is the answer this should almost always give; a
        mistyped year shows up here as the two hundred approvals it would
        reprice rather than as a surprise next payday.
      */}
      <p className={`mt-3.5 text-[13px] ${affected.count > 0 ? 'font-semibold text-alarm' : 'text-ink-soft'}`}>
        {affected.count === 0
          ? 'No approval already recorded would change. This rate only covers what is approved from that day on.'
          : `This would restate ${affected.count.toLocaleString()} approval${
              affected.count === 1 ? '' : 's'
            } already recorded, back to ${formatDay(affected.earliest)}.`}
      </p>

      {saved ? (
        <p role="status" className="mt-3 text-[13px] font-semibold text-leaf-text">
          {saved}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** Tomorrow, as a day key. The only start day that cannot restate anything. */
function dayAfter(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return today;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Whether this entry is the newest one that has actually started. */
function startsLatest(entry: ShareRate, shares: ShareRate[], today: string): boolean {
  const started = orderShares(shares).filter((row) => row.from === '' || row.from <= today);
  return started.length > 0 && started[started.length - 1]!.from === entry.from;
}
