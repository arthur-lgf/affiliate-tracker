// Which approved cards somebody may ask to be paid for, and when.
//
// Every card runs on its own clock: 45 days from the day it was approved, the
// same 45 for everybody whatever version of the agreement they signed. Two
// things decide whether money moves correctly, so they are pinned hardest. The
// boundary, because a card that turns requestable a day early is a payment the
// agreement does not owe, and a day late is one somebody is kept waiting for.
// And the request check, because it is the friendly answer in front of the
// database's own: a house card, somebody else's card, the same card twice or a
// card already on a request must each be refused before anything is written.
//
//   npx tsx scripts/payout-request-checks.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  daysUntilEligible,
  describeCountdown,
  describeReadyDay,
  describeSelection,
  eligibleOn,
  isEligible,
  splitByReadiness,
  validateRequestedIds,
  type Candidate,
} from '../src/lib/payout-request';
import { addDays, PAYOUT_DAYS, totalOf } from '../src/lib/payout';
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

// Every sentence this module hands to a page, gathered so the house rules
// about wording can be checked once across all of them at the end.
const said: string[] = [];
function heard<T extends string>(text: T): T {
  said.push(text);
  return text;
}

console.log('— one term for everybody —');
check('45 days', PAYOUT_DAYS === 45);
/*
 * Not a second 45 typed next to the first. The agreement says Net 45 in words
 * and this module counts in days; if the two ever disagree, somebody can ask
 * to be paid on a day their own contract does not describe.
 */
check('and it is the agreement that says so', PAYOUT_DAYS === PAYMENT_DAYS);
check('a card is requestable 45 days after approval', eligibleOn('2026-08-19') === addDays('2026-08-19', PAYOUT_DAYS));

console.log('\n— the database counts the same 45 —');
/*
 * create_payout_request re-derives eligibility itself, with a literal 45 in
 * its cutoff, because a SQL function cannot import a TypeScript constant. So
 * the two are pinned together here instead: if one is ever changed without
 * the other, the page offers cards the database refuses, or the database
 * accepts cards the page never offered.
 */
const MIGRATION = join(process.cwd(), 'supabase', 'migrations', '20260914120000_payout_requests.sql');
let migration = '';
try {
  migration = readFileSync(MIGRATION, 'utf8');
} catch {
  migration = '';
}
check('the payout requests migration is on disk', migration !== '', MIGRATION);
if (migration) {
  // Code, not commentary: a "45 days" in a comment is not what the cutoff uses.
  const code = migration
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  const literals = [
    ...code.matchAll(/::date\s*-\s*(\d+)/g),
    ...code.matchAll(/current_date\s*-\s*(\d+)/gi),
    ...code.matchAll(/interval\s*'(\d+)\s*days?'/gi),
  ].map((match) => Number(match[1]));
  check('its cutoff is a day count the check can find', literals.length > 0, literals);
  check(
    'and every one of them is PAYOUT_DAYS',
    literals.length > 0 && literals.every((days) => days === PAYOUT_DAYS),
    literals,
  );
}

console.log('\n— the boundary —');
// Approved 19 August, the oldest approval on file today. Requestable on
// 3 October and every day after, never on 2 October.
const AUG19 = '2026-08-19';
check('the ready day', eligibleOn(AUG19) === '2026-10-03', eligibleOn(AUG19));
check('day 44 is not ready', !isEligible(AUG19, addDays(AUG19, 44)));
check('with one day left', daysUntilEligible(AUG19, addDays(AUG19, 44)) === 1);
check('day 45 is ready', isEligible(AUG19, addDays(AUG19, 45)));
check('with none left', daysUntilEligible(AUG19, addDays(AUG19, 45)) === 0);
check('day 46 is still ready', isEligible(AUG19, addDays(AUG19, 46)));
check('and a day past reads as negative', daysUntilEligible(AUG19, addDays(AUG19, 46)) === -1);
check('the day it was approved is not', !isEligible(AUG19, AUG19));
check('and neither is a day before it', !isEligible(AUG19, '2026-08-01'));
check('45 days out on the day it was approved', daysUntilEligible(AUG19, AUG19) === 45);

