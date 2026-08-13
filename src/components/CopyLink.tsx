'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The shareable URL beside its copy button. On copy failure the text is
 * selected instead, so there is always a way to get the URL out.
 */
export function CopyLink({ value }: { value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function selectText() {
    const node = textRef.current;
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

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
      selectText();
    }
  }

  const shown = value.replace(/^https?:\/\//, '');
  const [path, params] = shown.split('?');

  return (
    <>
      <span className="url-box min-w-0 max-w-full">
        <span ref={textRef} className="truncate" title={value}>
          {path}
          {params ? <span className="text-ink-soft">?{params}</span> : null}
        </span>
      </span>
      <button
        type="button"
        onClick={copy}
        /* The label changes to report the outcome, so it has to be announced. */
        aria-live="polite"
        className={state === 'copied' ? 'btn-outline btn-sm' : 'btn-primary btn-sm'}
      >
        {state === 'copied' ? '✓ Copied' : state === 'error' ? 'Select it' : 'Copy link'}
      </button>
    </>
  );
}
