'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { anchorGone, MENU_WIDTH, placeMenu, type Placement } from '@/lib/row-menu';
import { Spinner } from './Spinner';

/**
 * The rest of a row's actions, behind one button.
 *
 * A row carries five things you can do to somebody and four of them are rare:
 * a record gets opened constantly, an account gets deleted once. Five buttons
 * of equal weight in a line is a row that has to be read every time rather than
 * scanned, so the two that are used stay on the row and the others move in
 * here.
 *
 * WHY IT IS PORTALLED
 *
 * The accounts table is 1300px wide inside a sideways-scrolling window, and a
 * menu positioned inside that window is clipped by it: the bottom row's menu
 * would be a sliver against the edge and the last column's would be cut in
 * half. This one renders into the body instead and positions itself against
 * its trigger, which is also why it has to follow that trigger while anything
 * scrolls.
 */

/** placeMenu against the window this is actually in. */
function viewportPlace(anchor: DOMRect, menuHeight: number): Placement {
  return placeMenu(anchor, menuHeight, { width: window.innerWidth, height: window.innerHeight });
}

export function RowMenu({
  label,
  disabled = false,
  busy = false,
  busyLabel = 'Working',
  children,
}: {
  /** Names the button for a screen reader, e.g. "More actions for marvin". */
  label: string;
  disabled?: boolean;
  /**
   * One of this menu's own actions is running.
   *
   * Picking an item closes the menu, which takes the button that was showing
   * "Resetting…" off the screen with it. The trigger stands in for it, so the
   * row still says something is happening rather than going quietly dead.
   */
  busy?: boolean;
  /** What is happening, for a screen reader. Replaces the label while busy. */
  busyLabel?: string;
  /** The items. Called with `close` so each one can shut the menu itself. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Back to the button that opened it, or a keyboard user is dropped at the
    // top of the document with no idea where they were.
    trigger.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn-quiet btn-sm px-2"
        disabled={disabled}
        aria-label={busy ? busyLabel : label}
        aria-busy={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {busy ? (
          <Spinner />
        ) : (
          <svg viewBox="0 0 16 4" width="16" height="4" aria-hidden focusable="false">
            <circle cx="2" cy="2" r="1.5" fill="currentColor" />
            <circle cx="8" cy="2" r="1.5" fill="currentColor" />
            <circle cx="14" cy="2" r="1.5" fill="currentColor" />
          </svg>
        )}
      </button>

      {open ? (
        <Menu anchor={trigger} onClose={close}>
          {children(close)}
        </Menu>
      ) : null}
    </>
  );
}

/**
 * The floating half. A separate component so its layout effect only ever runs
 * in a browser: it is mounted by a click, never by the server render.
 */
function Menu({
  anchor,
  onClose,
  children,
}: {
  anchor: { current: HTMLButtonElement | null };
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<Placement | null>(null);

  /** Measure, then place. Before paint, so it never appears in the wrong spot. */
  useLayoutEffect(() => {
    const button = anchor.current;
    const menu = box.current;
    if (!button || !menu) return;
    setAt(viewportPlace(button.getBoundingClientRect(), menu.offsetHeight));
  }, [anchor]);

  /*
   * Follow the trigger while anything scrolls.
   *
   * Capture, because the thing that moves is usually the table's own scrolling
   * window rather than the page, and a scroll event there does not bubble.
   */
  useEffect(() => {
    let frame = 0;
    const follow = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const button = anchor.current;
        const menu = box.current;
        if (!button || !menu) return;
        const rect = button.getBoundingClientRect();
        // The row has scrolled away. A menu left hovering over whatever took
        // its place is a menu pointing at the wrong person.
        if (anchorGone(rect, { width: window.innerWidth, height: window.innerHeight })) {
          onClose();
          return;
        }
        setAt(viewportPlace(rect, menu.offsetHeight));
      });
    };

    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [anchor, onClose]);

  /** Anywhere else closes it, including the button that opened it. */
  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (box.current?.contains(target)) return;
      if (anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [anchor, onClose]);

  const items = useCallback(
    () =>
      Array.from(
        box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
      ),
    [],
  );

  /** Opening puts the keyboard inside, or the menu is unreachable without a mouse. */
  useEffect(() => {
    items()[0]?.focus();
  }, [items]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    // Tab out means done. Closing rather than trapping: this is a menu of four
    // things, not a dialogue, and being unable to leave it by the usual key
    // would be worse than losing your place in it.
    if (event.key === 'Tab') {
      onClose();
      return;
    }

    const list = items();
    if (list.length === 0) return;
    const here = list.indexOf(document.activeElement as HTMLElement);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      list[(here + 1) % list.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      list[(here - 1 + list.length) % list.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      list[list.length - 1]?.focus();
    }
  }

  return createPortal(
    <div
      ref={box}
      role="menu"
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      className="fixed z-50 flex flex-col overflow-hidden border border-edge-strong bg-panel py-1 shadow-[0_6px_20px_rgba(11,34,57,0.14)]"
      style={{
        width: MENU_WIDTH,
        borderRadius: 3,
        top: at?.top ?? 0,
        left: at?.left ?? 0,
        // Placed on the very first frame, so this hides the measuring pass
        // rather than being a state anybody sees.
        visibility: at ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * One line in the menu.
 *
 * Full width and left aligned: a menu is a list to run your eye down, not a row
 * of buttons stacked up.
 */
export function RowMenuItem({
  onClick,
  disabled = false,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="w-full px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-paper-card focus-visible:bg-paper-card disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
