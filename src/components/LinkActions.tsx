'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { BusyLabel } from './Spinner';

/**
 * Which action is in flight, so the spinner appears on the button that was
 * pressed. One shared flag would disable both and spin neither, which on a
 * row of six links is how you lose track of which delete you confirmed.
 */
type Running = null | 'toggle' | 'delete';

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
  const [running, setRunning] = useState<Running>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(what: Exclude<Running, null>, method: 'PATCH' | 'DELETE', body?: unknown) {
    setRunning(what);
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
      setRunning(null);
    }
  }

  // The row keeps spinning through the refresh that follows, because until the
  // list re-renders the change has not actually shown up anywhere.
  const disabled = running !== null || pending;

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
        aria-busy={running === 'toggle'}
        onClick={() => send('toggle', 'PATCH', { active: !active })}
        className="btn-quiet btn-sm"
        aria-label={`${active ? 'Pause' : 'Activate'} the link for ${label}`}
      >
        <BusyLabel
          busy={running === 'toggle'}
          idle={active ? 'Pause' : 'Activate'}
          busyLabel={active ? 'Pausing…' : 'Activating…'}
        />
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-busy={running === 'delete'}
        onClick={() => {
          if (
            window.confirm(
              `Delete the link for "${label}"? Submissions already logged are kept. Only the link is removed.`,
            )
          ) {
            void send('delete', 'DELETE');
          }
        }}
        className="btn-danger btn-sm"
        aria-label={`Delete the link for ${label}`}
      >
        <BusyLabel busy={running === 'delete'} idle="Delete" busyLabel="Deleting…" />
      </button>
      {error ? (
        <span role="alert" className="field-error basis-full">
          {error}
        </span>
      ) : null}
    </>
  );
}
