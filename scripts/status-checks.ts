/**
 * Everything about the Status column that can be checked without a Google
 * account: the header-row migration decision, the A1 target of a status write,
 * and how a hand-typed cell is read back.
 *
 *   npx tsx scripts/status-checks.ts
 */
import { SHEET_HEADERS } from '../src/lib/config';
import { planHeaderRow } from '../src/lib/store/sheets';
import { displayStatus, normalizeLeadStatus, statusLabel } from '../src/lib/status';

const SUB = SHEET_HEADERS.submissions;
/** The 13-column header every sheet written before this change has. */
const LEGACY = SUB.slice(0, -1);

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       got ${JSON.stringify(actual)}\n       want ${JSON.stringify(expected)}`}`);
}

console.log('— header migration —');
check('blank tab is stamped', planHeaderRow([], SUB).action, 'write');
check('legacy 13-column sheet gains status', planHeaderRow([...LEGACY], SUB).action, 'write');
check('already migrated: nothing to do', planHeaderRow([...SUB], SUB).action, 'ok');
check(
  'header typed by hand as "Created At" still matches',
  planHeaderRow(['id', 'Created At', ...SUB.slice(2)], SUB).action,
  'ok',
);
check(
  'user column sitting in our status slot is refused, not overwritten',
  planHeaderRow([...LEGACY, 'my notes'], SUB),
  { action: 'conflict', index: 13, found: 'my notes' },
);
check(
  'an inserted column (everything shifted) is refused',
  planHeaderRow(['id', 'owner', 'created_at', ...LEGACY.slice(2)], SUB),
  { action: 'conflict', index: 1, found: 'owner' },
);
check(
  'extra user columns to the RIGHT of ours are fine',
  planHeaderRow([...SUB, 'my notes', 'called?'], SUB).action,
  'ok',
);
check(
  'a legacy sheet with extra columns to the right still migrates',
  planHeaderRow([...LEGACY], SUB).action,
  'write',
);

console.log('\n— where the status write lands —');
function columnLetter(index: number): string {
  let out = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
const column = columnLetter(SUB.indexOf('status') + 1);
check('status is the last column', SUB[SUB.length - 1], 'status');
check('status writes to column N', column, 'N');
check('one cell only, not the row', `Submissions!${column}7:${column}7`, 'Submissions!N7:N7');

console.log('\n— reading a cell somebody typed —');
for (const [input, want] of [
  ['', 'pending'],
  [undefined, 'pending'],
  ['pending', 'pending'],
  ['registered', 'registered'],
  ['Registered', 'registered'],
  ['  REGISTERED  ', 'registered'],
  // The word on screen. Somebody typing what they read has to land in the same
  // place as somebody typing what they have always typed.
  ['approved', 'registered'],
  ['Approved', 'registered'],
  ['APPROVED', 'registered'],
  ['not approved', 'pending'],
  ['pending approval', 'pending'],
  ['yes', 'registered'],
  ['Done', 'registered'],
  ['✓', 'registered'],
  ['registration pending', 'pending'],
  ['not registered', 'pending'],
  ['no', 'pending'],
  ['maybe next week', 'pending'],
  [42, 'pending'],
] as const) {
  check(`"${String(input)}" reads as ${want}`, normalizeLeadStatus(input), want);
}

console.log('\n— what it is called on screen —');
// The stored word and the shown word part company here and nowhere else, which
// is what lets the caption change without the database or the sheet changing.
check('registered reads as Approved', statusLabel('registered'), 'Approved');
check('pending reads as Pending', statusLabel('pending'), 'Pending');

console.log('\n— an approval outranks the stored status —');
/*
 * The rule the leads list and the approvals list share. A lead sitting at
 * pending under an approval is not a decision anybody made, so the approval
 * wins; without an approval the stored status is left exactly as it is.
 */
check('an approval lifts a pending lead', displayStatus('pending', true), 'registered');
check('an approval leaves an approved lead alone', displayStatus('registered', true), 'registered');
check('no approval keeps pending pending', displayStatus('pending', false), 'pending');
check(
  'no approval keeps a hand-marked lead approved',
  displayStatus('registered', false),
  'registered',
);

console.log(failed === 0 ? '\nPASS' : `\nFAIL — ${failed} check(s)`);
process.exit(failed === 0 ? 0 : 1);