console.log('\n— month ends and leap days —');
// Counting in days rather than months is what makes all of these come out.
check('31 Aug is ready on 15 Oct', eligibleOn('2026-08-31') === '2026-10-15');
check('31 Jan 2026 is ready on 17 Mar', eligibleOn('2026-01-31') === '2026-03-17');
check('31 Jan 2028 is ready on 16 Mar, a day earlier in the leap year', eligibleOn('2028-01-31') === '2028-03-16');
check('29 Feb is a real approval day', eligibleOn('2028-02-29') === '2028-04-14');
check('a December approval crosses the year', eligibleOn('2026-12-01') === '2027-01-15');
// 15 Jan 2028 lands exactly on the leap day.
check('an approval can turn ready on 29 Feb', eligibleOn('2028-01-15') === '2028-02-29');
check('and is not ready on the 28th', !isEligible('2028-01-15', '2028-02-28'));
check('but is on the 29th', isEligible('2028-01-15', '2028-02-29'));
check('and on 1 Mar', isEligible('2028-01-15', '2028-03-01'));
check('day 44 across a month end', !isEligible('2026-08-31', '2026-10-14'));
check('day 45 across a month end', isEligible('2026-08-31', '2026-10-15'));

console.log('\n— timestamps and nonsense —');
// An approval day read back as a timestamp still counts from its own day.
check('a timestamp counts from its day', eligibleOn('2026-08-19T23:59:00Z') === '2026-10-03');
check('and turns ready on the same day', isEligible('2026-08-19T23:59:00Z', '2026-10-03'));
check('a Postgres stamp too', isEligible('2026-08-19 10:00:00+00', '2026-10-03'));
/*
 * A day nobody can read must never be ready. Arithmetic on it would come out as
 * zero days left, which is the one answer that lets money move, so it fails
 * closed instead.
 */
check('an unreadable approval has no ready day', eligibleOn('soon') === '' && eligibleOn('') === '');
check('and is never ready', !isEligible('soon', '2030-01-01') && !isEligible('', '2030-01-01'));
check('an impossible day is not a day', !isEligible('2026-02-30', '2030-01-01'));
check('nor is an unreadable today', !isEligible(AUG19, 'later'));
check('and its count is not a number', Number.isNaN(daysUntilEligible('soon', '2026-10-03')));

console.log('\n— the countdown in words —');
check('ready at the boundary', heard(describeCountdown(AUG19, '2026-10-03')) === 'Ready to request');
check('and past it', heard(describeCountdown(AUG19, '2026-12-25')) === 'Ready to request');
check('one day reads singular', heard(describeCountdown(AUG19, '2026-10-02')) === '1 day left');
check('twelve reads plural', heard(describeCountdown(AUG19, '2026-09-21')) === '12 days left');
check('forty-five on the day it was approved', heard(describeCountdown(AUG19, AUG19)) === '45 days left');
check('nothing to say about an unreadable day', describeCountdown('soon', '2026-10-03') === '');

console.log('\n— the day it turns ready —');
// Shown beside the count, so "12 days left" also says which day that is.
check('the ready day as people read it', heard(describeReadyDay(AUG19)) === 'Ready 3 Oct 2026');
check('across a year end', heard(describeReadyDay('2026-12-01')) === 'Ready 15 Jan 2027');
check('on a leap day', heard(describeReadyDay('2028-01-15')) === 'Ready 29 Feb 2028');
check('from a timestamp', describeReadyDay('2026-08-19T08:00:00Z') === 'Ready 3 Oct 2026');
check('and nothing for an unreadable day', describeReadyDay('soon') === '' && describeReadyDay('') === '');

