'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { BusyLabel } from './Spinner';
import { isSendableUrl, TRACKING_PARAM, withTrackingKey } from '@/lib/campaigns';
import type { Campaign } from '@/lib/types';

/**
 * The campaign list, edited as a list.
 *
 * One Save for the whole table rather than a write per keystroke, because these
 * rows are edited together: renaming an offer and fixing its URL is one thought,
 * and a list that saves halfway through it is a list that was briefly wrong for
 * everybody creating a link. The cost is the usual one — the later of two
 * concurrent saves wins entire — which is the right trade for a couple of dozen
 * rows maintained by a couple of people.
 */

type Row = {
  /** Local only. A name would do until somebody clears the field to retype it. */
  key: number;
  name: string;
  destination: string;
};

function toRows(campaigns: Campaign[]): Row[] {
  return campaigns.map((campaign, index) => ({ key: index, ...campaign }));
}

/**
 * What is wrong with the list, keyed by row.
 *
 * Duplicate names are an error rather than something quietly merged: the link
 * form looks a destination up by name, so two rows called "Cash Back" would
 * make which URL you get depend on the order they happen to be in.
 */
export function problemsIn(rows: Row[]): Record<number, string> {
  const problems: Record<number, string> = {};
  const seen = new Map<string, number>();

  for (const row of rows) {
    const name = row.name.trim();
    const destination = row.destination.trim();
    if (!name && !destination) continue;

    if (!name) {
      problems[row.key] = 'Give this campaign a name, or clear the URL to drop the row.';
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      problems[row.key] = `There is already a campaign called “${name}”.`;
      continue;
    }
    seen.set(key, row.key);

    if (destination && !isSendableUrl(destination)) {
      problems[row.key] = 'Enter a full URL including https://, or leave it blank.';
    }
  }

  return problems;
}

/**
 * Whether the list is on screen.
 *
 * The toggle decides, with one override: work that has not been saved is never
 * folded away. A list you cannot see is a list you cannot fix, and edits nobody
 * can see are edits somebody is about to lose by walking away from the page.
 */
export function listShowing(open: boolean, dirty: boolean, problemCount: number): boolean {
  return open || dirty || problemCount > 0;
}

/** Blank rows are how a row is deleted, so they are dropped rather than saved. */
function toSave(rows: Row[]): Campaign[] {
  return rows
    .map((row) => ({ name: row.name.trim(), destination: row.destination.trim() }))
    .filter((row) => row.name !== '');
}

