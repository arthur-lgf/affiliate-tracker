'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function LinkActions({
  id,
  active,
  label,
}: {
  id: string;
  active: boolean;
  label: string;
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
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => send('PATCH', { active: !active })}
        className="btn btn-ghost !px-3 !py-1.5 !text-[0.625rem]"
      >
        {active ? 'Pause' : 'Activate'}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (
            window.confirm(
              `Delete the link for "${label}"? Submissions already logged are kept — only the link is removed.`,
            )
          ) {
            void send('DELETE');
          }
        }}
        className="btn btn-ghost !px-3 !py-1.5 !text-[0.625rem] hover:!border-signal hover:!bg-signal"
      >
        Delete
      </button>
      {error ? <span className="field-error !mt-0">{error}</span> : null}
    </div>
  );
}