console.log('\n— the running total —');
check('nothing chosen', heard(describeSelection([])) === 'No cards selected');
check('one card', heard(describeSelection([{ amount: 70 }])) === '1 card selected, $70');
check('two cards', heard(describeSelection([{ amount: 70 }, { amount: 70 }])) === '2 cards selected, $140');
check('with cents', heard(describeSelection([{ amount: 70.25 }, { amount: 70.25 }])) === '2 cards selected, $140.50');
check('thousands are grouped', heard(describeSelection([{ amount: 1200 }, { amount: 34.5 }])) === '2 cards selected, $1,234.50');
// Rounded once at the end, the same way a payslip total is.
check('rounded once, not per card', describeSelection([{ amount: 0.005 }, { amount: 0.005 }]) === '2 cards selected, $0.01');
check('a comma between the count and the money', describeSelection([{ amount: 5 }]).includes('selected, $'));

console.log('\n— splitting what can be asked for now —');
const TODAY = '2026-10-10';
const rows: (Candidate & { card: string })[] = [
  { id: '1', usr: 'ana', approvedOn: '2026-08-26', amount: 50, card: 'day 45 today' },
  { id: '2', usr: 'ana', approvedOn: '2026-08-27', amount: 40, card: 'day 44 today' },
  { id: '3', usr: 'ana', approvedOn: '2026-08-01', amount: 30, card: 'long ready' },
  { id: '4', usr: 'ana', approvedOn: '2026-09-29', amount: 20, card: 'counting down' },
  { id: '5', usr: 'ana', approvedOn: '2026-08-02', amount: 10, card: 'ready but committed' },
  { id: '6', usr: 'ana', approvedOn: '2026-10-01', amount: 15, card: 'committed and counting' },
  { id: '7', usr: '', approvedOn: '2026-07-01', amount: 99, card: 'house' },
  { id: '8', usr: 'ana', approvedOn: 'soon', amount: 5, card: 'unreadable' },
];
const committed = new Set(['5', '6']);
const split = splitByReadiness(rows, TODAY, committed);
const readyIds = split.ready.map((row) => row.id);
const countingIds = split.countingDown.map((row) => row.id);
check('day 45 is ready', readyIds.includes('1'), readyIds);
check('a long-ready card is ready', readyIds.includes('3'), readyIds);
check('day 44 is counting down', countingIds.includes('2'), countingIds);
check('a recent card is counting down', countingIds.includes('4'), countingIds);
// A card already on a live request is spoken for, however old it is.
check('a committed ready card is in neither list', !readyIds.includes('5') && !countingIds.includes('5'));
check('nor is a committed card still counting', !readyIds.includes('6') && !countingIds.includes('6'));
// A house card belongs to no account, so nobody can ever ask for it.
check('a house card is in neither list', !readyIds.includes('7') && !countingIds.includes('7'));
check('nor is a card with no readable day', !readyIds.includes('8') && !countingIds.includes('8'));
check('oldest approval first when ready', readyIds.join() === '3,1', readyIds);
check('soonest first while counting down', countingIds.join() === '2,4', countingIds);
check(
  'each countdown says how many days are left',
  split.countingDown.map((row) => row.daysLeft).join() === '1,34',
  split.countingDown.map((row) => row.daysLeft),
);
check('the rest of the row comes along untouched', split.ready[0]?.card === 'long ready' && split.ready[0]?.amount === 30);
check('and the input is not reordered', rows.map((row) => row.id).join() === '1,2,3,4,5,6,7,8');
check('nothing to split is nothing', splitByReadiness([], TODAY, new Set()).ready.length === 0);

