// Filtering the rate card, and the three files it comes out as.
//
// Two things are worth holding still here. The first is money: a filter that
// keeps the wrong cards, or an export that drops a tier from a card it kept,
// is a price list somebody quotes from. The second is who may read what: an
// affiliate's copy of any of these must not contain the merchant's rate, and
// "must not" is a claim about bytes rather than about columns, so the checks
// read the finished files rather than the arrays they were built from.
//
//   npx tsx scripts/cpa-export-checks.ts
//   npx tsx scripts/cpa-export-checks.ts --write <dir>   (also saves samples)
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { parseCpaExport, ratesForViewer } from '../src/lib/cpa';
import {
  NO_FILTER,
  columnsFor,
  defaultSort,
  describeFilter,
  filterGroups,
  filterQuery,
  groupRates,
  isFiltered,
  issuersOf,
  payoutOf,
  readFilter,
  readSort,
  sortGroups,
  type CpaFilter,
} from '../src/lib/cpa-groups';
import { cpaCsv, cpaWorkbook, exportLines, exportName, scopeNote, type CpaExportMeta } from '../src/lib/cpa-export';
import { buildCpaPdf } from '../src/lib/pdf/cpa-pdf';
import type { CpaRate } from '../src/lib/types';
import { pdfContent } from './read-pdf';
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

/* ------------------------------------------------------------ fixtures -- */

const rate = (over: Partial<CpaRate>): CpaRate => ({
  placement: '714025 - LGF',
  issuer: 'AmEx Consumer',
  card: 'Platinum Card',
  tier: '',
  current: 100,
  previous: 90,
  change: 0.1,
  changedOn: '2026-07-01',
  ...over,
});

/*
 * Tier 1 of the Platinum pays under every floor these checks use, on purpose:
 * the rule is that a card kept for its best tier keeps all of them, and a
 * fixture whose tiers all clear the floor cannot tell whether that holds.
 */
const rates: CpaRate[] = [
  rate({ card: 'Platinum Card', tier: 'Tier 1', current: 100 }),
  rate({ card: 'Platinum Card', tier: 'Tier 2', current: 500 }),
  rate({ card: 'Platinum Card', tier: 'Tier 3', current: 700 }),
  rate({ issuer: 'Chase', card: 'Sapphire Preferred, Visa', current: 240, previous: 300, change: -0.2 }),
  rate({ issuer: 'Capital One', card: 'Quicksilver', current: 90 }),
  rate({ issuer: 'Discover', card: 'Nothing Card', current: null, previous: null, change: null }),
];

const asAdmin = groupRates(ratesForViewer(rates, true));
const asTheirs = groupRates(ratesForViewer(rates, false));
const withFilter = (over: Partial<CpaFilter>): CpaFilter => ({ ...NO_FILTER, ...over });
const names = (groups: ReturnType<typeof groupRates>) => groups.map((group) => group.card).join('|');

console.log('— the cards —');
check('rates fold into cards', asAdmin.length === 4, names(asAdmin));
check('a tiered card keeps its tiers', asAdmin[0]!.rates.length === 3);
check('and knows it is tiered', asAdmin[0]!.tiered && !asAdmin[1]!.tiered);
check('a card is judged on its best tier', payoutOf(asAdmin[0]!, true) === 700);
check('an affiliate reads the same card as their own half', payoutOf(asTheirs[0]!, false) === 350);
check('a card with no rate has no payout', payoutOf(asAdmin[3]!, true) === null);
check('the issuers come back once each, in order', issuersOf(asAdmin).join('|') === 'AmEx Consumer|Capital One|Chase|Discover');

console.log('\n— the filter —');
const floor = filterGroups(asAdmin, withFilter({ min: 200 }), true);
check('a floor drops the cards under it', names(floor) === 'Platinum Card|Sapphire Preferred, Visa');
check('a card with no rate at all cannot clear a floor', !names(floor).includes('Nothing'));
/*
 * The rule the whole filter turns on. Dropping the tiers under the floor from
 * a card that is being kept for its top one would leave a rate card that
 * misquotes what the first approvals actually pay.
 */
check('a card kept for its best tier keeps every tier', floor[0]!.rates.length === 3);
check('including the one under the floor', floor[0]!.rates.some((r) => r.current === 100));

/*
 * The same floor means two different amounts to two readers, which is the
 * price of filtering on the column somebody can actually see. The control that
 * sets it says which, and so does the line at the top of every export.
 */
const theirFloor = filterGroups(asTheirs, withFilter({ min: 200 }), false);
check('an affiliate filters on their own half', names(theirFloor) === 'Platinum Card', names(theirFloor));

