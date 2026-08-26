// Strip the cards that are not worth quoting out of a CPA report.
//
//   npx tsx scripts/cpa-filter.ts "C:\path\CPA Report.csv"                 (dry run)
//   npx tsx scripts/cpa-filter.ts "C:\path\CPA Report.csv" --apply         (rewrites it)
//   npx tsx scripts/cpa-filter.ts "C:\path\CPA Report.csv" --min=150 --apply
//
// The rule, and it is a card-level rule rather than a row-level one:
//
//   Drop a card whose rates are all under the floor. Keep it if it reaches the
//   floor at tier 1, 2 or 3 — a card that only clears $100 at tier 7 is not a
//   $100 card, it is a card with a tier 7 nobody is going to hit.
//
// A kept card keeps all of its tiers, including the ones under the floor.
// Deleting tier 1 of a card that is being kept for its tier 3 would leave a
// rate card that misquotes what the first approvals actually pay.
//
// The output is the input file with rows removed: same three title lines, same
// column order, same quoting. Nothing is rewritten except which rows are there,
// so it drops straight into the CPA upload page or scripts/seed-cpa.ts.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseCpaExport, parseDelimited, tierNumber } from '../src/lib/cpa';
import type { CpaRate } from '../src/lib/types';

const file = process.argv[2];
const apply = process.argv.includes('--apply');
const min = Number(process.argv.find((a) => a.startsWith('--min='))?.slice('--min='.length) ?? 100);
/** How far down the tiers the exception reaches. Tier 1-3 by default. */
const window = Number(
  process.argv.find((a) => a.startsWith('--tiers='))?.slice('--tiers='.length) ?? 3,
);
const out = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? file;

if (!file) {
  console.error('Usage: npx tsx scripts/cpa-filter.ts "<file.csv>" [--min=100] [--tiers=3] [--apply] [--out=path]');
  process.exit(1);
}
if (!Number.isFinite(min) || min < 0) {
  console.error(`--min has to be a number. Got: ${min}`);
  process.exit(1);
}

const text = readFileSync(file, 'utf8');
const parsed = parseCpaExport(text);
if (parsed.rows.length === 0) {
  console.error('Nothing parsed out of that file.');
  for (const issue of parsed.issues.slice(0, 5)) console.error(`  line ${issue.line}: ${issue.detail}`);
  process.exit(1);
}

/* ------------------------------------------------------------- the cards -- */

type Card = { issuer: string; card: string; rates: CpaRate[] };

const cards = new Map<string, Card>();
for (const rate of parsed.rows) {
  const key = `${rate.issuer}|${rate.card}`;
  const found = cards.get(key);
  if (found) found.rates.push(rate);
  else cards.set(key, { issuer: rate.issuer, card: rate.card, rates: [rate] });
}

/** The best rate this card pays anywhere, for reporting. */
function best(card: Card): number | null {
  const priced = card.rates.filter((rate) => rate.current !== null);
  if (priced.length === 0) return null;
  return Math.max(...priced.map((rate) => rate.current!));
}

/**
 * Whether a card earns its place.
 *
 * An untiered card is judged on its one rate. A tiered card is judged on tiers
 * 1 to `window` only: that is the difference between "this card can pay $100"
 * and "this card pays $100 to somebody sending volume nobody here sends".
 */
function keeps(card: Card): { keep: boolean; reason: string } {
  const priced = card.rates.filter((rate) => rate.current !== null);
  if (priced.length === 0) return { keep: false, reason: 'no rate at all' };

  const tiered = priced.filter((rate) => rate.tier !== '');
  if (tiered.length === 0) {
    const rate = priced[0]!.current!;
    return rate >= min
      ? { keep: true, reason: `$${rate}` }
      : { keep: false, reason: `$${rate}` };
  }

  const inWindow = tiered.filter((rate) => {
    const n = tierNumber(rate.tier);
    return n >= 1 && n <= window;
  });
  const reachable = inWindow.filter((rate) => rate.current! >= min);
  if (reachable.length > 0) {
    const at = reachable[0]!;
    return { keep: true, reason: `${at.tier} pays $${at.current}` };
  }

  const above = tiered.filter((rate) => rate.current! >= min);
  if (above.length > 0) {
    const first = above.sort((a, b) => tierNumber(a.tier) - tierNumber(b.tier))[0]!;
    return {
      keep: false,
      // Named rather than lumped in with the rest: this is the one class of
      // card where the floor and the exception disagree, and it is worth
      // seeing before it disappears.
      reason: `only reaches $${min} at ${first.tier}`,
    };
  }

  const top = Math.max(...tiered.map((rate) => rate.current!));
  return { keep: false, reason: `tops out at $${top}` };
}

