// Reading a QMP report as a table.
//
// These are money columns on a screen somebody makes decisions from, so the
// rules are pinned: a dollar column reads as dollars, a percentage as a
// percentage, an empty cell as a dash and never as a zero, and sorting a
// column of counts never reorders it as text.
//
//   npx tsx scripts/report-table-checks.ts
import {
  alignsRight,
  BLANK,
  columnKind,
  formatCell,
  isBlank,
  numericValue,
  pageBounds,
  sortRows,
} from '../src/lib/report-table';
import { parseNumber } from '../src/lib/qmp-sync';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

console.log('— what is a number and what only looks like one —');
check('a plain number', numericValue(19) === 19);
check('a numeric string', numericValue('19') === 19);
check('a currency string', numericValue('$720.00') === 720);
check('with separators', numericValue('$10,920.00') === 10920);
check('a percentage', numericValue('44.00%') === 44);
check('a negative', numericValue('-412.50') === -412.5);
check('a negative with a symbol', numericValue('-$412.50') === -412.5);
check('a symbol before the sign', numericValue('$-412.50') === -412.5);
check('parentheses as a minus', numericValue('(412.50)') === -412.5);
check('a leading decimal point', numericValue('.5') === 0.5);
check('zero', numericValue(0) === 0);

// The reason this exists rather than reusing parseNumber from lib/qmp-sync:
// that one strips whatever is not a digit, which is right when pulling a
// figure out of a known measure column and catastrophic when deciding what a
// column *is*. A tracking key would become a number, and a column of them
// would be sorted and formatted as money.
check('a tracking key is not a number', numericValue('yre648') === null);
check('though the lenient one thinks it is 648', parseNumber('yre648') === 648);
check('a lead reference is not a number', numericValue('rc7czk6xa61y') === null);
check('a date is not a number', numericValue('2026-08-12') === null);
check("QMP's widget name is not a number", numericValue('JavaScriptTransition_JSWidget') === null);
check('a state code is not a number', numericValue('NY') === null);
check('an empty string is not a number', numericValue('') === null);
check('a bare symbol is not a number', numericValue('$') === null);
check('a number with a word on it is not a number', numericValue('19 approvals') === null);

console.log('\n— what counts as empty —');
check('null is empty', isBlank(null));
check('undefined is empty', isBlank(undefined));
check('an empty string is empty', isBlank(''));
check('whitespace is empty', isBlank('   '));
check("QMP's own dash is empty", isBlank('-'));
check('"n/a" is empty', isBlank('n/a'));
check('NaN is empty', isBlank(Number.NaN));
// The one that matters most: a real zero is a measurement, not a hole. The
// screenshot has a Searches column reading 0 next to columns reading dashes,
// and collapsing the two would lose the difference between "nobody searched"
// and "this row does not have that number".
check('zero is NOT empty', !isBlank(0));
check('the string zero is NOT empty', !isBlank('0'));
check('a zero percentage is NOT empty', !isBlank('0.00%'));

console.log('\n— what kind of column it is —');
const money = ['$720.00', '$600.00', '-'];
const rates = ['100.00%', '44.00%', '-'];
const counts = [358, 75, 0, '-'];
check('a ($) column is currency', columnKind('Total Earnings($)', money) === 'currency');
check('EPC is currency', columnKind('Avg. EPC($)', money) === 'currency');
check('a (%) column is a percentage', columnKind('Click to App Rate(%)', rates) === 'percent');
check('a plain count is a number', columnKind('Impressions', counts) === 'number');
check('an unlabelled earnings column is still currency', columnKind('Earnings', money) === 'currency');
check('an unlabelled rate column is still a percentage', columnKind('Approval Rate', rates) === 'percent');
// A percentage suffix beats an earnings-sounding word, because the suffix is
// QMP's own and the word is a guess.
check('the suffix wins over the word', columnKind('Earnings Rate(%)', rates) === 'percent');

// Text columns must never be mistaken for numbers, or sorting reorders them.
check('a date column is text', columnKind('Date-Daily', ['2026-08-12', '2026-08-13']) === 'text');
check('a tracking key is text', columnKind('Var2', ['yre648', 'uxfs92']) === 'text');
check('a state is text', columnKind('State', ['NY', 'CA']) === 'text');
check('a card name is text', columnKind('Card Name', ['Chase Sapphire Preferred']) === 'text');
// One non-numeric value is enough to make the whole column text. Sorting a
// mostly-numeric column as numbers would put that value anywhere it liked.
check(
  'one stray value makes the column text',
  columnKind('Sub ID', [1, 2, 'JavaScriptTransition_JSWidget']) === 'text',
);
check('a column of nothing but blanks is text', columnKind('Approvals', ['-', '', null]) === 'text');
check('an empty column is text', columnKind('Approvals', []) === 'text');

