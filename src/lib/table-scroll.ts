/**
 * Moving a wide table sideways from a pair of buttons.
 *
 * Two small sums, kept out of the component because both are off-by-one traps
 * rather than markup. A browser reports scroll widths in fractions of a pixel,
 * so a table scrolled fully to the right lands a third of a pixel short of its
 * own end; compared exactly, the "Right" button would stay lit forever with
 * nothing left to show. And a step measured as a whole viewport would jump the
 * columns you were reading clean off the screen, so it is deliberately less
 * than one.
 *
 * scripts/table-scroll-checks.ts holds both to that.
 */

/** How much of the visible width one press moves. Less than all of it. */
const STEP_SHARE = 0.8;

/** The smallest useful press, for a narrow phone where 80% is a few columns. */
const MIN_STEP = 200;

/** Sub-pixel slack, so a fully scrolled table counts as fully scrolled. */
const EDGE_SLACK = 1;

/**
 * How far one press of a scroll button should move the table, in pixels.
 *
 * Never further than the viewport itself: some of what you were reading stays
 * on screen, which is what makes it a scroll rather than a page turn.
 */
export function scrollStep(viewport: number): number {
  if (!Number.isFinite(viewport) || viewport <= 0) return MIN_STEP;
  return Math.max(Math.min(MIN_STEP, viewport), Math.round(viewport * STEP_SHARE));
}

/**
 * Whether there is anything further to scroll to, each way.
 *
 * Both false means the table fits and the buttons have no work to do, which is
 * how the caller knows not to draw them at all.
 */
export function scrollEnds(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): { left: boolean; right: boolean } {
  const furthest = scrollWidth - clientWidth;
  if (!Number.isFinite(furthest) || furthest <= EDGE_SLACK) return { left: false, right: false };
  const at = Math.min(Math.max(scrollLeft, 0), furthest);
  return { left: at > EDGE_SLACK, right: at < furthest - EDGE_SLACK };
}
