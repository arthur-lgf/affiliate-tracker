// Load a CPA report export straight into the store, without the browser.
//
// The upload page is the normal way in. This exists for the first load and for
// re-seeding a fresh environment, where clicking through a sign-in to upload a
// file you already have on disk is the long way round.
//
//   npx tsx scripts/seed-cpa.ts "C:\\path\\CPA Report.csv"           (dry run)
//   npx tsx scripts/seed-cpa.ts "C:\\path\\CPA Report.csv" --apply   (writes)
//
// Dry run by default, and deliberately: this replaces the rate card the whole
// team quotes from, so seeing what it read before it writes is the point.
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCpaExport, sortRates } from '../src/lib/cpa';
import { getStore, storageStatus } from '../src/lib/store';
import type { CpaReport } from '../src/lib/types';

const file = process.argv[2];
const apply = process.argv.includes('--apply');
const by = process.argv.find((arg) => arg.startsWith('--by='))?.slice('--by='.length) ?? 'seed script';

if (!file) {
  console.error('Usage: npx tsx scripts/seed-cpa.ts "<file.csv>" [--apply] [--by=name]');
  process.exit(1);
}

const text = readFileSync(file, 'utf8');
const parsed = parseCpaExport(text);

console.log(`file:    ${file}`);
console.log(`storage: ${storageStatus()}`);
console.log(`day of:  ${parsed.reportDate || '(none in the file)'}`);
console.log(`rates:   ${parsed.rows.length}`);
console.log(`skipped: ${parsed.scaffold} grouping row(s) with no rate of their own`);
if (parsed.issues.length > 0) {
  console.log('issues:');
  for (const issue of parsed.issues.slice(0, 10)) console.log(`  line ${issue.line}: ${issue.detail}`);
}

if (parsed.rows.length === 0) {
  console.error('\nNothing to write.');
  process.exit(1);
}

const rows = sortRates(parsed.rows);
const issuers = new Set(rows.map((rate) => rate.issuer));
const cards = new Set(rows.map((rate) => `${rate.issuer}|${rate.card}`));
const tiered = rows.filter((rate) => rate.tier !== '').length;
const priced = rows.filter((rate) => rate.current !== null);
const highest = priced.reduce((best, rate) => (rate.current! > (best?.current ?? -1) ? rate : best), priced[0]);

console.log(`\nissuers: ${issuers.size}   cards: ${cards.size}   tier rows: ${tiered}`);
if (highest) console.log(`highest: ${highest.card}${highest.tier ? ` (${highest.tier})` : ''} at $${highest.current}`);
console.log('\nfirst five:');
for (const rate of rows.slice(0, 5)) {
  console.log(
    `  ${rate.issuer} · ${rate.card}${rate.tier ? ` · ${rate.tier}` : ''} → ` +
      `${rate.current === null ? '-' : `$${rate.current}`}`,
  );
}

if (!apply) {
  console.log('\nDry run. Nothing was written. Add --apply to load it.');
  process.exit(0);
}

const report: CpaReport = {
  reportDate: parsed.reportDate,
  updatedAt: new Date().toISOString(),
  updatedBy: by,
  source: path.basename(file),
  rows,
};

getStore()
  .writeCpaReport(report)
  .then(() => console.log(`\nWrote ${rows.length} rates to the ${storageStatus()} store.`))
  .catch((error: unknown) => {
    console.error('\nCould not write:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
