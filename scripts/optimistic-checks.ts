// Keeping an optimistic value honest.
//
// Showing the new value straight away is the easy half and needs no test. This
// is the other half: putting the opinion down when the server catches up, and
// ignoring a reply that has been overtaken. Both failures are silent — no
// error, no crash, just one browser quietly showing the wrong word — which is
// exactly the kind that survives being clicked through by hand.
//
//   npx tsx scripts/optimistic-checks.ts

import { dropSettled, isCurrent, takeTicket } from '../src/lib/optimistic';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

type Row = { id: string; status: string };
const statusOf = (row: Row) => row.status;

console.log('\n— putting the opinion down —');
{
  const rows: Row[] = [
    { id: 'a', status: 'pending' },
    { id: 'b', status: 'pending' },
  ];

  check('an empty map comes back as itself', (() => {
    const empty = {};
    return dropSettled(empty, rows, statusOf) === empty;
  })());

  // The server still disagrees, so the override is still doing a job.
  const inFlight = { a: 'registered' };
  check('an override the server has not caught up with is kept', dropSettled(inFlight, rows, statusOf) === inFlight);

  /*
   * The one that matters. The refresh has landed and the row now says what this
   * browser wanted, so the browser must stop having an opinion — otherwise the
   * next change from anybody else is painted over.
   */
  const agreed: Row[] = [
    { id: 'a', status: 'registered' },
    { id: 'b', status: 'pending' },
  ];
  check('an override the server agrees with is dropped', Object.keys(dropSettled(inFlight, agreed, statusOf)).length === 0);

  const two = { a: 'registered', b: 'registered' };
  const half = dropSettled(two, agreed, statusOf);
  check('one settling does not drop the other', Object.keys(half).join() === 'b');
  check('and the one still in flight keeps its value', half.b === 'registered');

  /*
   * Somebody else changed it back. The row disagrees with the override again,
   * so the override stays and this browser keeps showing its own click until
   * its own request settles it. Dropping here would flip the pill under the
   * user mid-request.
   */
  const contradicted: Row[] = [{ id: 'a', status: 'pending' }];
  check('a row that disagrees keeps the override', dropSettled({ a: 'registered' }, contradicted, statusOf).a === 'registered');

  /*
   * Filtering the table to "Registered" removes every pending row from the
   * list. An override whose row is not on screen has not been settled by
   * anything, and forgetting it would make the pill flip back on a filter
   * change rather than on an answer.
   */
  check('an override for a row that is not listed is kept', dropSettled({ zz: 'registered' }, rows, statusOf).zz === 'registered');

  // Same object back when there is nothing to do, so setState can bail out and
  // not re-render. This is why the caller can put it straight in an effect.
  const stable = { a: 'registered' };
  check('unchanged means the same reference', dropSettled(stable, rows, statusOf) === stable);
  check('changed means a new one', dropSettled(stable, agreed, statusOf) !== stable);
  check('and the original is not mutated', stable.a === 'registered');
}

console.log('\n— replies that have been overtaken —');
{
  const tickets: Record<string, number> = {};

  const first = takeTicket(tickets, 'a');
  check('the first click takes ticket 1', first === 1);
  check('and is current while it is the only one', isCurrent(tickets, 'a', first));

  const second = takeTicket(tickets, 'a');
  check('a second click takes the next', second === 2);
  /*
   * The race this exists for: click, click again, and the first reply arrives
   * last. Acting on it would roll the pill back to a value the user has already
   * changed their mind about, or raise an error about a request nobody is
   * waiting on.
   */
  check('the overtaken reply is no longer current', !isCurrent(tickets, 'a', first));
  check('the newest one is', isCurrent(tickets, 'a', second));

  // Rows are independent: a slow reply for one lead must not silence another.
  const other = takeTicket(tickets, 'b');
  check('each row counts on its own', other === 1);
  check('and the other row is unaffected', isCurrent(tickets, 'a', second));
  check('a ticket from one row does not answer for another', !isCurrent(tickets, 'b', second));
  check('an unknown row has no current ticket', !isCurrent(tickets, 'zz', 1));
}

console.log(`\noptimistic: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