const verdicts = [...cards.values()].map((card) => ({ card, ...keeps(card) }));
const kept = verdicts.filter((v) => v.keep);
const dropped = verdicts.filter((v) => !v.keep);
const keptKeys = new Set(kept.map((v) => `${v.card.issuer}|${v.card.card}`));

/* ---------------------------------------------------------- the report --- */

console.log(`file:  ${file}`);
console.log(`floor: $${min}, with tiers 1-${window} counting for the exception`);
console.log(`cards: ${cards.size} in, ${kept.length} kept, ${dropped.length} dropped`);

const rowsKept = parsed.rows.filter((rate) => keptKeys.has(`${rate.issuer}|${rate.card}`));
console.log(`rates: ${parsed.rows.length} in, ${rowsKept.length} kept, ${parsed.rows.length - rowsKept.length} dropped`);

const saved = dropped.filter((v) => v.reason.startsWith('only reaches'));
if (saved.length > 0) {
  console.log(`\nnote: ${saved.length} card(s) reach $${min} only below tier ${window + 1} and are dropped anyway.`);
}

console.log('\ndropped:');
for (const v of dropped.sort((a, b) => (best(b.card) ?? -1) - (best(a.card) ?? -1))) {
  console.log(`  ${v.card.issuer} · ${v.card.card} — ${v.reason}`);
}

const keptLow = kept.filter((v) => {
  const priced = v.card.rates.filter((r) => r.current !== null);
  return priced.some((r) => r.current! < min);
});
if (keptLow.length > 0) {
  console.log(`\nkept, but carrying tiers under $${min}:`);
  for (const v of keptLow) {
    const low = v.card.rates
      .filter((r) => r.current !== null && r.current! < min)
      .map((r) => `${r.tier || 'flat'} $${r.current}`)
      .join(', ');
    console.log(`  ${v.card.issuer} · ${v.card.card} — ${v.reason}; keeps ${low}`);
  }
}

/* ----------------------------------------------------------- the file ---- */

if (!apply) {
  console.log(`\nDry run. Nothing written. Add --apply to rewrite ${path.basename(out)}.`);
  process.exit(0);
}

/*
 * Rebuilt from the parsed table rather than by deleting text lines: a quoted
 * field is allowed to contain a newline, and a filter that assumes one row is
 * one line would cut such a file in half without saying so.
 */
const table = parseDelimited(text);
const header = table.findIndex(
  (cells) => cells.some((cell) => cell.trim().toLowerCase() === 'card name'),
);
if (header === -1) {
  console.error('The header row moved. Nothing written.');
  process.exit(1);
}

const columnOf = (name: string) =>
  table[header]!.findIndex((cell) => cell.trim().toLowerCase() === name);
const issuerAt = columnOf('issuer');
const cardAt = columnOf('card name');
if (issuerAt === -1 || cardAt === -1) {
  console.error('The issuer or card column is missing. Nothing written.');
  process.exit(1);
}

const keptTable = table.filter((cells, index) => {
  if (index <= header) return true;
  if (cells.every((cell) => cell.trim() === '')) return false;
  return keptKeys.has(`${(cells[issuerAt] ?? '').trim()}|${(cells[cardAt] ?? '').trim()}`);
});

/** Quoted the way the export quotes: every field, always. */
const csv = keptTable
  .map((cells) => cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
  .join('\r\n');

// The original is worth keeping. This runs against a file in somebody's
// Downloads folder that came out of a reporting tool, and re-downloading it is
// not always possible a month later.
if (out === file) {
  const backup = file.replace(/\.csv$/i, '') + ' (unfiltered).csv';
  if (!existsSync(backup)) {
    copyFileSync(file, backup);
    console.log(`\nkept the original as ${path.basename(backup)}`);
  } else {
    console.log(`\noriginal already backed up at ${path.basename(backup)}`);
  }
}

// The BOM the export ships with, so Excel still opens it as UTF-8.
writeFileSync(out, '\ufeff' + csv + '\r\n', 'utf8');
console.log(`wrote ${path.basename(out)}: ${keptTable.length - header - 1} data row(s)`);

// Read it back and check it says what we think it says.
const after = parseCpaExport(readFileSync(out, 'utf8'));
const ok = after.rows.length === rowsKept.length;
console.log(
  ok
    ? `re-read: ${after.rows.length} rates, as expected`
    : `re-read: ${after.rows.length} rates, expected ${rowsKept.length} — check the file`,
);
process.exitCode = ok ? 0 : 1;
