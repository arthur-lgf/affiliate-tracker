'use client';

import { useEffect, useRef, useState } from 'react';
import { BusyLabel } from '@/components/Spinner';

/**
 * A masked number, and a button that asks for the real one.
 *
 * The mask is what the page renders; the plaintext only ever arrives in
 * response to a press. That is the whole design — a screen listing people
 * should not be able to become a screen listing Social Security numbers just
 * by being opened, and a number nobody asked for is a number that can be
 * shoulder-read, screenshotted into a ticket, or left up on a shared monitor.
 *
 * It hides itself again after a minute for the same reason.
 */
export function RevealSecret({
  userId,
  what,
  masked,
  label,
}: {
  userId: string;
  what: 'tin' | 'account';
  masked: string;
  label: string;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/onboarding/${encodeURIComponent(userId)}/reveal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ what }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Could not read it.');
        return;
      }
      setValue(String(data.value ?? ''));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setValue(null), 60_000);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  function hide() {
    if (timer.current) clearTimeout(timer.current);
    setValue(null);
  }

  return (
    <div>
      <span className="field-label">{label}</span>
      <span className="mt-1.5 flex flex-wrap items-center gap-3">
        <code className="tnum text-[14px] font-semibold">{value ?? masked}</code>
        {value === null ? (
          <button type="button" className="btn-quiet btn-sm" onClick={reveal} disabled={busy}>
            <BusyLabel busy={busy} idle="Reveal" busyLabel="Reading…" />
          </button>
        ) : (
          <button type="button" className="btn-quiet btn-sm" onClick={hide}>
            Hide
          </button>
        )}
      </span>
      {value !== null ? (
        <span className="mt-1 block text-[11px] text-ink-dim">Hides itself in a minute.</span>
      ) : null}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
