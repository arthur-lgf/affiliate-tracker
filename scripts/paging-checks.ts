// Reading a long list a page at a time.
//
// The bounds are what the Previous/Next buttons are wired to and what the slice
// is taken with, so an off-by-one here is a row nobody can reach. The clamping
// matters just as much: every screen holds `page` in state and none of them are
// told when the list underneath gets shorter, so a filter that cuts 400 rows to
// 12 must not leave the reader staring at an empty page 8.
//
//   npx tsx scripts/paging-checks.ts
import { PAGE_SIZES, pageBounds, pageSlice } from '../src/lib/paging';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

console.log('— sizes —');
check('the smallest size leads', PAGE_SIZES[0] === Math.min(...PAGE_SIZES));
check('and every size is bigger than the last', PAGE_SIZES.every((size, i) => i === 0 || size > PAGE_SIZES[i - 1]!));
check('ten is the default page', PAGE_SIZES[0] === 10);

console.log('\n— pages —');
const p1 = pageBounds(358, 1, 50);
check('page 1 starts at 1', p1.from === 1 && p1.to === 50);
check('and there are 8 pages', p1.pages === 8);
const last = pageBounds(358, 8, 50);
check('the last page stops at the last row', last.from === 351 && last.to === 358);
const beyond = pageBounds(358, 99, 50);
check('a page past the end clamps', beyond.current === 8 && beyond.to === 358);
const before = pageBounds(358, 0, 50);
check('a page before the start clamps', before.current === 1 && before.from === 1);
const none = pageBounds(0, 1, 50);
check('no rows means no first row', none.from === 0 && none.to === 0);
check('but still one page', none.pages === 1);
const exact = pageBounds(100, 2, 50);
check('an exact fit has no empty last page', exact.pages === 2 && exact.to === 100);
const one = pageBounds(1, 1, 50);
check('a single row is 1 to 1', one.from === 1 && one.to === 1 && one.pages === 1);

console.log('\n— slices —');
const items = Array.from({ length: 23 }, (_, i) => i + 1);
check('the first page is the first ten', pageSlice(items, 1, 10).join() === '1,2,3,4,5,6,7,8,9,10');
check('the second picks up where it left off', pageSlice(items, 2, 10)[0] === 11);
check('the last page is the remainder', pageSlice(items, 3, 10).join() === '21,22,23');
check('every item appears exactly once across the pages',
  [1, 2, 3].flatMap((page) => pageSlice(items, page, 10)).join() === items.join());

// The case the clamping exists for: a filter cuts the list while the reader is
// on a page that no longer exists.
const shrunk = pageSlice(items.slice(0, 12), 3, 10);
check('a page past the end shows the last page, not nothing', shrunk.join() === '11,12');
check('a page before the start shows the first', pageSlice(items, 0, 10)[0] === 1);
check('an empty list slices to nothing', pageSlice([], 1, 10).length === 0);
check('a list shorter than a page is one page', pageSlice(items.slice(0, 4), 1, 10).length === 4);
check('and the same list on page 2 is still that page', pageSlice(items.slice(0, 4), 2, 10).length === 4);

console.log(`\npaging: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