check('an issuer narrows to one', names(filterGroups(asAdmin, withFilter({ issuer: 'Chase' }), true)) === 'Sapphire Preferred, Visa');
check('an issuer nobody has leaves nothing', filterGroups(asAdmin, withFilter({ issuer: 'Barclays' }), true).length === 0);
check('tiered only keeps the tiered', names(filterGroups(asAdmin, withFilter({ shape: 'tiered' }), true)) === 'Platinum Card');
check('one rate only drops them', !names(filterGroups(asAdmin, withFilter({ shape: 'flat' }), true)).includes('Platinum'));
check('a search reads the card name', names(filterGroups(asAdmin, withFilter({ query: 'sapphire' }), true)) === 'Sapphire Preferred, Visa');
check('and the issuer', names(filterGroups(asAdmin, withFilter({ query: 'capital' }), true)) === 'Quicksilver');
check('and a tier label', names(filterGroups(asAdmin, withFilter({ query: 'tier 2' }), true)) === 'Platinum Card');
check('but not the amounts', filterGroups(asAdmin, withFilter({ query: '700' }), true).length === 0);
check('filters stack', filterGroups(asAdmin, withFilter({ issuer: 'Chase', min: 500 }), true).length === 0);
check('nothing set keeps everything', filterGroups(asAdmin, NO_FILTER, true).length === asAdmin.length);
check('and reads as unfiltered', !isFiltered(NO_FILTER) && isFiltered(withFilter({ min: 100 })));

console.log('\n— saying what the filter was —');
check('an admin filter is described as what a card pays', describeFilter(withFilter({ min: 200 }), true) === 'Paying $200 or more');
check('and an affiliate one as what they would earn', describeFilter(withFilter({ min: 200 }), false) === 'Earning $200 or more');
check('an unfiltered export says so in words', scopeNote({ filter: NO_FILTER, gross: true } as CpaExportMeta) === 'Every card on the rate card');
check(
  'everything set reads as a sentence',
  describeFilter(withFilter({ issuer: 'Chase', min: 100, shape: 'tiered', query: 'gold' }), true) ===
    'Chase · paying $100 or more · tiered cards only · matching "gold"',
  describeFilter(withFilter({ issuer: 'Chase', min: 100, shape: 'tiered', query: 'gold' }), true),
);

console.log('\n— the filter in a URL —');
const carried = withFilter({ issuer: 'Chase', min: 200, shape: 'flat', query: 'sapphire' });
const query = filterQuery(carried, defaultSort(true));
const read = readFilter(new URLSearchParams(query));
check('a filter survives the round trip', JSON.stringify(read) === JSON.stringify(carried), query);
check('and so does the sort', JSON.stringify(readSort(new URLSearchParams(query), true)) === JSON.stringify(defaultSort(true)));
check('an empty filter writes nothing', filterQuery(NO_FILTER, null) === '');
check('a nonsense floor is no floor', readFilter(new URLSearchParams('min=abc')).min === null);
check('nor is a negative one', readFilter(new URLSearchParams('min=-500')).min === null);
check('a nonsense shape is every shape', readFilter(new URLSearchParams('shape=banana')).shape === 'all');
check('a very long search is cut short', readFilter(new URLSearchParams(`q=${'x'.repeat(4000)}`)).query.length === 120);
check('no sort at all opens on the default', JSON.stringify(readSort(new URLSearchParams(''), false)) === JSON.stringify(defaultSort(false)));
/*
 * The one that matters. "Pays now" is a column an affiliate does not have, so
 * a hand-edited sort naming it must fall back to a column they do, or the
 * download comes out in whatever order the store happened to hold.
 */
check(
  'a sort naming a column this reader has not got falls back',
  JSON.stringify(readSort(new URLSearchParams('sort=current&dir=asc'), false)) === JSON.stringify(defaultSort(false)),
);
check('and one they have is kept', readSort(new URLSearchParams('sort=issuer&dir=asc'), false)?.key === 'issuer');

console.log('\n— the order it all opens in —');
check('the highest paying card is first for an admin', sortGroups(asAdmin, defaultSort(true), true)[0]!.card === 'Platinum Card');
check('and for everybody else', sortGroups(asTheirs, defaultSort(false), false)[0]!.card === 'Platinum Card');
check('a card with no rate sinks either way', sortGroups(asAdmin, defaultSort(true), true).at(-1)!.card === 'Nothing Card');
check('the affiliate has no merchant column to sort by', !columnsFor(false).some((column) => column.key === 'current'));

console.log('\n— the lines a file is made of —');
const lines = exportLines(sortGroups(asAdmin, defaultSort(true), true), defaultSort(true));
check('one line per rate', lines.length === 6, `${lines.length}`);
/*
 * Repeated rather than left blank the way the table on screen does it: sort a
 * spreadsheet whose card names appear once per group and the tiers come loose
 * from their cards for good.
 */