export function CampaignSettings({
  campaigns,
  usingDefaults,
}: {
  campaigns: Campaign[];
  /** True when nothing has been saved yet and these are the built-in categories. */
  usingDefaults: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => toRows(campaigns));
  const [nextKey, setNextKey] = useState(campaigns.length);
  const [dirty, setDirty] = useState(usingDefaults);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  /*
   * Folded away to begin with. Two dozen rows of paired inputs is by some
   * distance the tallest thing on this page, and it is also the thing people
   * come here least often to change: the commission and the rate card are above
   * it, and both were being pushed off the screen by a list nobody had asked to
   * see. Not remembered between visits, so the page always opens short.
   */
  const [open, setOpen] = useState(false);

  const problems = useMemo(() => problemsIn(rows), [rows]);
  const problemCount = Object.keys(problems).length;
  const pending = dirty || problemCount > 0;
  const showing = listShowing(open, dirty, problemCount);
  /* Rows that would go in the picker with nowhere to send anybody. Worth saying
     while the list is folded away, because it is the one thing about a campaign
     that is wrong rather than merely unset. */
  const missing = rows.filter(
    (row) => row.name.trim() !== '' && row.destination.trim() === '',
  ).length;

  function edit(key: number, field: 'name' | 'destination', value: string) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
    setDirty(true);
    setSaved('');
  }

  function addRow() {
    setRows((prev) => [...prev, { key: nextKey, name: '', destination: '' }]);
    setNextKey((key) => key + 1);
    setDirty(true);
    setSaved('');
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((row) => row.key !== key));
    setDirty(true);
    setSaved('');
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = toSave(rows);
      const res = await fetch('/api/campaigns', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campaigns: body }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? `Could not save (${res.status})`);

      setRows(toRows(payload.campaigns ?? body));
      setNextKey((payload.campaigns ?? body).length);
      setDirty(false);
      setSaved(
        `Saved ${body.length} campaign${body.length === 1 ? '' : 's'}. The link form uses them now.`,
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the campaigns');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/*
        The control itself. It sits above the region it opens, says how many
        rows are behind it, and refuses to close over unsaved work: while there
        are edits to save or rows to fix, the list stays where you can see it.
      */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          className="btn-outline btn-sm"
          aria-expanded={showing}
          aria-controls="campaign-list"
          disabled={pending}
          onClick={() => setOpen((was) => !was)}
        >
          <span aria-hidden className="mr-2 text-ink-soft">
            {showing ? '▲' : '▼'}
          </span>
          {showing
            ? 'Hide campaigns'
            : `Show ${rows.length} campaign${rows.length === 1 ? '' : 's'}`}
        </button>

        {pending ? (
          <span className="text-[13px] text-ink-soft">
            {problemCount > 0
              ? 'The list stays open until the rows are fixed.'
              : 'The list stays open until your changes are saved.'}
          </span>
        ) : showing ? null : (
          <span className="text-[13px] text-ink-soft">
            {rows.length === 0
              ? 'None yet. The link form has nothing to offer.'
              : missing === 0
                ? 'Every campaign has somewhere to send people.'
                : `${missing} of ${rows.length} have no URL yet.`}
          </span>
        )}
      </div>

      <div id="campaign-list">
        {showing ? (
          <>
            <p className="plain mt-3">
              Pick a campaign when creating a link and this URL is filled in, with that person&rsquo;s
              tracking key added as <code>{TRACKING_PARAM}</code>. So{' '}
              <code>https://www.cardratings.com/bestcards?src=714025</code> becomes{' '}
              <code>{withTrackingKey('https://www.cardratings.com/bestcards?src=714025', 'their-key')}</code>
              . It stays editable on the form afterwards.
            </p>

            {usingDefaults ? (
              <p className="plain-note mt-4">
                These are the built-in categories, which is what the campaign picker has always offered.
                None of them has a URL yet, so nothing is filled in until you add one and save.
              </p>
            ) : null}

            <ul className="mt-6 flex flex-col gap-4">
              {rows.map((row) => (
                <li key={row.key} className="card-row p-5 sm:px-6">
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)_auto] lg:items-start">
                    <label className="block min-w-0">
                      <span className="field-label mb-2 block">Campaign</span>
                      <input
                        className="field"
                        value={row.name}
                        onChange={(event) => edit(row.key, 'name', event.target.value)}
                        placeholder="Best Cards"
                        maxLength={80}
                        autoComplete="off"
                        aria-invalid={Boolean(problems[row.key])}
                      />
                    </label>

                    <label className="block min-w-0">
                      <span className="field-label mb-2 block">Where it sends people</span>
                      <input
                        className="field"
                        value={row.destination}
                        onChange={(event) => edit(row.key, 'destination', event.target.value)}
                        placeholder="https://www.cardratings.com/bestcards?src=714025"
                        inputMode="url"
                        maxLength={2000}
                        autoComplete="off"
                        aria-invalid={Boolean(problems[row.key])}
                      />
                    </label>

                    {/* Bottom-aligned with the inputs rather than the labels, so the
                        row of controls reads as one line on a wide screen. */}
                    <div className="lg:pt-[34px]">
                      <button
                        type="button"
                        className="btn-quiet btn-sm"
                        onClick={() => removeRow(row.key)}
                        aria-label={`Remove ${row.name.trim() || 'this campaign'}`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {problems[row.key] ? (
                    <p role="alert" className="field-error">
                      {problems[row.key]}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>

            {rows.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-ink-soft">
                No campaigns. Add one and the link form will offer it.
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button type="button" className="btn-outline" onClick={addRow}>
                + Add a campaign
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={save}
                disabled={saving || problemCount > 0 || !dirty}
                aria-busy={saving}
              >
                <BusyLabel busy={saving} idle="Save campaigns" busyLabel="Saving…" />
              </button>

              {problemCount > 0 ? (
                <span className="text-[13px] font-semibold text-alarm">
                  {problemCount} row{problemCount === 1 ? '' : 's'} to fix first
                </span>
              ) : dirty ? (
                <span className="text-[13px] text-ink-soft">Unsaved changes</span>
              ) : saved ? (
                <span role="status" className="text-[13px] font-semibold text-leaf-text">
                  {saved}
                </span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
    </>
  );
}
