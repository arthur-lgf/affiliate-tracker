'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { BusyLabel } from './Spinner';

/**
 * Which action is in flight, so the spinner appears on the button that was
 * pressed. One shared flag would disable both and spin neither, which on a
 * row of six links is how you lose track of which delete you confirmed.
 */
type Running = null | 'delete';

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

  /**
   * What the button says before the server has agreed.
   *
   * Pausing a link is a boolean write that succeeds essentially always, and it
   * used to cost two waits: one for the PATCH and another for the re-render
   * behind it, with the row spinning throughout. That is a second of watching a
   * spinner to be told the thing you already knew.
   *
   * So the label flips now and the request follows. Null means "no opinion,
   * show what the server said", which is also what it goes back to if the write
   * turns out to fail.
   */
  const [wanted, setWanted] = useState<boolean | null>(null);
  const shown = wanted ?? active;

  /*
   * Clicks can outrun responses. Only the newest one may speak: an older reply
   * landing late must not roll back a state the user has since changed again,
   * and must not raise an error about a value nobody is looking at.
   */
  const latest = useRef(0);

  /*
   * The server has caught up, so this component stops holding an opinion. Not
   * doing this is how an optimistic value quietly becomes a lie: another admin
   * pauses the same link, the refresh brings that back, and this row goes on
   * showing what its own last click wanted.
   */
  useEffect(() => {
    if (wanted !== null && wanted === active) setWanted(null);
  }, [active, wanted]);

  function toggle() {
    const next = !shown;
    const ticket = ++latest.current;

    setWanted(next);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/links/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ active: next }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error ?? `Request failed (${res.status})`);
        }
        if (ticket !== latest.current) return;
        // Kept in a transition so the list re-renders without blanking; the
        // optimistic label stays put until the real one arrives to replace it.
        startTransition(() => router.refresh());
      } catch (err) {
        if (ticket !== latest.current) return;
        setWanted(null);
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    })();
  }

  async function remove() {
    setRunning('delete');
    setError(null);
    try {
      const res = await fetch(`/api/links/${id}`, { method: 'DELETE' });
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
      {/*
        Not disabled while the write is in flight. There is nothing to wait for:
        the label already says what the answer will be, and a second press is a
        legitimate change of mind rather than a double submit.
      */}
      <button
        type="button"
        disabled={running !== null}
        onClick={toggle}
        className="btn-quiet btn-sm"
        aria-label={`${shown ? 'Pause' : 'Activate'} the link for ${label}`}
      >
        {shown ? 'Pause' : 'Activate'}
      </button>
      <button
        type="button"
        disabled={running !== null || pending}
        aria-busy={running === 'delete'}
        onClick={() => {
          if (
            window.confirm(
              `Delete the link for "${label}"? Submissions already logged are kept. Only the link is removed.`,
            )
          ) {
            void remove();
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
