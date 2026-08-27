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
import {
  AFFILIATE_SHARE,
  affiliateRevenueOf,
  buildEarnings,
  describeConversions,
  formatMoney,
  revenueFrom,
} from '../src/lib/analytics';
import type { ShareRate } from '../src/lib/settings';
import type { AffiliateLink, Conversion, Visit } from '../src/lib/types';

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

console.log('\n— halving a figure that may already be halved —');
/*
 * An affiliate's rows are halved before they leave the server, so by the time a
 * table prints the share, the figure it holds may already be it. Getting this
 * backwards pays somebody a quarter, which is why it is one function and not a
 * ternary written out in four components.
 */
check('a gross figure is halved', revenueFrom(210, true) === 105);
check('a figure that is already the share is left alone', revenueFrom(105, false) === 105);
check('halving twice is what this exists to prevent', revenueFrom(revenueFrom(210, true), false) === 105);
check('zero is zero either way', revenueFrom(0, true) === 0 && revenueFrom(0, false) === 0);
check('and the cents rule still applies', revenueFrom(12.35, true) === 6.18);

console.log('\n— a rate that changed halfway through —');
/*
 * The promise this whole feature turns on, checked where it actually has to
 * hold: not on one number, but on a table that adds up. Two approvals for the
 * same person, one banked in August under a half and one in September under
 * sixty percent, land in one row. The row's gross is 400; a share of that total
 * is 200 whichever rate you pick, and the honest answer is 220, because that is
 * what the two approvals were each worth on the day each was approved.
 */
const shares: ShareRate[] = [
  { from: '', rate: 0.5 },
  { from: '2026-09-01', rate: 0.6 },
];
const link: AffiliateLink = {
  id: 'l1',
  createdAt: '2026-01-01T00:00:00.000Z',
  slug: 'best-cards',
  usr: 'arthur',
  assignee: 'Arthur Reyes',
  assigneeEmail: '',
  campaign: 'Best Cards',
  destination: 'https://example.com',
  headline: '',
  subheadline: '',
  ctaLabel: '',
  requirePhone: false,
  passUsrParam: 'usr',
  active: true,
  notes: '',
};
const paid = (approvedOn: string, amount: number): Conversion => ({
  id: 'c' + approvedOn + amount,
  createdAt: '2026-09-05T00:00:00.000Z',
  approvedOn,
  slug: 'best-cards',
  usr: 'arthur',
  amount,
  notes: '',
});
const visits: Visit[] = [];
const both = [paid('2026-08-20', 200), paid('2026-09-02', 200)];

const mixed = buildEarnings([link], visits, both, { period: 'all', shares, gross: true });
check('the row holds both approvals', mixed.rows[0]!.approved === 2);
check('and the gross is the gross', mixed.rows[0]!.earnings === 400);
check('the share is each approval at its own rate', mixed.rows[0]!.affiliate === 220);
check('which is not a share of the total', mixed.rows[0]!.affiliate !== affiliateRevenueOf(400));
check('and the total is the sum of the rows', mixed.totals.affiliate === 220);

/*
 * The same two approvals with no history at all, which is every deployment
 * before anybody opens the settings page. Nothing changes: half of everything,
 * exactly as before.
 */
const untouched = buildEarnings([link], visits, both, { period: 'all', gross: true });
check('with no rate ever set, it is still half', untouched.rows[0]!.affiliate === 200);
check('and half of the total agrees, because there is only one rate', untouched.rows[0]!.affiliate === affiliateRevenueOf(400));

/*
 * Raising the rate again, later, must not move either of them. This is the
 * check that would fail if the share were ever read as "the rate now".
 */
const raisedAgain = buildEarnings([link], visits, both, {
  period: 'all',
  shares: [...shares, { from: '2027-01-01', rate: 0.9 }],
  gross: true,
});
check('a later rise leaves both approvals where they were', raisedAgain.rows[0]!.affiliate === 220);

// The affiliate's own copy: the amounts arrive already shared, so the share
// column is the amount and halving it again would pay them a quarter.
const theirs = buildEarnings([link], visits, both.map((row) => ({ ...row, amount: row.amount / 2 })), {
  period: 'all',
  shares,
  gross: false,
});
check('an affiliate is not shared a second time', theirs.rows[0]!.affiliate === theirs.rows[0]!.earnings);

console.log('\n— one approval at a time —');
const listed = describeConversions([link], both, [], { shares, gross: true });
check('the August one paid half', listed.find((row) => row.approvedOn === '2026-08-20')!.affiliate === 100);
check('the September one paid sixty percent', listed.find((row) => row.approvedOn === '2026-09-02')!.affiliate === 120);
const listedTheirs = describeConversions([link], both.map((row) => ({ ...row, amount: 100 })), [], {
  shares,
  gross: false,
});
check('and a reader shown their own share sees it unchanged', listedTheirs.every((row) => row.affiliate === 100));

console.log(`\naffiliate-revenue: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
