/**
 * Where a row's overflow menu opens.
 *
 * Kept out of the component because it is arithmetic with edges, not markup,
 * and every one of its cases is invisible until it is wrong: a menu on the
 * bottom row runs off the screen, a menu on the rightmost column opens past
 * the window, a menu taller than the window has nowhere good to go at all. A
 * browser is the worst place to find any of those out.
 *
 * scripts/row-menu-checks.ts holds it to that.
 */

/** Wide enough for "Reset password" on one line. */
export const MENU_WIDTH = 196;

/** Between the trigger and the menu. */
export const GAP = 4;

/** The closest the menu comes to the edge of the window. */
export const MARGIN = 8;

/** Only the parts of a DOMRect this needs, so a check can hand over three numbers. */
export type Anchor = { top: number; bottom: number; right: number };

export type Viewport = { width: number; height: number };

export type Placement = { top: number; left: number };

/**
 * Below the trigger, unless it does not fit and there is room above.
 *
 * "Does not fit" is measured against the margin as well as the menu, or a menu
 * that technically fits would sit flush against the bottom of the window.
 * Where neither side has room it stays below and is clamped: something
 * scrollable and partly visible beats something correctly placed off-screen.
 */
export function placeMenu(anchor: Anchor, menuHeight: number, viewport: Viewport): Placement {
  const below = viewport.height - anchor.bottom;
  const roomBelow = below >= menuHeight + GAP + MARGIN;
  const roomAbove = anchor.top >= menuHeight + GAP + MARGIN;

  const top = !roomBelow && roomAbove ? anchor.top - menuHeight - GAP : anchor.bottom + GAP;

  /*
   * Right-aligned with the trigger, because this button is the last thing in
   * the last column: hung the other way it would open past the window every
   * time. The clamps then keep it inside on both sides, which matters on a
   * narrow screen where the trigger itself is near the left edge.
   */
  const left = Math.min(
    Math.max(MARGIN, anchor.right - MENU_WIDTH),
    Math.max(MARGIN, viewport.width - MENU_WIDTH - MARGIN),
  );

  return { top: Math.max(MARGIN, top), left };
}

/**
 * Whether the row this menu belongs to has scrolled out of the window.
 *
 * The caller closes the menu when it has. A menu still floating over whatever
 * took that row's place is a menu pointing at the wrong person, which on a page
 * whose actions include Delete is worth closing early for.
 */
export function anchorGone(anchor: Anchor, viewport: Viewport): boolean {
  return anchor.bottom < 0 || anchor.top > viewport.height;
}
