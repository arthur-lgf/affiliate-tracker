'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { BusyLabel } from './Spinner';
import { formatMoney } from '@/lib/analytics';

/**
 * How little a card may pay before it stops being listed.
 *
 * A display setting, not a filter on the upload: the whole rate card is stored
 * exactly as it was exported, and this decides how much of it is worth putting
 * in front of anybody. That way raising or lowering the floor is one number on
 * one page, rather than re-exporting the report and uploading it again, and
 * nothing is ever lost by setting it too high.
 *
 * Judged on what the merchant pays and on a card's best tier, so a tiered card
 * that clears the floor anywhere keeps all of its tiers. Every reader gets the
 * same list of cards, because two people quoting from two different price lists
 * is worse than either list.
 */
export function RateFloorSettings({
  floor,
  hidden,
  cards,
}: {
  floor: number | null;
  /** Cards the floor is keeping off the rate card right now. */
  hidden: number;
  /** Cards on the uploaded report, before the floor. */
  cards: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [value, setValue] = useState(floor === null ? '' : String(floor));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState('');

  const dirty = value.trim() !== (floor === null ? '' : String(floor));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'floor', floor: value.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? `Could not save (${res.status})`);

      const now = payload.settings?.cpaFloor ?? null;
      setValue(now === null ? '' : String(now));
      setSaved(
        now === null
          ? 'Every card is listed.'
          : `Cards paying under ${formatMoney(now)} are no longer listed.`,
      );
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the floor');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <p className="plain mt-3 max-w-[680px]">
        Cards paying less than this are left off the rate card. Nothing is deleted: the whole report
        stays uploaded, so raising or lowering this puts cards back on the page without uploading
        anything again. Leave it empty to list every card.
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-4">
        <div className="w-[200px]">
          <label className="block" htmlFor="cpa-floor">
            <span className="field-label">Do not list under ($)</span>
          </label>
          <input
            id="cpa-floor"
            type="number"
            min={0}
            step="1"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="No floor"
            className="field tnum mt-1.5"
          />
        </div>

        <button
          type="button"
          className="btn-primary"
          disabled={saving || !dirty}
          aria-busy={saving}
          onClick={save}
        >
          <BusyLabel busy={saving} idle="Save floor" busyLabel="Saving…" />
        </button>

        {dirty && !saving ? <span className="text-[13px] text-ink-soft">Unsaved change</span> : null}
      </div>

      <p className="mt-3.5 text-[13px] text-ink-soft">
        {cards === 0
          ? 'No rate card has been uploaded yet.'
          : hidden === 0
            ? `All ${cards.toLocaleString()} cards are listed.`
            : `${(cards - hidden).toLocaleString()} of ${cards.toLocaleString()} cards are listed. ${hidden.toLocaleString()} pay${
                hidden === 1 ? 's' : ''
              } less than the floor.`}
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
