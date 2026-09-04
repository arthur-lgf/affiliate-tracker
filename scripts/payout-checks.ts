// The payout schedule: when each person is paid, and which approvals go on it.
//
// Two things here decide whether somebody is paid the right amount on the right
// day, so they are what is pinned hardest. The window is half open, [from, to),
// which is the only shape where an approval cannot land in two payslips or in
// none. And the clock is anchored per person, so the arithmetic has to survive
// month ends, leap days, and a payday that is also the next cycle's first day.
//
//   npx tsx scripts/payout-checks.ts
import {
  addDays,
  anchorFor,
  anchorLabel,
  bandOf,
  BAND_ORDER,
  BANDS,
  coversDay,
  daysBetween,
  daysUntil,
  dayOf,
  describeDue,
  hasAnchor,
  isDay,
  isOverdue,
  linesIn,
  NO_ANCHOR,
  PAYOUT_DAYS,
  periodAt,
  periodByIndex,
  periodLabel,
  periodsThrough,
  progressOf,
  settlesUp,
  shortDay,
  statusOf,
  totalOf,
} from '../src/lib/payout';
import { PAYMENT_DAYS } from '../src/lib/agreement';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name, extra === undefined ? '' : extra);
  }
}

console.log('— the cycle is the payment term —');
check('45 days', PAYOUT_DAYS === 45);
/*
 * Not a second 45 typed next to the first. The agreement says Net 45 in words
 * and the schedule counts in days; if those two ever disagree, somebody is paid
 * on a date their own contract does not describe.
 */
check('and it is the agreement that says so', PAYOUT_DAYS === PAYMENT_DAYS);

console.log('\n— the worked example —');
// Signed 15 August, paid 29 September. The span the schedule was asked for.
const AUG15 = '2026-08-15';
const first = periodByIndex(AUG15, 1);
check('the first cycle opens on the day they signed', first.from === AUG15, first);
check('and closes 45 days later, on 29 September', first.to === '2026-09-29', first);
check('which is how it reads', periodLabel(first) === '15 Aug to 29 Sep 2026', periodLabel(first));
check('45 days apart', daysBetween(first.from, first.to) === 45);

const second = periodByIndex(AUG15, 2);
check('the next one starts on payday', second.from === first.to, second);
check('and runs to 13 November', second.to === '2026-11-13', second);
check('cycles do not overlap', !coversDay(first, second.from));
check('and leave no gap', coversDay(first, addDays(second.from, -1)));

console.log('\n— which cycle a day belongs to —');
check('the day they signed is in the first', periodAt(AUG15, AUG15)?.index === 1);
check('the last day before payday is too', periodAt(AUG15, '2026-09-28')?.index === 1);
// The boundary, and the reason the window is half open: payday belongs to the
// cycle it opens, not the one it closes.
check('payday itself belongs to the second', periodAt(AUG15, '2026-09-29')?.index === 2);
check('a day inside the second is in the second', periodAt(AUG15, '2026-10-10')?.index === 2);
check('and a day before the clock started belongs to nothing', periodAt(AUG15, '2026-08-14') === null);
check('an unreadable day belongs to nothing', periodAt(AUG15, 'soon') === null);
check('and so does an unreadable anchor', periodAt('', '2026-08-15') === null);

console.log('\n— month ends and leap days —');
// 31 January plus 45 days lands in March, a day earlier in a leap year.
// Counting in days rather than months is what makes both come out.
check('31 Jan 2026 pays on 17 Mar', periodByIndex('2026-01-31', 1).to === '2026-03-17');
check('31 Jan 2028 pays on 16 Mar, the leap year', periodByIndex('2028-01-31', 1).to === '2028-03-16');
check('29 Feb is a legal anchor', periodByIndex('2028-02-29', 1).to === '2028-04-14');
check('a December cycle crosses the year', periodByIndex('2026-12-01', 1).to === '2027-01-15');
check(
  'and says both years when it does',
  periodLabel(periodByIndex('2026-12-01', 1)) === '1 Dec 2026 to 15 Jan 2027',
);

console.log('\n— where the clock starts —');
const SIGNED = '2026-08-15T09:30:00.000Z';
check('a signature dates the schedule', anchorFor({ agreementSignedAt: SIGNED }).day === AUG15);
check('and says so', anchorFor({ agreementSignedAt: SIGNED }).source === 'agreement');
/*
 * Waived through, so there is no signature to date anything from. The day the
 * account was opened is the day the arrangement began.
 */
