'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The shareable URL as a pill, with copy folded into it. On copy failure the
 * text is selected instead, so there is always a way to get the URL out.
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

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex min-w-0 items-center rounded-full bg-pine-900 px-3.5 py-1.5">
        <span ref={textRef} className="truncate text-[11.5px] text-sage" title={value}>
          {value.replace(/^https?:\/\//, '')}
        </span>
      </span>
      <button
        type="button"
        onClick={copy}
        aria-live="polite"
        className="flex-none rounded-full border border-pine-700 px-3 py-1.5 text-[11px] font-medium transition-colors hover:border-mustard hover:text-mustard"
        style={{
          color:
            state === 'copied'
              ? 'var(--color-moss)'
              : state === 'error'
                ? 'var(--color-mustard)'
                : 'var(--color-cream)',
          borderColor: state === 'copied' ? 'var(--color-moss)' : undefined,
        }}
      >
        {state === 'copied' ? 'Copied' : state === 'error' ? 'Select' : 'Copy'}
      </button>
    </div>
  );
}
