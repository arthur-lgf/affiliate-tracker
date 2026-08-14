'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { BusyLabel } from './Spinner';

/** Remove an approval recorded by mistake. Earnings are a money figure — there
 *  has to be a way to take back a fat-fingered one without opening the sheet. */
export function DeleteApproval({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Remove the approval for ${label}? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversions/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Request failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove it');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={remove}
        className="btn-danger btn-sm"
        aria-label={`Remove the approval for ${label}`}
      >
        <BusyLabel busy={busy} idle="Remove" busyLabel="Removing…" />
      </button>
      {error ? (
        <span role="alert" className="field-error basis-full">
          {error}
        </span>
      ) : null}
    </>
  );
}