const waived = anchorFor({
  bypassedAt: '2026-08-24 20:17:20.785+00',
  createdAt: '2026-08-20T10:00:00Z',
});
check('a waived account counts from the day it joined', waived.day === '2026-08-20', waived);
check('and says so', waived.source === 'joined');
check(
  'a signature wins even after a waiver',
  anchorFor({
    agreementSignedAt: SIGNED,
    bypassedAt: '2026-08-24 20:17:20.785+00',
    createdAt: '2026-08-01',
  }).day === AUG15,
);
check(
  'a waiver with no opening date falls back to the waiver itself',
  anchorFor({ bypassedAt: '2026-08-24 20:17:20.785+00' }).day === '2026-08-24',
);
// Neither signed nor waived: no clock is running, and saying so is better than
// inventing a payday from the day the account happened to be created.
const nothing = anchorFor({ createdAt: '2026-08-01T00:00:00Z' });
check('an account that has done neither has no schedule', nothing.source === 'none', nothing);
check('and no day', nothing.day === '');
check('which is what the empty anchor is', NO_ANCHOR.source === 'none' && !hasAnchor(NO_ANCHOR));
check('a real one is not empty', hasAnchor(anchorFor({ agreementSignedAt: SIGNED })));
check(
  'the label names what it counted from',
  anchorLabel('agreement') === 'Signed' && anchorLabel('joined') === 'Joined',
);

console.log('\n— reading a Postgres timestamp —');
// One of these comes back as an ISO string and the other as Postgres writes it.
check('an ISO stamp', dayOf('2026-08-15T09:30:00.000Z') === AUG15);
check('a Postgres stamp with microseconds and a bare offset', dayOf('2026-08-15 09:30:00.308994+00') === AUG15);
check('a bare date column', dayOf('2026-08-15') === AUG15);
check('nothing at all', dayOf(null) === '' && dayOf('') === '' && dayOf('later') === '');
// A day key is taken as it stands rather than parsed and re-printed, so a
// payday cannot move with the server's timezone.
check('a day key is never re-timezoned', dayOf('2026-01-01') === '2026-01-01');
check('a day is a day', isDay('2026-08-15') && !isDay('2026-8-15') && !isDay('2026-02-30'));

console.log('\n— how it stands today —');
const TODAY_INSIDE = '2026-09-01';
const TODAY_PAYDAY = '2026-09-29';
const TODAY_LATE = '2026-10-05';
const PAID_AT = '2026-09-29T10:00:00Z';
check('still running', statusOf(first, TODAY_INSIDE, null) === 'open');
check('closed and unpaid', statusOf(first, TODAY_PAYDAY, null) === 'due');
check('closed a while ago and still unpaid', statusOf(first, TODAY_LATE, null) === 'due');
check('paid is paid whatever the date', statusOf(first, TODAY_INSIDE, PAID_AT) === 'paid');
check('overdue is a date, not a state', isOverdue(first, TODAY_LATE, null));
check('and payday itself is not late yet', !isOverdue(first, TODAY_PAYDAY, null));
check('nor is a paid one', !isOverdue(first, TODAY_LATE, PAID_AT));

console.log('\n— the countdown —');
check('days left', daysUntil(first, TODAY_INSIDE) === 28);
check('none left', daysUntil(first, TODAY_PAYDAY) === 0);
check('past it', daysUntil(first, TODAY_LATE) === -6);
check('in words', describeDue(first, TODAY_INSIDE, null) === 'Due in 28 days');
check('today', describeDue(first, TODAY_PAYDAY, null) === 'Due today');
check('tomorrow', describeDue(first, '2026-09-28', null) === 'Due tomorrow');
check('one day late reads singular', describeDue(first, '2026-09-30', null) === '1 day late');
check('and six days late plural', describeDue(first, TODAY_LATE, null) === '6 days late');
check('a paid one says when', describeDue(first, TODAY_LATE, PAID_AT) === 'Paid 29 Sep 2026');

console.log('\n— how far through —');
check('nothing on the opening day', progressOf(first, first.from) === 0);
check('a day before it is still nothing', progressOf(first, '2026-08-01') === 0);
check('a third of the way', Math.abs(progressOf(first, addDays(first.from, 15)) - 1 / 3) < 1e-9);
check('full at payday', progressOf(first, first.to) === 1);
check('and never over', progressOf(first, '2027-01-01') === 1);

console.log('\n— the bands on the admin page —');
check('paid comes out paid', bandOf(first, TODAY_LATE, PAID_AT) === 'paid');
check('past payday is overdue', bandOf(first, TODAY_LATE, null) === 'overdue');
check('payday itself is due today', bandOf(first, TODAY_PAYDAY, null) === 'due');
check('the last week is soon', bandOf(first, '2026-09-25', null) === 'soon');
check('a week out to the day is still soon', bandOf(first, '2026-09-22', null) === 'soon');
check('and eight days out is later', bandOf(first, '2026-09-21', null) === 'later');
check('every band has a section', BANDS.length === BAND_ORDER.length);
check('in the order the page draws them', BANDS.map((band) => band.key).join() === BAND_ORDER.join());
check('most urgent first', BAND_ORDER[0] === 'overdue' && BAND_ORDER[BAND_ORDER.length - 1] === 'paid');
check('and each says what it means', BANDS.every((band) => band.label !== '' && band.blurb !== ''));

