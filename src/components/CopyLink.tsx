'use client';

import { useEffect, useRef, useState } from 'react';

export function CopyLink({ value, compact = false }: { value: string; compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef<HTMLElement | null>(null);

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
      // Leave the URL selected so it can be copied by hand, and keep the
      // message up rather than clearing it after a moment.
      setState('error');
      if (timer.current) clearTimeout(timer.current);
      selectText();
    }
  }

  function selectText() {
    const node = textRef.current;
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  const label = state === 'copied' ? 'Copied' : state === 'error' ? 'Select & copy' : 'Copy';

  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      className="group flex w-full items-center gap-3 border border-rule bg-paper-2/60 px-3 py-2 text-left transition-colors hover:border-ink"
    >
      <code
        ref={textRef}
        className={`min-w-0 flex-1 truncate font-mono ${compact ? 'text-[0.75rem]' : 'text-[0.8125rem]'}`}
      >
        {value}
      </code>
      <span
        aria-live="polite"
        className="shrink-0 font-mono text-[0.625rem] uppercase tracking-[0.14em]"
        style={{
          color:
            state === 'copied'
              ? 'var(--color-ok)'
              : state === 'error'
                ? 'var(--color-signal-2)'
                : 'var(--color-muted)',
        }}
      >
        {label}
      </span>
    </button>
  );
}
