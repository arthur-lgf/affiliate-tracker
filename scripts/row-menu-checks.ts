// Where a row's overflow menu opens.
//
// The accounts table puts this button in the last column of a 1300px table
// inside a sideways-scrolling window, which is the worst position on the page:
// every edge case here is one an admin meets on the last row of a full screen,
// where the menu holds Disable and the row beside it holds Delete. Pinned
// rather than eyeballed, because a menu placed off-screen looks like a button
// that did nothing.
//
//   npx tsx scripts/row-menu-checks.ts
import { anchorGone, GAP, MARGIN, MENU_WIDTH, placeMenu } from '../src/lib/row-menu';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name, extra === undefined ? '' : extra);
  }
}

/** A laptop window. */
const SCREEN = { width: 1440, height: 900 };

/** A trigger part way down the page, near the right edge of the table. */
const MIDDLE = { top: 400, bottom: 424, right: 1300 };

const MENU = 132;

console.log('— the ordinary case —');
{
  const at = placeMenu(MIDDLE, MENU, SCREEN);
  check('opens just below the button', at.top === MIDDLE.bottom + GAP, at);
  check('right edge lines up with the button', at.left === MIDDLE.right - MENU_WIDTH, at);
  check('and so sits fully inside the window', at.left + MENU_WIDTH <= SCREEN.width - MARGIN, at);
}

console.log('— the last row —');
{
  // Low enough that a menu below it would run past the bottom.
  const low = { top: 820, bottom: 844, right: 1300 };
  const at = placeMenu(low, MENU, SCREEN);
  check('flips above the button', at.top === low.top - MENU - GAP, at);
  check('so the whole menu is on screen', at.top + MENU <= SCREEN.height - MARGIN, at);
  check('and it is above, not below', at.top < low.top, at);
}

console.log('— the boundary between the two —');
{
  // Exactly enough room below: the menu, the gap, and the margin off the edge.
  const exact = { top: 400, bottom: SCREEN.height - (MENU + GAP + MARGIN), right: 1300 };
  check(
    'a menu that just fits below stays below',
    placeMenu(exact, MENU, SCREEN).top === exact.bottom + GAP,
  );

  // One pixel less, and it has to go the other way.
  const tight = { ...exact, bottom: exact.bottom + 1 };
  check(
    'one pixel short of fitting, it flips',
    placeMenu(tight, MENU, SCREEN).top === tight.top - MENU - GAP,
  );
}

console.log('— nowhere to go —');
{
  // Taller than the window, so neither side has room. It must still be
  // reachable from the top of the screen rather than placed at a negative
  // offset, where the first item would be unclickable.
  const cramped = { top: 300, bottom: 324, right: 1300 };
  const at = placeMenu(cramped, 2000, { width: 1440, height: 700 });
  check('never opens above the top of the window', at.top >= MARGIN, at);
  check('stays below the button when there is no room either way', at.top === cramped.bottom + GAP, at);
}

console.log('— narrow screens —');
{
  const phone = { width: 380, height: 700 };
  const at = placeMenu({ top: 200, bottom: 224, right: 370 }, MENU, phone);
  check('never opens off the left edge', at.left >= MARGIN, at);
  check('never opens off the right edge', at.left + MENU_WIDTH <= phone.width - MARGIN, at);

  // A trigger at the very left: right-aligning alone would put it off-screen.
  const hard = placeMenu({ top: 200, bottom: 224, right: 40 }, MENU, phone);
  check('a button at the left edge still gets a menu on screen', hard.left === MARGIN, hard);
}

console.log('— a window narrower than the menu —');
{
  const sliver = { width: 150, height: 700 };
  const at = placeMenu({ top: 100, bottom: 124, right: 140 }, MENU, sliver);
  check('clamps to the margin rather than going negative', at.left === MARGIN, at);
}

console.log('— when the row has scrolled away —');
{
  check(
    'a row above the window counts as gone',
    anchorGone({ top: -60, bottom: -36, right: 900 }, SCREEN),
  );
  check(
    'a row below the window counts as gone',
    anchorGone({ top: 980, bottom: 1004, right: 900 }, SCREEN),
  );
  check('a row on screen does not', !anchorGone(MIDDLE, SCREEN));
  check(
    'a row half off the top is still there',
    !anchorGone({ top: -10, bottom: 14, right: 900 }, SCREEN),
  );
  check(
    'a row flush with the bottom is still there',
    !anchorGone({ top: SCREEN.height - 1, bottom: SCREEN.height + 20, right: 900 }, SCREEN),
  );
}

console.log(`row-menu: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
