// The workbook writer, taken apart again.
//
// lib/xlsx.ts writes an .xlsx by hand, and the failure mode of hand-written
// OOXML is not a crash: it is Excel saying "we found a problem with some
// content" and offering to repair the file, with no clue which part was wrong.
// So these checks are mostly about the things Excel is silently strict about —
// the order of elements inside the worksheet, the two fills it assumes exist,
// and a checksum that has to match the bytes it labels.
//
//   npx tsx scripts/xlsx-checks.ts
import { buildWorkbook, columnName, excelDay, type XlsxSheet } from '../src/lib/xlsx';
import { readZip } from './read-zip';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name, extra ? `:: ${extra}` : '');
  }
}

console.log('— naming a column —');
check('the first column is A', columnName(0) === 'A');
check('the twenty-sixth is Z', columnName(25) === 'Z');
check('and the next one is AA, not BA', columnName(26) === 'AA');
check('AZ comes before BA', columnName(51) === 'AZ' && columnName(52) === 'BA');
check('the alphabet rolls over twice', columnName(701) === 'ZZ' && columnName(702) === 'AAA');

console.log('\n— dates —');
// A date Excel and everybody else agree on: 1 January 2021 is day 44,197.
check('a modern day matches what Excel calls it', excelDay('2021-01-01') === 44197);
check('a timestamp is read as its day', excelDay('2021-01-01T18:30:00Z') === 44197);
check('a day later is a day later', excelDay('2021-01-02')! - excelDay('2021-01-01')! === 1);
check('nothing unparseable comes back as a number', excelDay('') === null && excelDay('-') === null);

console.log('\n— the archive —');
const sheet: XlsxSheet = {
  name: 'Rate card',
  columns: [20, 30, 10],
  rows: [
    [{ value: 'Fish & Chips <plc>', style: 'title' }],
    [{ value: 'a note', style: 'note' }],
    [{ value: 'filtered', style: 'note' }],
    [
      { value: 'Issuer', style: 'headText' },
      { value: 'Card', style: 'headText' },
      { value: 'Pays now', style: 'headNum' },
    ],
    [
      { value: 'AmEx', style: 'text' },
      { value: 'Platinum', style: 'bold' },
      { value: 720, style: 'money' },
    ],
    [
      { value: 'Chase', style: 'text', band: true },
      { value: `Sapphire${String.fromCharCode(7)}`, style: 'bold', band: true },
      { value: 600, style: 'money', band: true },
    ],
  ],
  heights: { 1: 26 },
  freeze: 4,
  filter: 'A4:C6',
  merges: ['A1:C1', 'A2:C2'],
};

const bytes = buildWorkbook(sheet);
check('something came out', bytes.length > 0);
check('and it starts with the zip signature', bytes.subarray(0, 2).toString('utf8') === 'PK');

// Throws on a wrong length or a wrong checksum, so getting here at all is a
// statement about the archive rather than about the XML inside it.
const files = readZip(bytes);
const wanted = [
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  'xl/styles.xml',
  'xl/worksheets/sheet1.xml',
];
check('every part Excel looks for is in it', wanted.every((name) => files.has(name)), [...files.keys()].join(' '));
check('and nothing else is', files.size === wanted.length);

// The same table twice has to be the same file, or nothing downstream can be
// asserted on the bytes. It is why the zip carries a fixed 1980 timestamp.
check('the same sheet exports the same bytes twice', buildWorkbook(sheet).equals(bytes));

console.log('\n— the plumbing between the parts —');
const types = files.get('[Content_Types].xml')!;
check('the workbook is declared', types.includes('/xl/workbook.xml'));
check('so is the sheet', types.includes('/xl/worksheets/sheet1.xml'));
check('and the styles', types.includes('/xl/styles.xml'));

const rels = files.get('xl/_rels/workbook.xml.rels')!;
const book = files.get('xl/workbook.xml')!;
check('the workbook points at a relationship', book.includes('r:id="rId1"'));
check('which is the sheet', /Id="rId1"[^>]*Target="worksheets\/sheet1.xml"/.test(rels));
check('and the styles have one of their own', /Id="rId2"[^>]*Target="styles.xml"/.test(rels));
check('the tab is named', book.includes('name="Rate card"'));
// The filter arrows are drawn by the worksheet and remembered by this.
check('the filter range survives a save', book.includes("'Rate card'!$A$4:$C$6"));