console.log('\n— the list somebody reads —');
const list = periodsThrough(AUG15, '2026-11-20');
check('three cycles have started by 20 November', list.length === 3, list.map((row) => row.index));
check('newest first', list[0]!.index === 3 && list[2]!.index === 1);
check('and the newest is the one running', coversDay(list[0]!, '2026-11-20'));
check('a day before the clock started lists nothing', periodsThrough(AUG15, '2026-08-01').length === 0);
check('the day they signed lists one', periodsThrough(AUG15, AUG15).length === 1);
// An account three years old has two dozen of these and nobody scrolls to the
// bottom, so the list is capped rather than unbounded.
check('a long history is capped', periodsThrough('2020-01-01', '2026-09-04').length === 24);
check('and the cap keeps the newest', periodsThrough('2020-01-01', '2026-09-04')[0]!.to > '2026-09-04');
check('a smaller cap is honoured', periodsThrough(AUG15, '2026-11-20', 2).length === 2);

console.log('\n— which approvals go on a payslip —');
const rows = [
  { approvedOn: '2026-08-14', amount: 10 }, // the day before the clock started
  { approvedOn: '2026-08-15', amount: 20 }, // the opening day, counted
  { approvedOn: '2026-09-28', amount: 30 }, // the last day, counted
  { approvedOn: '2026-09-29', amount: 40 }, // payday, the next cycle's
  { approvedOn: '2026-10-01', amount: 50 },
];
const mine = linesIn(first, rows);
check('the opening day counts', mine.some((row) => row.amount === 20));
check('the last day counts', mine.some((row) => row.amount === 30));
check('the day before does not', !mine.some((row) => row.amount === 10));
check('and payday belongs to the next one', !mine.some((row) => row.amount === 40));
check('two lines in the first cycle', mine.length === 2, mine);
check('and the rest fall into the second', linesIn(second, rows).length === 2);
/*
 * Nothing may be lost between cycles. Every approval on or after the anchor has
 * to appear on exactly one payslip, or somebody is short and nobody can see why.
 */
const after = rows.filter((row) => row.approvedOn >= AUG15);
const spread = [1, 2, 3].flatMap((index) => linesIn(periodByIndex(AUG15, index), rows));
check('every approval lands on exactly one payslip', spread.length === after.length, spread);
check('and none is counted twice', new Set(spread.map((row) => row.amount)).size === spread.length);
check(
  'a timestamp on an approval still buckets',
  linesIn(first, [{ approvedOn: '2026-08-20T00:00:00Z', amount: 1 }]).length === 1,
);

console.log('\n— what it comes to —');
check('a total', totalOf(mine) === 50);
check('nothing is nothing', totalOf([]) === 0);
// Rounded once at the end. Half a cent rounded per row is a total that does not
// match the sum of the lines somebody is reading.
check('rounded once', totalOf([{ approvedOn: 'x', amount: 0.005 }, { approvedOn: 'x', amount: 0.005 }]) === 0.01);
check(
  'a broken amount does not poison the sum',
  totalOf([{ approvedOn: 'x', amount: Number.NaN }, { approvedOn: 'x', amount: 5 }]) === 5,
);

console.log('\n— what was paid against what it comes to —');
check('nothing recorded, nothing to reconcile', settlesUp(284.22, null));
check('the same figure settles', settlesUp(284.22, 284.22));
check('a cent apart does not', !settlesUp(284.22, 284.21));
// An approval entered late lands in a cycle already paid. The page has to say
// so rather than quietly showing the newer number as though it had been sent.
check('a late approval shows up as a difference', !settlesUp(320, 284.22));
check('and floating point noise does not', settlesUp(0.1 + 0.2, 0.3));

console.log('\n— dates as people read them —');
check('a day', shortDay('2026-08-15') === '15 Aug 2026');
check('the first of a month', shortDay('2026-01-01') === '1 Jan 2026');
check('a timestamp reads as its day', shortDay('2026-08-15T22:00:00Z') === '15 Aug 2026');
check('and nonsense is handed back unchanged', shortDay('someday') === 'someday');
// No dashes in a range: it is how the span was asked for, and a dash in a row
// of figures is one more thing to read as a minus.
check('a range is written with "to"', periodLabel(first).includes(' to ') && !/[–—-]/.test(periodLabel(first)));

console.log(`\npayout: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
