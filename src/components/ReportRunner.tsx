'use client';

import { useRef, useState } from 'react';

type RunResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  shape: string;
  url: string;
  fetchedAt: string;
  durationMs: number;
  raw: unknown;
};

type CheckResult = {
  ok: boolean;
  baseUrl?: string;
  app?: string;
  userName?: string | null;
  permissions?: unknown;
  expiresAt?: string;
};

type SyncIssue = { kind: string; detail: string; rows: number; approvals: number };

type SyncResult = {
  applied: boolean;
  rowsWithApprovals: number;
  totalApprovals: number;
  totalEarnings: number;
  toCreate: number;
  amountToCreate: number;
  alreadyImported: number;
  issues: SyncIssue[];
  unusable: boolean;
  created?: number;
  failures?: string[];
  preview?: { approvedOn: string; slug: string; usr: string; amount: number; card: string }[];
};

const money = (value: number) =>
  value.toLocaleString(undefined, { style: 'currency', currency: 'USD' });

/** Today and 30 days back, in UTC, to match every other date in the app. */
function utcDay(offsetDays = 0): string {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
  return day.toISOString().slice(0, 10);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ReportRunner({ reportId, app, baseUrl }: { reportId: string; app: string; baseUrl: string }) {
  const [startDate, setStartDate] = useState(utcDay(-30));
  const [endDate, setEndDate] = useState(utcDay(0));
  const [useRange, setUseRange] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [sync, setSync] = useState<SyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  async function readError(response: Response): Promise<{ message: string; hint?: string }> {
    try {
      const body = (await response.json()) as { error?: string; hint?: string };
      return { message: body.error || `Request failed (${response.status}).`, hint: body.hint };
    } catch {
      return { message: `Request failed (${response.status}).` };
    }
  }

  function failed(next: { message: string; hint?: string }) {
    setError(next);
    requestAnimationFrame(() => errorRef.current?.focus());
  }

  async function runCheck() {
    setBusy(true);
    setError(null);
    setCheck(null);
    try {
      const response = await fetch('/api/qmp/check');
      if (!response.ok) {
        failed(await readError(response));
      } else {
        setCheck((await response.json()) as CheckResult);
      }
    } catch {
      failed({ message: 'Network error. The check did not reach the server.' });
    }
    setBusy(false);
  }

  async function runReport() {
    setBusy(true);
    setError(null);
    setResult(null);
    setShowRaw(false);

    const params = new URLSearchParams();
    if (useRange) {
      params.set('startDate', startDate);
      params.set('endDate', endDate);
    }

    try {
      const response = await fetch(`/api/qmp/report?${params.toString()}`);
      if (!response.ok) {
        failed(await readError(response));
      } else {
        setResult((await response.json()) as RunResult);
      }
    } catch {
      failed({ message: 'Network error. The report request did not reach the server.' });
    }
    setBusy(false);
  }

  /**
   * `apply: false` plans, `apply: true` writes. The server fetches the report
   * again either way, so what gets written is what QMP says now, not what this
   * page happens to be holding.
   */
  async function runSync(apply: boolean) {
    setSyncing(true);
    setError(null);
    if (apply) setSync(null);

    try {
      const response = await fetch('/api/qmp/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startDate: useRange ? startDate : '',
          endDate: useRange ? endDate : '',
          apply,
        }),
      });
      if (!response.ok) {
        failed(await readError(response));
      } else {
        setSync((await response.json()) as SyncResult);
      }
    } catch {
      failed({ message: 'Network error. The sync did not reach the server.' });
    }
    setSyncing(false);
  }

  function downloadCsv() {
    if (!result) return;
    const cell = (value: unknown) => {
      const text = cellText(value);
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [result.columns.map(cell).join(',')];
    for (const row of result.rows) lines.push(result.columns.map((column) => cell(row[column])).join(','));

    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `qmp-${reportId}-${result.fetchedAt.slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(href);
  }

  return (
    <>
      <section className="rise panel mt-5 p-6 sm:p-8">
        <h2 className="font-display text-[32px]">Run a report</h2>
        <p className="plain mt-2">
          Pulls the report named in the environment. Pick a date range, or leave it off for every
          date QMP has.
        </p>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="min-w-0">
            <div className="mb-6">
              <span className="field-label">Report</span>
              {/* A URL is one unbreakable token. Without this it sets the
                  minimum width of the whole page on a phone. */}
              <p className="mt-1 text-[19px] [overflow-wrap:anywhere]">
                {baseUrl}/api/{app}/download/<strong>{reportId}</strong>
              </p>
              <span className="field-note">Fixed by REPORT_ID. Change it there, not here.</span>
            </div>

            <div className="mt-6">
              {/* min-h-11 makes the whole row a 44px target, not just the
                  24px box: the label is what people actually hit. */}
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="h-6 w-6 flex-none"
                  checked={useRange}
                  onChange={(event) => setUseRange(event.target.checked)}
                />
                <span className="text-[19px]">Limit to a date range</span>
              </label>
              <p className="field-note mt-1">
                With this off, QMP returns every date it has for the report.
              </p>
            </div>

            {useRange ? (
              <div className="mt-4 flex flex-wrap gap-5">
                <label className="min-w-[170px] flex-1">
                  <span className="field-label">From</span>
                  <input
                    type="date"
                    className="field mt-2"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </label>
                <label className="min-w-[170px] flex-1">
                  <span className="field-label">To</span>
                  <input
                    type="date"
                    className="field mt-2"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </label>
              </div>
            ) : null}

            <div className="mt-7 flex flex-wrap items-center gap-4">
              <button type="button" onClick={runReport} disabled={busy} className="btn-primary">
                {busy ? 'Working…' : 'Run report'}
              </button>
              <button type="button" onClick={runCheck} disabled={busy} className="btn-outline">
                Check connection
              </button>
            </div>

            {error ? (
              <p ref={errorRef} tabIndex={-1} role="alert" className="field-error mt-5">
                {error.message}
                {error.hint ? <span className="mt-1 block font-normal">{error.hint}</span> : null}
              </p>
            ) : null}
          </div>

          <aside className="panel-sunk min-w-0 p-5">
            <h3 className="label-cap">Connection</h3>
            {check ? (
              <dl className="mt-3 grid gap-2 text-[18px]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <dt className="text-ink-soft">Status</dt>
                  <dd className="font-semibold text-leaf-text">Credentials accepted</dd>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <dt className="text-ink-soft">Account</dt>
                  <dd className="[overflow-wrap:anywhere] font-semibold">{check.userName || 'unnamed'}</dd>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <dt className="text-ink-soft">App</dt>
                  <dd className="font-semibold">{check.app}</dd>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <dt className="text-ink-soft">Token good until</dt>
                  <dd className="font-semibold">
                    {check.expiresAt ? new Date(check.expiresAt).toUTCString() : 'unknown'}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="plain mt-3">
                Not checked yet. Use Check connection to confirm the key and secret before blaming a
                report key.
              </p>
            )}
          </aside>
        </div>
      </section>

      {result ? (
        <section className="rise panel mt-5 p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
            <h2 className="font-display text-[32px]">Result</h2>
            <span className="text-[19px] text-ink-soft">
              {result.rowCount.toLocaleString()} row{result.rowCount === 1 ? '' : 's'} ·{' '}
              {result.columns.length} column{result.columns.length === 1 ? '' : 's'} ·{' '}
              {(result.durationMs / 1000).toFixed(1)}s
            </span>
          </div>

          <p className="field-note mt-2 [overflow-wrap:anywhere]">{result.url}</p>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={downloadCsv}
              disabled={result.rowCount === 0}
              className="btn-gold btn-sm"
            >
              Download CSV
            </button>
            <button
              type="button"
              onClick={() => setShowRaw((value) => !value)}
              className="btn-quiet btn-sm"
              aria-expanded={showRaw}
            >
              {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
            </button>
          </div>

          {result.rowCount === 0 ? (
            <p className="mt-6 text-[19px] text-ink-soft">
              QMP answered, but no rows were found in the response
              {result.shape === 'unrecognised'
                ? '. The payload is not in a shape this page recognises yet, so read the raw JSON below and tell me what it looks like.'
                : ' for this range. Try a wider one.'}
            </p>
          ) : (
            // Wide content scrolls inside its own container so the page never
            // does. `relative` keeps any absolutely positioned descendant from
            // resolving against the document and stretching it.
            <div className="relative -mx-2 mt-5 overflow-x-auto px-2">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b-2 border-edge">
                    {result.columns.map((column) => (
                      <th key={column} className="label-cap whitespace-nowrap px-3 pb-3">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 200).map((row, index) => (
                    <tr key={index} className="divider-row last:border-0">
                      {result.columns.map((column) => (
                        <td key={column} className="max-w-[320px] truncate px-3 py-3 text-[18px]">
                          {cellText(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.rowCount > 200 ? (
            <p className="plain-note mt-4">
              Showing the first 200 rows. The CSV has all {result.rowCount.toLocaleString()}.
            </p>
          ) : null}

          {showRaw ? (
            <pre className="panel-sunk mt-5 max-h-[520px] overflow-auto p-4 text-[15px] leading-relaxed">
              {JSON.stringify(result.raw, null, 2)}
            </pre>
          ) : null}
        </section>
      ) : null}

      {result ? (
        <section className="rise panel mt-5 p-6 sm:p-8">
          <h2 className="font-display text-[32px]">Sync to approvals</h2>
          <p className="plain mt-2">
            Each QMP row says how many approvals a card took that day and what they paid together.
            One row becomes that many approvals in Ledger, with the earnings split evenly between
            them so the total stays exact. Sub ID is matched to a link to work out whose it is.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => runSync(false)}
              disabled={syncing || busy}
              className="btn-outline"
            >
              {syncing ? 'Working…' : 'Preview sync'}
            </button>
            {sync && !sync.applied && sync.toCreate > 0 ? (
              <button
                type="button"
                onClick={() => runSync(true)}
                disabled={syncing}
                className="btn-gold"
              >
                Write {sync.toCreate} approval{sync.toCreate === 1 ? '' : 's'} ({money(sync.amountToCreate)})
              </button>
            ) : null}
          </div>

          {sync ? (
            <div className="mt-6">
              {sync.applied ? (
                <p
                  className={`text-[21px] font-semibold ${
                    sync.failures?.length ? 'text-alarm' : 'text-leaf-text'
                  }`}
                  role="status"
                >
                  {sync.created} approval{sync.created === 1 ? '' : 's'} written to Ledger.
                  {sync.failures?.length ? ' Then it stopped on an error.' : ''}
                </p>
              ) : null}

              <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Figure label="In this report" value={`${sync.totalApprovals}`} note="approvals QMP reports" />
                <Figure label="Worth" value={money(sync.totalEarnings)} note="total earnings" />
                <Figure
                  label={sync.applied ? 'Written' : 'To write'}
                  value={`${sync.applied ? (sync.created ?? 0) : sync.toCreate}`}
                  note={sync.applied ? 'new approvals' : money(sync.amountToCreate)}
                />
                <Figure
                  label="Already there"
                  value={`${sync.alreadyImported}`}
                  note="from an earlier sync"
                />
              </dl>

              {sync.failures?.length ? (
                <div className="mt-5">
                  <h3 className="label-cap">Stopped on</h3>
                  <ul className="mt-2 grid gap-2">
                    {sync.failures.map((line) => (
                      <li key={line} className="field-error">
                        {line}
                      </li>
                    ))}
                  </ul>
                  <p className="plain-note mt-2">
                    Nothing after this was written. Fix it and sync again: anything already written
                    is recognised and will not be repeated.
                  </p>
                </div>
              ) : null}

              {sync.issues.length > 0 ? (
                <div className="mt-6">
                  <h3 className="font-display text-[24px]">Not synced</h3>
                  <p className="plain mt-1">
                    These are left alone rather than attributed to the wrong person or written
                    twice.
                  </p>
                  <ul className="mt-3 grid gap-3">
                    {sync.issues.map((issue) => (
                      <li key={issue.kind + issue.detail} className="card-row p-4">
                        <span className="block text-[19px]">{issue.detail}</span>
                        <span className="mt-1 block text-[17px] text-ink-soft">
                          {issue.approvals} approval{issue.approvals === 1 ? '' : 's'} across{' '}
                          {issue.rows} row{issue.rows === 1 ? '' : 's'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!sync.applied && sync.toCreate === 0 && sync.issues.length === 0 ? (
                <p className="mt-4 text-[19px] text-ink-soft">
                  Nothing to write. Everything in this report is already in Ledger.
                </p>
              ) : null}

              {!sync.applied && sync.preview && sync.preview.length > 0 ? (
                <div className="relative -mx-2 mt-6 overflow-x-auto px-2">
                  <table className="w-full min-w-[520px] border-collapse text-left">
                    <thead>
                      <tr className="border-b-2 border-edge">
                        <th className="label-cap px-3 pb-3">Date</th>
                        <th className="label-cap px-3 pb-3">Person</th>
                        <th className="label-cap px-3 pb-3">Card</th>
                        <th className="label-cap px-3 pb-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sync.preview.map((row, index) => (
                        <tr key={index} className="divider-row last:border-0">
                          <td className="tnum px-3 py-3 text-[18px]">{row.approvedOn}</td>
                          <td className="px-3 py-3 text-[18px]">{row.usr || 'House'}</td>
                          <td className="max-w-[260px] truncate px-3 py-3 text-[18px]">{row.card}</td>
                          <td className="tnum px-3 py-3 text-right text-[18px]">{money(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sync.toCreate > sync.preview.length ? (
                    <p className="plain-note mt-3">
                      The first {sync.preview.length} of {sync.toCreate}.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="panel-sunk p-4">
      <dt className="label-cap">{label}</dt>
      <dd className="tnum mt-1 font-display text-[32px] leading-none">{value}</dd>
      <dd className="mt-1 text-[17px] text-ink-soft">{note}</dd>
    </div>
  );
}
