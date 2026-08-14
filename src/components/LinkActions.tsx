'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function LinkActions({
  id,
  active,
  label,
  previewUrl,
}: {
  id: string;
  active: boolean;
  label: string;
  previewUrl?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: 'PATCH' | 'DELETE', body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/links/${id}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Request failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || pending;

  return (
    <>
      {previewUrl ? (
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-outline btn-sm"
        >
          Preview ↗
        </a>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => send('PATCH', { active: !active })}
        className="btn-quiet btn-sm"
        aria-label={`${active ? 'Pause' : 'Activate'} the link for ${label}`}
      >
        {active ? 'Pause' : 'Activate'}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (
            window.confirm(
              `Delete the link for "${label}"? Submissions already logged are kept. Only the link is removed.`,
            )
          ) {
            void send('DELETE');
          }
        }}
        className="btn-danger btn-sm"
        aria-label={`Delete the link for ${label}`}
      >
        Delete
      </button>
      {error ? (
        <span role="alert" className="field-error basis-full">
          {error}
        </span>
      ) : null}
    </>
  );
}
