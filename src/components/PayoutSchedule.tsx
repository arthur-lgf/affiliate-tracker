'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BusyLabel } from './Spinner';
import { formatMoney, initialsOf } from '@/lib/analytics';
import {
  anchorLabel,
  BANDS,
  BAND_ORDER,
  describeDue,
  PAYOUT_DAYS,
  periodLabel,
  progressOf,
  settlesUp,
  type AnchorSource,
  type PayoutBand,
  type Period,
} from '@/lib/payout';

/**
 * The payout schedule.
 *
 * Nobody shares a payday here. Each person is paid 45 days from the day they
 * signed, so the useful question is not "who is on the list" but "whose 45 days
 * run out first" — which is why this is banded by urgency rather than sorted by
 * name, and why every row carries a track showing how far through its own cycle
 * it is. The bar is the schedule: a full one is a payment somebody owes.
 *
 * Recording a payment and attaching its receipt sit in the same panel, opened
 * from the row, because they are one job done at one moment: send the transfer,
 * screenshot it, write both down. Splitting them across two controls produces a
 * table full of payments with no evidence behind any of them.
 */

export type PayoutRow = {
  userId: string;
  name: string;
  usr: string;
  anchorDay: string;
  anchorSource: AnchorSource;
  period: Period;
  /** How many approvals fall inside this window. */
  approvals: number;
  /** What the window comes to now, as the affiliate's own share. */
  amount: number;
  band: PayoutBand;
  paidAt: string | null;
  paidAmount: number | null;
  paidBy: string;
  reference: string;
  note: string;
  proof: { name: string; at: string | null } | null;
  confirmedAt: string | null;
};

type Draft = { amount: string; paidOn: string; reference: string; note: string };

function rowKey(row: PayoutRow): string {
  return `${row.userId}|${row.period.from}`;
}

