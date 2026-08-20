'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { scrollEnds, scrollStep } from '@/lib/table-scroll';

/**
 * A wide table in its own sideways-scrolling window, with the buttons for
 * moving it sitting above it.
 *
 * A QMP report can be twenty columns across, and a trackpad swipe is the only
 * other way to reach the far end of one. That is fine on a laptop and no use at
 * all on a mouse: the horizontal scrollbar is at the bottom of the table, which
 * on a full page is off the screen, so the columns on the right may as well not
 * be there. These two buttons are the same movement, in reach, above the rows
 * rather than below them.
 *
 * They are only drawn when the table is actually wider than its window. A pair
 * of permanently dead buttons over a table that already fits would be furniture
 * that never does anything.
 */
export function TableScroller({
  children,
  label,
  className = '',
}: {
  children: ReactNode;
  /** Names the region for a screen reader, e.g. "Report rows". */
  label: string;
  className?: string;
}) {
  const window_ = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ left: false, right: false });

  /**
   * Re-read where the table sits. Returning the current object when nothing
   * moved keeps this from re-rendering on every scroll event, and keeps the
   * ResizeObserver below from resizing itself in a loop.
   */
  const measure = useCallback(() => {
    const el = window_.current;
    if (!el) return;
    setEnds((current) => {
      const next = scrollEnds(el.scrollLeft, el.clientWidth, el.scrollWidth);
      return next.left === current.left && next.right === current.right ? current : next;
    });
  }, []);

  useEffect(() => {
    const el = window_.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });

    /*
     * The window changing size is the obvious case; the table inside changing
     * size is the one that bites. Switch the row count from 10 to 250 and the
     * columns re-fit around the widest cell now on screen, so a table that fit
     * a moment ago no longer does, with no scroll and no window resize to say
     * so. Watching the child covers it.
     */
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);

    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [measure]);

  function move(direction: -1 | 1) {
    const el = window_.current;
    if (!el) return;
    const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    el.scrollBy({
      left: direction * scrollStep(el.clientWidth),
      behavior: still ? 'auto' : 'smooth',
    });
  }

  const overflows = ends.left || ends.right;

  return (
    <div className={className}>
      {overflows ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="label-cap">Scroll</span>
          <button
            type="button"
            className="btn-quiet btn-sm"
            onClick={() => move(-1)}
            disabled={!ends.left}
          >
            ← Left
          </button>
          <button
            type="button"
            className="btn-quiet btn-sm"
            onClick={() => move(1)}
            disabled={!ends.right}
          >
            Right →
          </button>
        </div>
      ) : null}

      {/*
        Wide content scrolls inside its own window so the page never does.
        `relative` keeps any absolutely positioned descendant from resolving
        against the document and stretching it. The region is focusable on
        purpose: that is what lets a keyboard scroll it with the arrow keys,
        which is the same job the buttons do for a mouse.
      */}
      <div
        ref={window_}
        role="region"
        aria-label={label}
        tabIndex={0}
        className={`relative -mx-2 overflow-x-auto px-2 ${overflows ? 'mt-3' : ''}`}
      >
        {children}
      </div>
    </div>
  );
}