console.log('\n— checking a request before it is written —');
const candidates: Candidate[] = [
  { id: '10', usr: 'ana', approvedOn: '2026-08-01', amount: 70 },
  { id: '11', usr: 'ana', approvedOn: '2026-08-20', amount: 70.35 },
  { id: '12', usr: 'ana', approvedOn: '2026-09-30', amount: 25 },
  { id: '13', usr: 'ben', approvedOn: '2026-08-01', amount: 80 },
  { id: '14', usr: '', approvedOn: '2026-08-01', amount: 90 },
  { id: '15', usr: 'ana', approvedOn: '2026-08-02', amount: 60 },
  { id: '16', usr: 'ana', approvedOn: '2026-08-03', amount: 12.345 },
  { id: '17', usr: 'ana', approvedOn: '2026-08-03', amount: Number.NaN },
];
const spoken = new Set(['15']);
function refusal(ids: string[], usr = 'ana', today = TODAY, taken: ReadonlySet<string> = spoken): string {
  const result = validateRequestedIds(ids, candidates, usr, today, taken);
  return result.ok ? '' : heard(result.reason);
}

check('nothing chosen is refused', refusal([]) === 'Choose at least one approved card.');
check('the same card twice is refused', refusal(['10', '10']) === 'The same card was selected twice.');
check('even among others', refusal(['10', '11', '10']) === 'The same card was selected twice.');
check("somebody else's card is refused", refusal(['13']) === 'One of those approvals is not yours.');
check('even beside your own', refusal(['10', '13']) === 'One of those approvals is not yours.');
check('a card that does not exist is refused', refusal(['999']) === 'One of those approvals is not yours.');
/*
 * The house card, twice over. Once as an affiliate asking for it, and once as
 * an account with no tracking key at all, whose empty usr would otherwise
 * match the house card's empty usr and hand them the business's own money.
 */
check('a house card is refused', refusal(['14']) === 'One of those approvals is not yours.');
check('even to an account with no tracking key', refusal(['14'], '') === 'One of those approvals is not yours.');
check('and no card at all is theirs', !validateRequestedIds(['10'], candidates, '', TODAY, spoken).ok);
check('a card still counting down is refused', refusal(['12']) === 'One of those approvals is not 45 days old yet.');
check('on day 44', refusal(['11'], 'ana', '2026-10-03') === 'One of those approvals is not 45 days old yet.');
check('but not on day 45', refusal(['11'], 'ana', '2026-10-04') === '');
check('a card already on a request is refused', refusal(['15']) === 'One of those approvals is already on a request.');
check('and is fine once that request lets it go', refusal(['15'], 'ana', TODAY, new Set()) === '');
check('a card with no amount to pay is refused', refusal(['17']) === 'One of those approvals has no amount that can be paid.');

const good = validateRequestedIds(['16', '10', '11'], candidates, 'ana', TODAY, spoken);
check('a good selection passes', good.ok, good);
if (good.ok) {
  check('every card chosen is on it', good.items.length === 3, good.items);
  check('in the order they were chosen', good.items.map((item) => item.conversionId).join() === '16,10,11');
  // Carried through, not recomputed: the amount recorded is exactly the one
  // the page showed, unrounded, so the snapshot matches what was chosen.
  check(
    'each amount exactly as given',
    good.items.map((item) => item.amount).join() === '12.345,70,70.35',
    good.items,
  );
  check('and nothing but the id and the amount', good.items.every((item) => Object.keys(item).sort().join() === 'amount,conversionId'));
}

console.log('\n— totals —');
// Relaxed to anything with an amount, since an approval day is no longer
// needed to sum a request. Still rounded once at the end.
check('a total of plain amounts', totalOf([{ amount: 20 }, { amount: 30 }]) === 50);
check('rounded once', totalOf([{ amount: 0.005 }, { amount: 0.005 }]) === 0.01);
check('a broken amount does not poison the sum', totalOf([{ amount: Number.NaN }, { amount: 5 }]) === 5);

console.log('\n— the wording rules —');
check('there was something to read', said.length > 20, said.length);
// Re-punctuated, never a dash or a middle dot standing in for a comma.
check('no dash or middle dot anywhere', said.every((text) => !/[–—·]/.test(text)), said);
// These sentences reach affiliates, who are never shown how their money was cut.
check(
  'and nothing about how the money is split',
  said.every((text) => !/%|share|commission|gross|split/i.test(text)),
  said,
);

console.log(`\npayout-request: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
