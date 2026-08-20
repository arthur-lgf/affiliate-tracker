// Reading a CPA report export.
//
// These are the rates the team quotes from, so the rules that matter are the
// ones that would change a number without anybody noticing: a card name with a
// comma in it must not shift every column after it, "-" must not become zero,
// and the blank parent row of a tiered card must not be read as a card that
// pays nothing.
//
//   npx tsx scripts/cpa-checks.ts
import {
  parseAmount,
  parseCpaExport,
  parseDay,
  parseDelimited,
  parsePercent,
  sortRates,
  tierNumber,
} from '../src/lib/cpa';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

console.log('— cells —');
check('plain cells split', parseDelimited('a,b\nc,d')[1]!.join('|') === 'c|d');
check('quoted cells lose their quotes', parseDelimited('"a","b"')[0]!.join('|') === 'a|b');
// The one that silently corrupts a report: a comma inside a card name.
const comma = parseDelimited('"Chase","Sapphire Preferred, Visa","Tier 1","420"');
check('a comma inside a quoted cell is not a split', comma[0]!.length === 4);
check('and the cell keeps it', comma[0]![1] === 'Sapphire Preferred, Visa');
check('a doubled quote is one quote', parseDelimited('"He said ""hi"""')[0]![0] === 'He said "hi"');
check('a newline inside quotes stays inside', parseDelimited('"two\nlines",b')[0]![0] === 'two\nlines');
check('and does not start a row', parseDelimited('"two\nlines",b').length === 1);
check('a byte order mark is not part of the first cell', parseDelimited('﻿"a",b')[0]![0] === 'a');
check('blank lines are dropped', parseDelimited('a,b\n\n\nc,d').length === 2);
check('tab separated files work too', parseDelimited('a\tb\nc\td')[1]!.join('|') === 'c|d');
check('a lone quoted comma does not vote for tabs', parseDelimited('"a,b"\tc')[0]!.length === 2);

console.log('\n— values —');
check('a plain number', parseAmount('420') === 420);
check('a formatted one', parseAmount('$1,250.50') === 1250.5);
check('zero is zero', parseAmount('0') === 0);
// The distinction the whole file turns on.
check('a dash is nothing, not zero', parseAmount('-') === null);
check('and so is blank', parseAmount('') === null);
check('nonsense is nothing rather than NaN', parseAmount('n/a') === null);
check('a percentage is a fraction', parsePercent('10.00%') === 0.1);
check('a fall is negative', parsePercent('-100.00%') === -1);
check('no change is zero, not nothing', parsePercent('0.00%') === 0);
check('a dash percentage is nothing', parsePercent('-') === null);
check('an iso day passes through', parseDay('2026-07-01') === '2026-07-01');
check('an american one is turned round', parseDay('08/20/2026') === '2026-08-20');
check('a single-digit american one is padded', parseDay('7/1/2026') === '2026-07-01');
check('a dash date is empty', parseDay('-') === '');

console.log('\n— the export —');
// The real file's shape: two title lines, a header, a blank parent row for a
// tiered card, its tiers, and an untiered card that has been switched off.
const EXPORT = [
  '"Report Name","CPA Report"',
  '"Day of","08/20/2026"',
  '"Placement Name","Issuer","Card Name","Tier","Current Net CPA","Previous Net CPA","Percent Change","Date Change of Current Net CPA"',
  '"714025 - LGF","AmEx Consumer","American Express Platinum Card(R)","","","","-","-"',
  '"714025 - LGF","AmEx Consumer","American Express Platinum Card(R)","Tier 1","420","","-","2026-07-01"',
  '"714025 - LGF","AmEx Consumer","American Express Platinum Card(R)","Tier 2","540","","-","2026-07-01"',
  '"714025 - LGF","AmEx Consumer","American Express Platinum Card(R)","Tier 3","660","600","10.00%","2026-07-01"',
  '"714025 - LGF","Capital One","Capital One Spark Cash Plus","","0","270","-100.00%","2023-09-01"',
].join('\n');

const parsed = parseCpaExport(EXPORT);
check('the title lines are not rows', parsed.rows.length === 4);
check('the parent row of a tiered card is skipped', parsed.scaffold === 1);
check('and counted rather than reported as a problem', parsed.issues.length === 0);
check('the report day is read off the title lines', parsed.reportDate === '2026-08-20');
check('a tier keeps its label', parsed.rows[0]!.tier === 'Tier 1');
check('and its rate', parsed.rows[0]!.current === 420);
check('a blank previous rate stays blank', parsed.rows[0]!.previous === null);
check('a real change is a fraction', parsed.rows[2]!.change === 0.1);
// The switched-off card: no tier, and a rate of zero that must survive.
const off = parsed.rows[3]!;
check('an untiered card is kept', off.card === 'Capital One Spark Cash Plus');
check('with no tier', off.tier === '');
check('and a rate of zero, not nothing', off.current === 0);
check('its previous rate is kept', off.previous === 270);
check('and its fall', off.change === -1);
check('the issuer comes across', off.issuer === 'Capital One');
check('so does the placement', off.placement === '714025 - LGF');
check('and the date', off.changedOn === '2023-09-01');

console.log('\n— files that are not quite right —');
// Excel users move columns. Matching by name rather than position is what keeps
// that from filing dollar amounts under "issuer".
const REORDERED = [
  '"Card Name","Current Net CPA","Issuer","Tier"',
  '"Chase Sapphire","500","Chase","Tier 2"',
].join('\n');
const reordered = parseCpaExport(REORDERED);
check('columns can be in any order', reordered.rows[0]!.current === 500);
check('and the issuer is still the issuer', reordered.rows[0]!.issuer === 'Chase');
check('a missing column is simply empty', reordered.rows[0]!.placement === '');
check('title lines are optional', reordered.rows.length === 1);
check('and so the report day may be unknown', reordered.reportDate === '');

const NOT_A_REPORT = 'name,email\nMark,mark@example.test';
const wrong = parseCpaExport(NOT_A_REPORT);
check('a file that is not a rate card yields nothing', wrong.rows.length === 0);
check('and says why', wrong.issues[0]!.detail.includes('header'));

const NO_CARD = [
  '"Card Name","Current Net CPA"',
  '"","420"',
  '"Real Card","420"',
].join('\n');
const noCard = parseCpaExport(NO_CARD);
check('a row with no card name is skipped', noCard.rows.length === 1);
check('and reported with its line number', noCard.issues[0]!.line === 2);

console.log('\n— order —');
check('a tier reads as its number', tierNumber('Tier 7') === 7);
check('a card with one rate sorts first', tierNumber('') === 0);
const sorted = sortRates([
  { placement: '', issuer: 'B', card: 'Two', tier: 'Tier 10', current: 1, previous: null, change: null, changedOn: '' },
  { placement: '', issuer: 'B', card: 'Two', tier: 'Tier 9', current: 1, previous: null, change: null, changedOn: '' },
  { placement: '', issuer: 'A', card: 'One', tier: '', current: 1, previous: null, change: null, changedOn: '' },
]);
check('issuers come first', sorted[0]!.issuer === 'A');
check('and tier 10 lands after tier 9, not between 1 and 2', sorted[1]!.tier === 'Tier 9' && sorted[2]!.tier === 'Tier 10');

console.log(`\ncpa: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
