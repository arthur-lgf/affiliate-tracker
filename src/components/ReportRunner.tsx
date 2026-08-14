'use client';

import { useMemo, useRef, useState } from 'react';
import {
  alignsRight,
  BLANK,
  columnKind,
  formatCell,
  pageBounds,
  sortRows,
  type ColumnKind,
  type SortDirection,
} from '@/lib/report-table';
import { BusyLabel } from './Spinner';

type ResolvedRow = { usr: string; person: string; leadRef: string; client: string };

type RunResult = {
  columns: string[];
  /** Only the rows whose var2 matches a live tracking key. */
  rows: Record<string, unknown>[];
  rowCount: number;
  /** Everything QMP returned, before that filter. */
  reportRowCount: number;
  /** Person and client for each kept row, same order. */
  resolved: ResolvedRow[];
  hidden: number;
  hiddenKeys: string[];
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
  preview?: {
    approvedOn: string;
    slug: string;
    usr: string;
    amount: number;
    card: string;
    client: string;
  }[];
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

/**
 * A report row and the two things Ledger knows about it, kept together.
 *
 * One object rather than two arrays read by the same index, because the table
 * sorts now: an index that means "row 4" in one array and "row 4 before it was
 * sorted" in the other is how a person's name ends up beside somebody else's
 * money.
 */
type Line = { row: Record<string, unknown>; person: string; client: string };

/** The sortable columns: the two resolved ones, then whatever QMP sent. */
const PERSON_KEY = 'ledger:person';
const CLIENT_KEY = 'ledger:client';

const PER_PAGE_OPTIONS = [25, 50, 100, 250];

function readCell(line: Line, key: string): unknown {
  if (key === PERSON_KEY) return line.person;
  if (key === CLIENT_KEY) return line.client;
  return line.row[key];
}

export function ReportRunner({ reportId, app, baseUrl }: { reportId: string; app: string; baseUrl: string }) {
  const [startDate, setStartDate] = useState(utcDay(-30));
  const [endDate, setEndDate] = useState(utcDay(0));
  const [useRange, setUseRange] = useState(true);

  const [busy, setBusy] = useState(false);
  /** Which of the two credentialed calls is in flight, so one button spins. */
  const [running, setRunning] = useState<null | 'report' | 'check'>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [sync, setSync] = useState<SyncResult | null>(null);
  /** null, or which of the two sync buttons is running. */
  const [syncing, setSyncing] = useState<null | 'preview' | 'apply'>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  /** The report joined to what Ledger knows, once, rather than per render. */
  const lines = useMemo<Line[]>(() => {
    if (!result) return [];
    return result.rows.map((row, index) => ({
      row,
      person: result.resolved[index]?.person ?? '',
      client: result.resolved[index]?.client ?? BLANK,
    }));
  }, [result]);

  /**
   * What each column holds, decided once over every row rather than per page.
   * Deciding it per page would let a column of counts turn into a column of
   * text on page 4 because that page happens to hold the one odd value.
   */
  const kinds = useMemo(() => {
    const map = new Map<string, ColumnKind>();
    map.set(PERSON_KEY, 'text');
    map.set(CLIENT_KEY, 'text');
    for (const column of result?.columns ?? []) {
      map.set(
        column,
        columnKind(
          column,
          lines.map((line) => line.row[column]),
        ),
      );
    }
    return map;
  }, [result, lines]);

  const sorted = useMemo(() => {
    if (!sort) return lines;
    return sortRows(
      lines,
      (line) => readCell(line, sort.key),
      kinds.get(sort.key) ?? 'text',
      sort.direction,
    );
  }, [lines, sort, kinds]);

  const bounds = pageBounds(sorted.length, page, perPage);
  const visible = sorted.slice((bounds.current - 1) * perPage, bounds.current * perPage);

  /** Ascending, then descending, then back to the order QMP sent. */
  function toggleSort(key: string) {
    setPage(1);
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: 'asc' };
      if (current.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  }

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
    setRunning('check');
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
    setRunning(null);
  }

  async function runReport() {
    setBusy(true);
    setRunning('report');
    setError(null);
    setResult(null);
    setShowRaw(false);
    // A new report is a new table. Keeping page 7 and a sort on a column the
    // next report may not even have would open it on an empty screen.
    setSort(null);
    setPage(1);

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
    setRunning(null);
  }

  /**
   * `apply: false` plans, `apply: true` writes. The server fetches the report
   * again either way, so what gets written is what QMP says now, not what this
   * page happens to be holding.
   */
  async function runSync(apply: boolean) {
    setSyncing(apply ? 'apply' : 'preview');
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
    setSyncing(null);
  }

  /**
   * The rows as shown, with the two resolved columns in front of QMP's own.
   *
   * Three deliberate choices. It is the reconciled set, not the raw report —
   * what is on screen is the part that matches a live tracking key. It is
   * every row of that set, not the page being looked at. And the values go out
   * exactly as QMP sent them, without the $ and % this table adds, because the
   * thing opening this file is a spreadsheet and a spreadsheet wants a number
   * it can add up.
   */
  function downloadCsv() {
    if (!result) return;
    const cell = (value: unknown) => {
      const text = cellText(value);
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [['Person', 'Client', ...result.columns].map(cell).join(',')];
    for (const line of sorted) {
      csv.push(
        [
          cell(line.person),
          cell(line.client),
          ...result.columns.map((column) => cell(line.row[column])),
        ].join(','),
      );
    }

    const blob = new Blob([`﻿${csv.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
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

            {/* `busy` covers both buttons because both spend the same
                credentials, but only the one that was pressed spins. A report
                against a wide date range is the longest wait in the app. */}
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={runReport}
                disabled={busy}
                aria-busy={running === 'report'}
                className="btn-primary"
              >
                <BusyLabel
                  busy={running === 'report'}
                  idle="Run report"
                  busyLabel="Asking QMP…"
                />
              </button>
              <button
                type="button"
                onClick={runCheck}
                disabled={busy}
                aria-busy={running === 'check'}
                className="btn-outline"
              >
                <BusyLabel
                  busy={running === 'check'}
                  idle="Check connection"
                  busyLabel="Checking…"
                />
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

          <p className="plain mt-2">
            Only rows whose <code>var2</code> matches a live tracking key. That is the column each
            link carries its <code>usr</code> in, so it is what says whose row this is;{' '}
            <code>var3</code> is the lead reference, which is what names the client.
          </p>

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
              {result.hidden > 0
                ? `QMP returned ${result.reportRowCount.toLocaleString()} row${
                    result.reportRowCount === 1 ? '' : 's'
                  }, and none of them carry a var2 that matches a link here.`
                : 'QMP answered, but no rows were found in the response'}
              {result.hidden > 0
                ? ''
                : result.shape === 'unrecognised'
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
                    {/* Ledger's two columns first: they are the reason to read
                        the table, and the QMP ones are the evidence for them. */}
                    <SortHeader
                      label="Person"
                      sortKey={PERSON_KEY}
                      sort={sort}
                      onSort={toggleSort}
                      right={false}
                    />
                    <SortHeader
                      label="Client"
                      sortKey={CLIENT_KEY}
                      sort={sort}
                      onSort={toggleSort}
                      right={false}
                    />
                    {result.columns.map((column) => (
                      <SortHeader
                        key={column}
                        label={column}
                        sortKey={column}
                        sort={sort}
                        onSort={toggleSort}
                        right={alignsRight(kinds.get(column) ?? 'text')}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((line, index) => {
                    const named = line.client !== BLANK;
                    return (
                      <tr key={`${bounds.current}:${index}`} className="divider-row last:border-0">
                        <td className="max-w-[220px] truncate px-3 py-3 text-[18px] font-semibold">
                          {line.person}
                        </td>
                        {/* A dash is the answer when var3 names nobody, and it
                            is dimmed so it reads as "not known" rather than as
                            a value somebody typed. */}
                        <td
                          className={`max-w-[220px] truncate px-3 py-3 text-[18px] ${
                            named ? '' : 'text-ink-dim'
                          }`}
                        >
                          {line.client}
                        </td>
                        {result.columns.map((column) => {
                          const kind = kinds.get(column) ?? 'text';
                          const text = formatCell(line.row[column], kind);
                          return (
                            <td
                              key={column}
                              className={`max-w-[320px] truncate px-3 py-3 text-[18px] ${
                                alignsRight(kind) ? 'tnum text-right' : ''
                              } ${text === BLANK ? 'text-ink-dim' : ''}`}
                            >
                              {text}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {result.rowCount > 0 ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
              <span className="text-[19px] text-ink-soft" role="status">
                Showing {bounds.from.toLocaleString()}–{bounds.to.toLocaleString()} of{' '}
                {sorted.length.toLocaleString()}
                {sort ? ', sorted' : ''}
              </span>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2.5 text-[18px] text-ink-soft">
                  Rows
                  <select
                    className="field"
                    style={{ minHeight: '48px', fontSize: '18px', padding: '0 12px' }}
                    value={perPage}
                    onChange={(event) => {
                      setPerPage(Number(event.target.value));
                      setPage(1);
                    }}
                  >
                    {PER_PAGE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn-quiet btn-sm"
                  onClick={() => setPage(bounds.current - 1)}
                  disabled={bounds.current <= 1}
                >
                  ← Previous
                </button>
                <span className="tnum text-[18px] font-semibold">
                  Page {bounds.current} of {bounds.pages}
                </span>
                <button
                  type="button"
                  className="btn-quiet btn-sm"
                  onClick={() => setPage(bounds.current + 1)}
                  disabled={bounds.current >= bounds.pages}
                >
                  Next →
                </button>
              </div>
            </div>
          ) : null}

          {result.hidden > 0 ? (
            <p className="plain-note mt-4">
              {result.hidden.toLocaleString()} row{result.hidden === 1 ? '' : 's'} of the{' '}
              {result.reportRowCount.toLocaleString()} QMP returned{' '}
              {result.hidden === 1 ? 'is' : 'are'} not shown: their var2 matches no link here (
              {result.hiddenKeys.slice(0, 6).join(', ')}
              {result.hiddenKeys.length > 6 ? `, and ${result.hiddenKeys.length - 6} more` : ''}).
              The sync leaves those alone too.
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
            them so the total stays exact. <code>var2</code> is matched to a link to work out whose
            it is, and <code>var3</code> is kept on the approval so it can be traced back to the
            client it came from.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => runSync(false)}
              disabled={Boolean(syncing) || busy}
              aria-busy={syncing === 'preview'}
              className="btn-outline"
            >
              <BusyLabel
                busy={syncing === 'preview'}
                idle="Preview sync"
                busyLabel="Working out the plan…"
              />
            </button>
            {sync && !sync.applied && sync.toCreate > 0 ? (
              <button
                type="button"
                onClick={() => runSync(true)}
                disabled={Boolean(syncing)}
                aria-busy={syncing === 'apply'}
                className="btn-gold"
              >
                {/* The one button in the app that writes money. It re-fetches
                    the report before writing, so the wait is two round trips
                    and the spinner has to hold for both. */}
                <BusyLabel
                  busy={syncing === 'apply'}
                  idle={
                    <>
                      Write {sync.toCreate} approval{sync.toCreate === 1 ? '' : 's'} (
                      {money(sync.amountToCreate)})
                    </>
                  }
                  busyLabel="Writing approvals…"
                />
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
                  <table className="w-full min-w-[640px] border-collapse text-left">
                    <thead>
                      <tr className="border-b-2 border-edge">
                        <th className="label-cap px-3 pb-3">Date</th>
                        <th className="label-cap px-3 pb-3">Person</th>
                        <th className="label-cap px-3 pb-3">Client</th>
                        <th className="label-cap px-3 pb-3">Card</th>
                        <th className="label-cap px-3 pb-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sync.preview.map((row, index) => (
                        <tr key={index} className="divider-row last:border-0">
                          <td className="tnum px-3 py-3 text-[18px]">{row.approvedOn}</td>
                          <td className="px-3 py-3 text-[18px]">{row.usr || 'House'}</td>
                          <td
                            className={`max-w-[200px] truncate px-3 py-3 text-[18px] ${
                              row.client && row.client !== '-' ? '' : 'text-ink-dim'
                            }`}
                          >
                            {row.client || '-'}
                          </td>
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

/**
 * A column heading you can sort by.
 *
 * A real <button> inside the <th>, not a click handler on the cell: sorting a
 * table is an action, and an action has to be reachable by keyboard and
 * announced as one. `aria-sort` on the header is what tells a screen reader
 * which column the order is coming from.
 *
 * The arrow is always rendered, dimmed when the column is not the one in play,
 * so the heading row does not reflow when a sort is applied.
 */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  right,
}: {
  label: string;
  sortKey: string;
  sort: { key: string; direction: SortDirection } | null;
  onSort: (key: string) => void;
  right: boolean;
}) {
  const active = sort?.key === sortKey;
  const direction = active ? sort.direction : null;

  return (
    <th
      scope="col"
      className="whitespace-nowrap p-0 pb-3"
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`label-cap flex w-full items-center gap-1.5 rounded-lg px-3 py-1 hover:text-ink ${
          right ? 'justify-end' : 'justify-start'
        }`}
        title={
          direction === 'asc'
            ? `Sorted by ${label}, lowest first. Click for highest first.`
            : direction === 'desc'
              ? `Sorted by ${label}, highest first. Click to clear.`
              : `Sort by ${label}`
        }
      >
        {label}
        <span aria-hidden className={active ? 'text-ink' : 'text-ink-dim'}>
          {direction === 'desc' ? '↓' : '↑'}
        </span>
      </button>
    </th>
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
