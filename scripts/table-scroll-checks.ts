// Moving a wide table sideways.
//
// Both sums here decide whether a button is lit, and a button that lies is
// worse than no button: "Right" still lit at the far end of the table is a
// press that does nothing, and a press that jumps a whole viewport loses the
// column you were reading. So the fractional-pixel end and the size of a step
// are both pinned.
//
//   npx tsx scripts/table-scroll-checks.ts
import { scrollEnds, scrollStep } from '../src/lib/table-scroll';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

console.log('— ends —');
const fits = scrollEnds(0, 900, 900);
check('a table that fits needs no buttons', !fits.left && !fits.right);

const start = scrollEnds(0, 900, 2400);
check('at the start there is nothing to the left', !start.left);
check('and everything to the right', start.right);

const middle = scrollEnds(700, 900, 2400);
check('mid-scroll goes both ways', middle.left && middle.right);

const end = scrollEnds(1500, 900, 2400);
check('at the end there is nothing to the right', !end.right);
check('but there is to the left', end.left);

// A browser reports these as fractions on a scaled display, and the end of the
// table lands a sliver short of the arithmetic end.
const nearlyEnd = scrollEnds(1499.6, 900.4, 2400);
check('a sliver short of the end still counts as the end', !nearlyEnd.right);
const nearlyStart = scrollEnds(0.4, 900, 2400);
check('a sliver past the start still counts as the start', !nearlyStart.left);

const hair = scrollEnds(0, 900, 900.5);
check('half a pixel of overflow is not worth a button', !hair.left && !hair.right);

const overscrolled = scrollEnds(9999, 900, 2400);
check('a scroll position past the end clamps', !overscrolled.right && overscrolled.left);
const negative = scrollEnds(-40, 900, 2400);
check('and a bounced one before the start clamps too', !negative.left && negative.right);

const unmeasured = scrollEnds(0, 0, 0);
check('an unmeasured element asks for nothing', !unmeasured.left && !unmeasured.right);

console.log('\n— step —');
check('a press moves less than a full viewport', scrollStep(1000) < 1000);
check('and most of one', scrollStep(1000) === 800);
check('a narrow phone still moves a useful amount', scrollStep(320) === 256);
check('a very narrow one never overshoots its own width', scrollStep(120) <= 120);
check('and still moves', scrollStep(120) > 0);
check('a whole number of pixels', Number.isInteger(scrollStep(377)));
check('an unmeasured width falls back rather than freezing', scrollStep(0) > 0);
check('and so does a nonsense one', scrollStep(Number.NaN) > 0);

console.log(`\ntable-scroll: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
