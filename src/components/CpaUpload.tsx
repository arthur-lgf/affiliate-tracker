'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { BusyLabel } from './Spinner';

type Result = {
  rows: number;
  scaffold: number;
  issues: { line: number; detail: string }[];
  reportDate: string;
  updatedAt: string;
};

/**
 * Replacing the rate card.
 *
 * The file is read here and posted as text, so the server never has to hold a
 * multipart body or a temp file. It is a spreadsheet export of a few hundred
 * rows; reading it in the browser costs nothing and the round trip is one JSON
 * request.
 *
 * Admin only, and enforced by the route rather than by this component being
 * hidden — a hidden control is still a URL anyone can post to.
 */
export function CpaUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setHint(null);
    setResult(null);
    try {
      const text = await file.text();
      const response = await fetch('/api/cpa', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: file.name, text }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || `Upload failed (${response.status}).`);
        setHint(data.hint ?? null);
        return;
      }
      setResult(data as Result);
      // The table is server-rendered from the store, so the new card arrives
      // the same way the old one did rather than being patched in here.
      startTransition(() => router.refresh());
    } catch {
      setError('Could not read that file.');
    } finally {
      setBusy(false);
      // Clear the picker so choosing the same file again still fires a change.
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-4">
        <input
          ref={input}
          id="cpa-file"
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <label htmlFor="cpa-file" className={`btn-gold ${busy ? 'pointer-events-none' : ''}`}>
          <BusyLabel busy={busy} idle="Upload a new report" busyLabel="Reading the file…" />
        </label>
        <p className="text-[12px] text-ink-soft">
          The CPA report from QMP, saved as CSV. In Excel: File → Save As → CSV.
        </p>
      </div>

      {error ? (
        <p role="alert" className="field-error mt-4">
          {error}
          {hint ? <span className="mt-1 block font-normal">{hint}</span> : null}
        </p>
      ) : null}

      {result ? (
        <p role="status" className="mt-4 text-[13px] text-leaf-text">
          {result.rows.toLocaleString()} rate{result.rows === 1 ? '' : 's'} loaded
          {result.scaffold > 0
            ? `, and ${result.scaffold} grouping row${result.scaffold === 1 ? '' : 's'} skipped`
            : ''}
          .{result.issues.length > 0 ? ` ${result.issues.length} row(s) could not be read.` : ''}
        </p>
      ) : null}

      {result && result.issues.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {result.issues.map((issue) => (
            <li key={`${issue.line}:${issue.detail}`} className="plain-note">
              Line {issue.line}: {issue.detail}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