check('every tier carries its card name', lines.filter((line) => line.card === 'Platinum Card').length === 3);
check('only the first line of a card is the one in bold', lines.filter((line) => line.card === 'Platinum Card' && line.first).length === 1);
check('a whole card takes one band', new Set(lines.filter((line) => line.card === 'Platinum Card').map((line) => line.band)).size === 1);
check(
  'sorting by tier, highest first, turns the tiers round',
  exportLines(asAdmin, { key: 'tier', direction: 'desc' })[0]!.tier === 'Tier 3',
);

console.log('\n— the CSV —');
const meta = (over: Partial<CpaExportMeta> = {}): CpaExportMeta => ({
  reportDate: '2026-07-01',
  exportedOn: '2026-08-26T10:00:00.000Z',
  exportedBy: 'evan',
  gross: true,
  filter: NO_FILTER,
  sort: defaultSort(true),
  total: asAdmin.length,
  ...over,
});

const csv = cpaCsv(sortGroups(asAdmin, defaultSort(true), true), meta());
check('it opens with a byte order mark, so Excel reads it as UTF-8', csv.startsWith('﻿'));
check('the day the rates were read is on it', csv.includes('"Day of","2026-07-01"'));
check('and who exported it, and when', csv.includes('"Exported","26 Aug 2026 by evan"'));
check('and what the filter was', csv.includes('"Filter","Every card on the rate card"'));
check('and how much of the card is in it', csv.includes('"Cards","4 cards, 6 rates"'));

/*
 * The whole reason the CSV is written in QMP's column names: an admin can
 * filter the rate card on screen, download it, and upload it straight back.
 * This is that round trip, run for real.
 */
const back = parseCpaExport(csv);
check('it parses back as a CPA report', back.rows.length === 5, JSON.stringify(back.issues.slice(0, 2)));
check('with the day of the report intact', back.reportDate === '2026-07-01');
check('and every rate unchanged', back.rows.map((row) => row.current).sort((a, b) => (a ?? -1) - (b ?? -1)).join() === '90,100,240,500,700');
check('a card name with a comma in it survives', back.rows.some((row) => row.card === 'Sapphire Preferred, Visa'));
/*
 * The one thing that does not survive the trip, and it is the format rather
 * than this code: a row with no tier and no rate is how the export writes the
 * blank parent of a tiered card, so a card that pays nothing at all is read
 * back as scaffold and skipped. Writing it as 0 instead would be worse, since
 * a card at 0 has been switched off and is a different thing from a card with
 * no figure.
 */
check('a card with no rate at all reads back as scaffold', back.scaffold === 1, `${back.scaffold}`);
check('and is not silently turned into a card that pays nothing', !back.rows.some((row) => row.card === 'Nothing Card'));
check('a rate that went down keeps its sign', back.rows.some((row) => row.change === -0.2));

const filtered = filterGroups(asAdmin, withFilter({ min: 200 }), true);
const filteredCsv = cpaCsv(filtered, meta({ filter: withFilter({ min: 200 }) }));
check('a filtered file says it is filtered', filteredCsv.includes('"Filter","Paying $200 or more"'));
check('and says how much it left out', filteredCsv.includes('"Cards","2 of 4 cards'), filteredCsv.split('\r\n')[4]);

const theirCsv = cpaCsv(sortGroups(asTheirs, defaultSort(false), false), meta({ gross: false, sort: defaultSort(false) }));
check('an affiliate CSV has no merchant column', !theirCsv.includes('Current Net CPA'));
check('nor what the card paid before', !theirCsv.includes('Previous Net CPA'));
check('their own half is in it', theirCsv.includes('"350"'));
check('and the merchant rate it came from is not', !theirCsv.includes('"700"'));

console.log('\n— the workbook —');
const workbook = readZip(cpaWorkbook(sortGroups(asAdmin, defaultSort(true), true), meta()));
const page = workbook.get('xl/worksheets/sheet1.xml')!;
check('it is titled', page.includes('Commission per approvals'));
check('it says when the rates were read', page.includes('Rates as at 1 Jul 2026'));
check('and what filter made it', page.includes('Every card on the rate card'));
check('the columns are named as the page names them', page.includes('>Pays now<') && page.includes('>Potential revenue<'));
check('money is a number, not a string of one', page.includes('<v>700</v>'));
check('a percentage is stored as a fraction and formatted as one', page.includes('<v>0.1</v>'));
check('a date is stored as a day Excel understands', page.includes(`<v>46204</v>`));
check('the heading and the column names are frozen', page.includes('ySplit="4"'));
check('and Excel gets its own filter arrows', page.includes('<autoFilter'));

const theirBook = readZip(cpaWorkbook(sortGroups(asTheirs, defaultSort(false), false), meta({ gross: false, sort: defaultSort(false) })));
const theirPage = theirBook.get('xl/worksheets/sheet1.xml')!;
check('an affiliate workbook has no merchant column', !theirPage.includes('>Pays now<'));
check('nor a Change column', !theirPage.includes('>Change<'));
check('their own half is in it', theirPage.includes('<v>350</v>'));
check('the merchant rate is not', !theirPage.includes('<v>700</v>'));