/** What the search box matches: a person, not a period. */
export function matchesQuery(row: PayoutRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${row.name} ${row.usr}`.toLowerCase().includes(needle);
}

export function PayoutSchedule({ rows, today }: { rows: PayoutRow[]; today: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState('');
  const [draft, setDraft] = useState<Draft>({ amount: '', paidOn: '', reference: '', note: '' });
  const fileInput = useRef<HTMLInputElement | null>(null);

  const matched = useMemo(() => rows.filter((row) => matchesQuery(row, query)), [rows, query]);

  const banded = useMemo(() => {
    const out = new Map<PayoutBand, PayoutRow[]>();
    for (const band of BAND_ORDER) out.set(band, []);
    for (const row of matched) out.get(row.band)?.push(row);
    return out;
  }, [matched]);

  /*
   * What is owed right now, which is the figure somebody opens this page to
   * find. Overdue and due only: a cycle still running is not money anybody is
   * late with, and rolling it in would make the number climb all month and mean
   * nothing on any given day.
   */
  const owed = useMemo(
    () =>
      matched
        .filter((row) => row.band === 'overdue' || row.band === 'due')
        .reduce((sum, row) => sum + row.amount, 0),
    [matched],
  );

  function openRow(row: PayoutRow) {
    const key = rowKey(row);
    setError(null);
    setProblems({});
    setSaved('');
    if (open === key) {
      setOpen('');
      return;
    }
    setOpen(key);
    setDraft({
      /*
       * Prefilled with what the period comes to, because that is what is about
       * to be sent nine times in ten. Editable because the tenth is a transfer
       * that was rounded, split, or settled against something else.
       */
      amount: row.paidAmount !== null ? String(row.paidAmount) : String(row.amount || ''),
      paidOn: row.paidAt ? row.paidAt.slice(0, 10) : today,
      reference: row.reference,
      note: row.note,
    });
  }

  async function send(row: PayoutRow, body: Record<string, unknown>, done: string) {
    const key = rowKey(row);
    setBusy(key);
    setError(null);
    setProblems({});
    try {
      const res = await fetch('/api/payouts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: row.userId,
          periodStart: row.period.from,
          periodEnd: row.period.to,
          ...body,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProblems((payload.fields ?? {}) as Record<string, string>);
        throw new Error(
          payload.hint
            ? `${payload.error} ${payload.hint}`
            : payload.error ?? `That did not save (${res.status})`,
        );
      }
      setSaved(done);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not save.');
    } finally {
      setBusy('');
    }
  }

  async function attach(row: PayoutRow, file: File) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('unreadable'));
      reader.readAsDataURL(file);
    }).catch(() => '');

    if (!data) {
      setError('That file could not be read. Try attaching it again.');
      return;
    }
    await send(
      row,
      { action: 'proof', name: file.name, type: file.type, data },
      `Receipt attached for ${row.name}.`,
    );
  }

  return (
    <>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <label className="block w-full max-w-[320px]">
          <span className="field-label">Find someone</span>
          <input
            className="field mt-1.5"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or tracking key"
            autoComplete="off"
          />
        </label>

        {/*
          The one figure this page exists to answer, set against the gold
          highlighter rather than in a coloured box. That is the only thing gold
          does in this app.
        */}
        <p className="text-right">
          <span className="field-label">Owed now</span>
          <span className="mark tnum mt-1 block text-[26px] font-semibold leading-none">
            {formatMoney(owed)}
          </span>
        </p>
      </div>

      {error ? (
        <p role="alert" className="warn-note mt-5">
          <span aria-hidden className="warn-note-mark">
            ⚠
          </span>
          <span>{error}</span>
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="mt-5 text-[13px] font-semibold text-leaf-text">
          {saved}
        </p>
      ) : null}

      {matched.length === 0 ? (
        <p className="panel mt-5 px-5 py-14 text-center text-[13px] text-ink-soft">
          {rows.length === 0
            ? 'No payout schedule yet. One starts the day somebody signs the agreement, or the day an admin waives it.'
            : `Nobody matches “${query}”.`}
        </p>
      ) : null}

      {BAND_ORDER.map((band) => {
        const list = banded.get(band) ?? [];
        if (list.length === 0) return null;
        const meta = BANDS.find((entry) => entry.key === band)!;

        return (
          <section key={band} className="panel mt-5 overflow-hidden">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-edge bg-paper-card px-5 py-3.5">
              <h2 className="text-[14px] font-semibold text-ink">{meta.label}</h2>
              <span className="tnum text-[12px] text-ink-dim">{list.length}</span>
              <p className="w-full text-[12px] text-ink-dim sm:w-auto">{meta.blurb}</p>
            </div>

            <ul>
              {list.map((row) => {
                const key = rowKey(row);
                const expanded = open === key;
                const filled = Math.round(progressOf(row.period, today) * 100);
                const late = row.band === 'overdue';
                const mismatch = !settlesUp(row.amount, row.paidAmount);

                return (
                  <li key={key} className="border-b border-edge-faint last:border-b-0">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
                      <span
                        aria-hidden
                        className="flex h-[30px] w-[30px] flex-none items-center justify-center bg-paper-sunk text-[11px] font-semibold text-ink-dim"
                      >
                        {initialsOf(row.name)}
                      </span>

                      <span className="min-w-[150px] flex-1">
                        <span className="block text-[13px] font-semibold text-ink">{row.name}</span>
                        <span className="tnum block text-[11px] text-ink-dim">
                          {row.usr ? `usr=${row.usr}` : 'No tracking key'}
                        </span>
                      </span>

                      {/* The window, and what it was counted from. Two people
                          who signed a week apart are paid a week apart, so the
                          date alone would look arbitrary without it. */}
                      <span className="min-w-[190px] flex-1">
                        <span className="tnum block text-[13px] text-ink">
                          {periodLabel(row.period)}
                        </span>
                        <span className="block text-[11px] text-ink-dim">
                          {anchorLabel(row.anchorSource)} {row.anchorDay}
                        </span>
                      </span>

                      {/*
                        The 45 days, drawn. This is the page's one picture: how
                        much of somebody's cycle has run. Labelled for a reader
                        who cannot see it, and never the only signal, since the
                        band above says the same thing in words.
                      */}
                      <span className="w-[150px] flex-none">
                        <span
                          role="progressbar"
                          aria-valuenow={filled}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${filled}% through a ${PAYOUT_DAYS} day cycle`}
                          className="block h-[6px] w-full overflow-hidden bg-paper-sunk"
                        >
                          <span
                            className={`sweep block h-full ${late ? 'bg-alarm' : 'bg-navy'}`}
                            style={{ width: `${filled}%` }}
                          />
                        </span>
                        <span className="tnum mt-1.5 block text-[11px] text-ink-dim">
                          {describeDue(row.period, today, row.paidAt)}
                        </span>
                      </span>

                      <span className="w-[110px] flex-none text-right">
                        <span className="tnum block text-[15px] font-semibold text-ink">
                          {formatMoney(row.amount)}
                        </span>
                        <span className="block text-[11px] text-ink-dim">
                          {row.approvals === 1 ? '1 approval' : `${row.approvals} approvals`}
                        </span>
                      </span>

                      <span className="flex flex-none flex-wrap items-center gap-2">
                        {row.paidAt ? <span className="chip chip-live">Paid</span> : null}
                        {row.confirmedAt ? <span className="chip chip-quiet">Confirmed</span> : null}
                        {row.proof ? (
                          <a
                            href={`/api/payouts/receipt?user=${encodeURIComponent(row.userId)}&period=${row.period.from}`}
                            target="_blank"
                            rel="noreferrer"
                            className="chip chip-quiet"
                          >
                            Receipt
                          </a>
                        ) : row.paidAt ? (
                          <span className="chip chip-gold">No receipt</span>
                        ) : null}

                        <button
                          type="button"
                          className="btn-outline btn-sm"
                          aria-expanded={expanded}
                          onClick={() => openRow(row)}
                        >
                          {row.paidAt ? 'Edit payment' : 'Record payment'}
                        </button>
                      </span>
                    </div>

                    {/*
                      What was paid is not always what the period now comes to:
                      an approval entered late lands in a cycle already settled.
                      Said out loud rather than resolved quietly, because the
                      older figure is the one that left the bank.
                    */}
                    {mismatch ? (
                      <p className="border-t border-gold-wash bg-gold-faint px-5 py-2.5 text-[12px] text-gold-deep">
                        Paid {formatMoney(row.paidAmount ?? 0)} against {formatMoney(row.amount)} now
                        on this period. An approval was probably recorded after the payment went out.
                      </p>
                    ) : null}

                    {expanded ? (
                      <div className="border-t border-edge-faint bg-paper-card px-5 py-5">
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <label className="block">
                            <span className="field-label">Amount sent</span>
                            <input
                              className="field tnum mt-1.5"
                              type="number"
                              min={0}
                              step="0.01"
                              inputMode="decimal"
                              value={draft.amount}
                              onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                              aria-invalid={problems.amount ? true : undefined}
                            />
                            {problems.amount ? (
                              <span className="field-error">{problems.amount}</span>
                            ) : null}
                          </label>

                          <label className="block">
                            <span className="field-label">Day it was sent</span>
                            <input
                              className="field mt-1.5"
                              type="date"
                              max={today}
                              value={draft.paidOn}
                              onChange={(event) => setDraft({ ...draft, paidOn: event.target.value })}
                              aria-invalid={problems.paidOn ? true : undefined}
                            />
                            {problems.paidOn ? (
                              <span className="field-error">{problems.paidOn}</span>
                            ) : null}
                          </label>

                          <label className="block">
                            <span className="field-label">
                              Reference <span className="font-normal text-ink-dim">(optional)</span>
                            </span>
                            <input
                              className="field mt-1.5"
                              value={draft.reference}
                              onChange={(event) =>
                                setDraft({ ...draft, reference: event.target.value })
                              }
                              placeholder="ACH 4821"
                              maxLength={120}
                            />
                          </label>

                          <label className="block">
                            <span className="field-label">
                              Note <span className="font-normal text-ink-dim">(optional)</span>
                            </span>
                            <input
                              className="field mt-1.5"
                              value={draft.note}
                              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                              maxLength={500}
                            />
                          </label>
                        </div>

                        <div className="mt-5 flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            disabled={busy === key}
                            aria-busy={busy === key}
                            onClick={() =>
                              send(
                                row,
                                {
                                  action: 'pay',
                                  amount: Number(draft.amount),
                                  paidOn: draft.paidOn,
                                  reference: draft.reference,
                                  note: draft.note,
                                },
                                `Payment recorded for ${row.name}.`,
                              )
                            }
                          >
                            <BusyLabel
                              busy={busy === key}
                              idle={row.paidAt ? 'Save payment' : 'Record payment'}
                              busyLabel="Saving…"
                            />
                          </button>

                          {/* One job, one panel: the transfer and the evidence
                              for it are written down at the same moment. */}
                          <input
                            ref={fileInput}
                            type="file"
                            className="sr-only"
                            accept="image/png,image/jpeg,image/webp,application/pdf"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = '';
                              if (file) void attach(row, file);
                            }}
                          />
                          <button
                            type="button"
                            className="btn-outline btn-sm"
                            disabled={busy === key}
                            onClick={() => fileInput.current?.click()}
                          >
                            {row.proof ? 'Replace receipt' : 'Attach receipt'}
                          </button>

                          {row.proof ? (
                            <button
                              type="button"
                              className="btn-quiet btn-sm"
                              disabled={busy === key}
                              onClick={() =>
                                send(row, { action: 'remove-proof' }, `Receipt removed for ${row.name}.`)
                              }
                            >
                              Remove receipt
                            </button>
                          ) : null}

                          {row.paidAt ? (
                            <button
                              type="button"
                              className="btn-quiet btn-sm"
                              disabled={busy === key}
                              onClick={() =>
                                send(row, { action: 'clear' }, `Payment cleared for ${row.name}.`)
                              }
                            >
                              Clear payment
                            </button>
                          ) : null}
                        </div>

                        <p className="plain mt-4 text-[12px]">
                          {row.proof
                            ? `Receipt on file: ${row.proof.name}. They can open it from their own payslip too.`
                            : 'A photo of the transfer or a PDF from the bank, up to about 2.5 MB. It shows on their payslip as proof of payment.'}
                          {row.paidBy ? ` Last recorded by ${row.paidBy}.` : ''}
                        </p>

                        <p className="plain mt-2 text-[12px]">
                          This period covers approvals from {row.period.from} up to but not including{' '}
                          {row.period.to}, which is {PAYOUT_DAYS} days.
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
