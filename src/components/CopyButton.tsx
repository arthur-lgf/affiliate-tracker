'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Put a string on the clipboard and say so.
 *
 * The label reports the outcome rather than a toast doing it: on a table of
 * fourteen links a message at the top of the page tells you a link was copied
 * but not which one, and "which one" is the entire question when every row
 * looks alike.
 *
 * Three ways to copy, in order, because two of them are not always there:
 * the async clipboard is https-only, execCommand is deprecated but works on
 * the plain-http origins the async one refuses, and if both fail the label
 * says so instead of pretending it worked.
 */
export function CopyButton({
  value,
  label,
  idle = 'Copy',
}: {
  value: string;
  /** The accessible name, e.g. "Copy the link for Cash Back". */
  label: string;
  idle?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // http:// origins other than localhost have no async clipboard.
        const el = document.createElement('textarea');
        el.value = value;
        el.setAttribute('readonly', '');
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        try {
          el.select();
          // execCommand reports failure by returning false, not by throwing.
          if (!document.execCommand('copy')) throw new Error('copy rejected');
        } finally {
          document.body.removeChild(el);
        }
      }
      setState('copied');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 1800);
    } catch {
      setState('error');
      if (timer.current) clearTimeout(timer.current);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      /* The label changes to report the outcome, so it has to be announced. */
      aria-live="polite"
      aria-label={label}
      title={
        state === 'error'
          ? 'The browser refused the clipboard. The link is in the Short link column. Select it there and copy it by hand.'
          : value
      }
      className={state === 'copied' ? 'btn-outline btn-sm' : 'btn-quiet btn-sm'}
    >
      {state === 'copied' ? '✓ Copied' : state === 'error' ? 'Copy failed' : idle}
    </button>
  );
}