async function main() {
  console.log('\n— the PDF —');
  const pdfBytes = await buildCpaPdf(sortGroups(asAdmin, defaultSort(true), true), meta());
  const pdf = Buffer.from(pdfBytes);
  check('it is a PDF', pdf.subarray(0, 5).toString('utf8') === '%PDF-');
  const loaded = await PDFDocument.load(pdfBytes);
  check('with a page in it', loaded.getPageCount() === 1, `${loaded.getPageCount()}`);
  check('and a title', loaded.getTitle() === 'Commission per approvals');
  check('that says what filter made it', loaded.getSubject() === 'Every card on the rate card');

  // pdf-lib compresses the content stream, so the page has to be unpacked
  // before anything can be said about what is on it. Searching the raw bytes
  // would pass every one of these checks for the wrong reason.
  const drawn = await pdfContent(pdfBytes);
  check('the heading is on the page', drawn.includes('Commission per approvals'));
  check('the cards are on it', drawn.includes('Platinum Card') && drawn.includes('Quicksilver'));
  check('so are the tiers', drawn.includes('Tier 3'));
  check('and the caveat travels with it', drawn.includes('can still be revised'));
  check('the page is numbered', drawn.includes('Page 1 of 1'));
  check('a card name with a comma is not cut at the comma', drawn.includes('Sapphire Preferred, Visa'));

  /*
   * The leak check, read off the finished file rather than off the array it came
   * from. $700 is the merchant's top tier and $350 is the affiliate's half of it;
   * one of those may appear in their copy and the other may not.
   */
  const theirPdf = await pdfContent(
    await buildCpaPdf(sortGroups(asTheirs, defaultSort(false), false), meta({ gross: false, sort: defaultSort(false) })),
  );
  check('an affiliate PDF prints their half', theirPdf.includes('$350'));
  check('and never the merchant rate behind it', !theirPdf.includes('$700'), 'the gross reached the page');
  check('nor a column heading for one', !theirPdf.includes('Pays now') && !theirPdf.includes('Paid before'));

  console.log('\n— the edges —');
  const many = Array.from({ length: 90 }, (_, i) =>
    rate({ issuer: 'Bank ' + (i % 4), card: 'Card ' + i, current: 100 + i }),
  );
  const long = groupRates(ratesForViewer(many, true));
  const longPdf = await buildCpaPdf(sortGroups(long, defaultSort(true), true), meta({ total: long.length }));
  const longDoc = await PDFDocument.load(longPdf);
  check('ninety cards run to more than one page', longDoc.getPageCount() > 1, `${longDoc.getPageCount()}`);
  const longDrawn = await pdfContent(longPdf);
  check('and every page is numbered out of the same total', longDrawn.includes(`Page ${longDoc.getPageCount()} of ${longDoc.getPageCount()}`));
  check('the last card is on the last page', longDrawn.includes('Card 0') && longDrawn.includes('Card 89'));

  const empty = await buildCpaPdf([], meta({ filter: withFilter({ min: 750 }), total: asAdmin.length }));
  check('a filter that matches nothing still makes a file', Buffer.from(empty).subarray(0, 5).toString('utf8') === '%PDF-');
  check('which says so', (await pdfContent(empty)).includes('No cards match this filter'));
  const emptyCsv = cpaCsv([], meta({ filter: withFilter({ min: 750 }) }));
  check('and so does the CSV', emptyCsv.includes('"Cards","0 of 4 cards, 0 rates"'), emptyCsv.split('\r\n')[4]);

  console.log('\n— what the files are called —');
  check('a download is named for the day it was taken', exportName('pdf', '2026-08-26T10:00:00.000Z') === 'rate-card-2026-08-26.pdf');
  check('and carries the right extension', exportName('xlsx', '2026-08-26') === 'rate-card-2026-08-26.xlsx');

  /* Samples on disk, for looking at rather than asserting on. */
  const writeAt = process.argv.indexOf('--write');
  if (writeAt !== -1 && process.argv[writeAt + 1]) {
    const dir = process.argv[writeAt + 1]!;
    writeFileSync(path.join(dir, 'rate-card.csv'), csv, 'utf8');
    writeFileSync(path.join(dir, 'rate-card.xlsx'), cpaWorkbook(sortGroups(asAdmin, defaultSort(true), true), meta()));
    writeFileSync(path.join(dir, 'rate-card.pdf'), pdf);
    writeFileSync(path.join(dir, 'rate-card-long.pdf'), Buffer.from(longPdf));
    console.log(`\nwrote samples to ${dir}`);
  }

  console.log(`\ncpa export: ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

void main();
