// The affiliate's half of an approval.
//
// This is somebody's pay, printed in a column with a total under it, so the two
// rules worth pinning are that a row is rounded to a real cent and that the
// total is the sum of the rows rather than a second, slightly different, sum of
// its own. They genuinely disagree: four rows of 12.35, 0.03, 99.99 and 33.33
// add up to 72.87 in halves and 72.85 halved, and only one of those is a number
// the reader can check against the column above it.
//
//   npx tsx scripts/affiliate-revenue-checks.ts
import { AFFILIATE_SHARE, affiliateRevenueOf, formatMoney } from '../src/lib/analytics';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

console.log('— the share —');
check('it is half', AFFILIATE_SHARE === 0.5);
check('a round amount halves cleanly', affiliateRevenueOf(1250) === 625);
check('and so does an odd one', affiliateRevenueOf(412.5) === 206.25);
check('nothing earned is nothing owed', affiliateRevenueOf(0) === 0);

console.log('\n— cents —');
check('an odd half-cent rounds up, not off', affiliateRevenueOf(12.35) === 6.18);
check('the smallest amount still pays something', affiliateRevenueOf(0.01) === 0.01);
check('three cents is two, not 1.5', affiliateRevenueOf(0.03) === 0.02);
check('every answer is a real number of cents', [0.01, 0.03, 12.35, 33.33, 99.99, 137.5].every((amount) => {
  const cents = affiliateRevenueOf(amount) * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-9;
}));
check('and prints as one', formatMoney(affiliateRevenueOf(12.35)) === '$6.18');

console.log('\n— the total —');
const rows = [12.35, 0.03, 99.99, 33.33];
const sumOfHalves = Math.round(rows.reduce((sum, a) => sum + affiliateRevenueOf(a), 0) * 100) / 100;
check('the column adds up to the total under it', sumOfHalves === 6.18 + 0.02 + 50 + 16.67);
check('which is not the same as halving the total', sumOfHalves !== affiliateRevenueOf(rows.reduce((s, a) => s + a, 0)));
check('and is the larger of the two here', sumOfHalves === 72.87);

console.log(`\naffiliate-revenue: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