console.log('\n— how a cell reads —');
check('money gets a dollar sign', formatCell('720', 'currency') === '$720.00');
check('and two decimal places', formatCell(600.5, 'currency') === '$600.50');
check('and thousands separators', formatCell(10920, 'currency') === '$10,920.00');
check('a value that already has one is not doubled', formatCell('$10,920.00', 'currency') === '$10,920.00');
// A clawback: the sign belongs in front of the symbol.
check('a negative is -$, not $-', formatCell(-412.5, 'currency') === '-$412.50');
check('parenthesised negatives too', formatCell('(412.50)', 'currency') === '-$412.50');
check('a percentage gets its sign', formatCell(44, 'percent') === '44.00%');
check('and two decimals', formatCell('57.58', 'percent') === '57.58%');
check('one already carrying it is not doubled', formatCell('100.00%', 'percent') === '100.00%');
check('a count keeps its separator', formatCell(2345, 'number') === '2,345');
check('a whole count gains no decimals', formatCell(19, 'number') === '19');
check('a zero shows as zero', formatCell(0, 'number') === '0');
check('a zero payout shows as $0.00', formatCell(0, 'currency') === '$0.00');
check('text passes through', formatCell('  Chase Sapphire  ', 'text') === 'Chase Sapphire');

console.log('\n— and an empty one —');
for (const kind of ['currency', 'percent', 'number', 'text'] as const) {
  check(`${kind} shows a dash`, formatCell(null, kind) === BLANK);
  check(`${kind} shows a dash for an empty string`, formatCell('', kind) === BLANK);
}
check('the dash is a plain hyphen', BLANK === '-');
// A numeric column with a word in it: show the word rather than hide it.
check('an unparseable value in a number column is shown', formatCell('pending', 'number') === 'pending');

console.log('\n— alignment —');
check('money reads down a right edge', alignsRight('currency'));
check('percentages too', alignsRight('percent'));
check('counts too', alignsRight('number'));
check('words do not', !alignsRight('text'));

console.log('\n— sorting —');
type Row = { id: string; approvals: unknown; card: unknown };
const rows: Row[] = [
  { id: 'a', approvals: 19, card: 'Chase Sapphire' },
  { id: 'b', approvals: '-', card: 'Amex Gold' },
  { id: 'c', approvals: 3, card: 'citi double cash' },
  { id: 'd', approvals: 100, card: 'Card 10' },
  { id: 'e', approvals: null, card: 'Card 2' },
];
const asc = sortRows(rows, (r) => r.approvals, 'number', 'asc');
const desc = sortRows(rows, (r) => r.approvals, 'number', 'desc');
check('ascending puts the smallest first', asc.map((r) => r.id).join('') === 'cadbe');
check('descending puts the largest first', desc.slice(0, 3).map((r) => r.id).join('') === 'dac');

// Blanks go last in BOTH directions. A report is mostly holes, and sorting by
// Approvals to find the rows that have some must not answer with a page of
// dashes.
check('ascending keeps blanks last', asc.slice(-2).every((r) => r.approvals === '-' || r.approvals === null));
check('descending keeps blanks last', desc.slice(-2).every((r) => r.approvals === '-' || r.approvals === null));
check('every row survives a sort', asc.length === rows.length && desc.length === rows.length);
check('the input is not reordered', rows[0]!.id === 'a' && rows[4]!.id === 'e');

// Numbers as numbers, not as strings: "100" must not sort before "19".
const numeric = sortRows(
  [{ v: '100' }, { v: '19' }, { v: '3' }],
  (r) => r.v,
  'number',
  'asc',
).map((r) => r.v);
check('numeric strings sort as numbers', numeric.join(',') === '3,19,100');
const asText = sortRows([{ v: '100' }, { v: '19' }, { v: '3' }], (r) => r.v, 'text', 'asc').map(
  (r) => r.v,
);
check('a text column sorts naturally too', asText.join(',') === '3,19,100');

// Money with symbols in it still sorts by value.
const byMoney = sortRows(
  [{ v: '$1,000.00' }, { v: '$99.00' }, { v: '$412.50' }],
  (r) => r.v,
  'currency',
  'desc',
).map((r) => r.v);
check('money sorts by value, not by string', byMoney.join(',') === '$1,000.00,$412.50,$99.00');

const byCard = sortRows(rows, (r) => r.card, 'text', 'asc').map((r) => r.card);
check('case does not split the order', byCard[0] === 'Amex Gold');
check('"Card 2" comes before "Card 10"', byCard.indexOf('Card 2') < byCard.indexOf('Card 10'));

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

console.log(`\nreport-table: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