console.log('\n— the styles —');
const styles = files.get('xl/styles.xml')!;
check('money has a currency format', styles.includes('numFmtId="164"'));
check('a percentage has its own', styles.includes('formatCode="0.00%"'));
check('and a date is a date, not a serial number', styles.includes('formatCode="d mmm yyyy"'));
/*
 * The two Excel assumes. A file that omits them does not fail to open; it
 * opens with every fill shifted by two, which is worse.
 */
check('fill zero is none', styles.indexOf('patternType="none"') < styles.indexOf('patternType="gray125"'));
check('and fill one is gray125', styles.includes('patternType="gray125"'));
check('the header band is painted navy', styles.includes('fgColor rgb="FF0B2239"'));
const xfs = /<cellXfs count="(\d+)">/.exec(styles);
check('every style has a record, banded and not', xfs?.[1] === '21', xfs?.[1] ?? 'none');

console.log('\n— the sheet —');
const page = files.get('xl/worksheets/sheet1.xml')!;
/*
 * Order, which is the one thing Excel will not forgive. cols before sheetData,
 * autoFilter after it, mergeCells after that, then the page setup.
 */
const order = ['<sheetPr>', '<dimension', '<sheetViews>', '<sheetFormatPr', '<cols>', '<sheetData>', '<autoFilter', '<mergeCells', '<pageMargins', '<pageSetup'];
const positions = order.map((tag) => page.indexOf(tag));
check('every element is present', positions.every((at) => at !== -1), order.filter((_, i) => positions[i] === -1).join(' '));
check(
  'and they are in the order Excel demands',
  positions.every((at, i) => i === 0 || at > positions[i - 1]!),
  positions.join(','),
);

check('the heading rows stay put when it scrolls', page.includes('ySplit="4"') && page.includes('state="frozen"'));
check('the filter arrows are drawn', page.includes('<autoFilter ref="A4:C6"/>'));
check('the title spans the table', page.includes('<mergeCell ref="A1:C1"/>'));
check('the columns are given widths', page.includes('width="20"') && page.includes('width="30"'));
check('the title row is given room', page.includes('ht="26"'));
check('it prints landscape, fitted to the width', page.includes('orientation="landscape"') && page.includes('fitToWidth="1"'));

console.log('\n— the cells —');
check('a number is a number', page.includes('<v>720</v>'));
check('and carries no string marker', !/t="inlineStr"[^>]*><is><t[^>]*>720/.test(page));
check('a word is written inline', page.includes('t="inlineStr"'));
check('an ampersand is escaped', page.includes('Fish &amp; Chips'));
check('and so are the angle brackets', page.includes('&lt;plc&gt;'));
/*
 * A control character is legal in a cell somebody pasted into and illegal in
 * XML. Escaping it is not an option: it has to go, or the workbook will not
 * open at all.
 */
check('a control character is dropped', page.includes('>Sapphire<') && !page.includes(String.fromCharCode(7)));
check('a banded cell uses a different style from a plain one', /r="A6" s="(\d+)"/.exec(page)?.[1] !== /r="A5" s="(\d+)"/.exec(page)?.[1]);

console.log('\n— the edges —');
const bare = readZip(buildWorkbook({ name: 'Empty', columns: [], rows: [] }));
check('a sheet with no rows still opens', bare.has('xl/worksheets/sheet1.xml'));
check('and has no filter over nothing', !bare.get('xl/worksheets/sheet1.xml')!.includes('<autoFilter'));
const named = readZip(buildWorkbook({ name: 'a/b:c[d]e'.repeat(6), columns: [], rows: [] }));
const tab = /name="([^"]*)"/.exec(named.get('xl/workbook.xml')!)?.[1] ?? '';
check('a tab name is cleaned of what Excel refuses', !/[\\/?*[\]:]/.test(tab), tab);
check('and cut to thirty-one characters', tab.length <= 31, `${tab.length}`);

console.log(`\nxlsx: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
