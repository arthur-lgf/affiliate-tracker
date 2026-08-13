// Row addressing for the Conversions tab, which has no id column.
//
// A row is found by position + a fingerprint of its content. Getting this wrong
// deletes the wrong money record, so the rules are pinned here.
//
//   npx tsx scripts/conversion-row-checks.ts
import { SHEET_HEADERS } from '../src/lib/config';
import { conversionFromCells, conversionToCells } from '../src/lib/store/conversion-row';
import { planHeaderRow } from '../src/lib/store/sheets';
import { makeRowId, parseRowId, rowFingerprint } from '../src/lib/store/row-id';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

const row = {
  createdAt: '2026-08-13T10:00:00.000Z',
  approvedOn: '2026-08-13',
  slug: 'cashback',
  usr: 'arthur',
  amount: 125.5,
  notes: 'ref 8841',
};

console.log('— sheet columns —');
check('six columns', SHEET_HEADERS.conversions.length === 6);
check(
  'exact column order',
  SHEET_HEADERS.conversions.join(',') === 'created_at,approved_on,slug,usr,amount,notes',
);
check('no id column', !SHEET_HEADERS.conversions.includes('id' as never));
check('no assignee column', !SHEET_HEADERS.conversions.includes('assignee' as never));
check('no card column', !SHEET_HEADERS.conversions.includes('card' as never));
check('cells match the header width', conversionToCells(row).length === 6);

console.log('\n— round trip —');
const back = conversionFromCells(conversionToCells(row), 'x');
check('slug survives', back.slug === row.slug);
check('usr survives', back.usr === row.usr);
check('amount survives', back.amount === 125.5);
check('notes survive', back.notes === row.notes);
check('approvedOn survives', back.approvedOn === row.approvedOn);

console.log('\n— hand-typed cells —');
check('$1,250.00 parses', conversionFromCells(['', '2026-08-01', 's', 'u', '$1,250.00', ''], 'x').amount === 1250);
check('blank amount is 0', conversionFromCells(['', '2026-08-01', 's', 'u', '', ''], 'x').amount === 0);
check('garbage amount is 0, not NaN', conversionFromCells(['', '2026-08-01', 's', 'u', 'tbc', ''], 'x').amount === 0);
check(
  'slug typed as " CashBack " normalises',
  conversionFromCells(['', '2026-08-01', ' CashBack ', 'u', '1', ''], 'x').slug === 'cashback',
);
check(
  'blank approval date falls back to created_at',
  conversionFromCells(['2026-07-04T09:00:00.000Z', '', 's', 'u', '1', ''], 'x').approvedOn ===
    '2026-07-04',
);

console.log('\n— fingerprints —');
const cells = conversionToCells(row);
check('stable across calls', rowFingerprint(cells) === rowFingerprint(cells));
check(
  'a changed amount changes the fingerprint',
  rowFingerprint(cells) !== rowFingerprint(conversionToCells({ ...row, amount: 126 })),
);
check(
  'a changed note changes the fingerprint',
  rowFingerprint(cells) !== rowFingerprint(conversionToCells({ ...row, notes: 'other' })),
);
check(
  'field boundaries cannot be smeared together',
  rowFingerprint(['ab', '']) !== rowFingerprint(['a', 'b']),
);

console.log('\n— ids —');
const id = makeRowId(7, cells);
check('parses back', parseRowId(id)?.position === 7);
check('carries the fingerprint', parseRowId(id)?.fingerprint === rowFingerprint(cells));
check('rejects a bare number', parseRowId('7') === null);
check('rejects a uuid (the old scheme)', parseRowId('9cb218d3-9c5b-4405-a1ce-8c0fba3ed2f0') === null);
check('rejects a truncated hash', parseRowId('7:abc') === null);

console.log('\n— the scenario this exists for —');
// Someone inserts a row in the sheet, so a different record now sits at row 7.
const other = conversionToCells({ ...row, slug: 'travel', amount: 5000 });
const stale = parseRowId(id)!;
check(
  'a shifted row does NOT match the stale id',
  rowFingerprint(other) !== stale.fingerprint,
);
check(
  'the same row still matches after an unrelated edit elsewhere',
  rowFingerprint(conversionToCells(row)) === stale.fingerprint,
);

console.log('\n— an existing tab from the older 9-column layout —');
// id/assignee/card were dropped. Writing 6-column rows into that layout would
// file created_at under "id" and so on, so it must be refused, not migrated.
const OLD_LAYOUT = [
  'id',
  'created_at',
  'approved_on',
  'slug',
  'usr',
  'assignee',
  'card',
  'amount',
  'notes',
];
const oldPlan = planHeaderRow(OLD_LAYOUT, SHEET_HEADERS.conversions);
check('the old layout is refused', oldPlan.action === 'conflict');
check(
  'it names the first column that disagrees',
  oldPlan.action === 'conflict' && oldPlan.index === 0 && oldPlan.found === 'id',
);
check('a brand new tab is stamped', planHeaderRow([], SHEET_HEADERS.conversions).action === 'write');
check(
  'an already-current tab is left alone',
  planHeaderRow([...SHEET_HEADERS.conversions], SHEET_HEADERS.conversions).action === 'ok',
);

console.log(`\nconversion-row: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
