/**
 * Reading a CPA report export.
 *
 * QuinStreet's "CPA Report" is a per-card rate card: what each issuer pays for
 * an approval, and where a card is tiered, what each tier pays. It is exported
 * by hand and uploaded here, because there is no API that serves it — the
 * reporting API this app already talks to returns performance, not rates.
 *
 * The export is a spreadsheet written for people, not for a parser, so three
 * things about it have to be handled rather than assumed:
 *
 *   1. Two title lines sit above the header row ("Report Name", "Day of").
 *   2. A tiered card is written as a blank parent row followed by one row per
 *      tier. The parent carries no rate — it exists so the web version can put
 *      a collapse arrow on it — and it is not a row of data.
 *   3. Money, percentages and dates all use "-" for "nothing here", and money
 *      may or may not arrive with a dollar sign and thousands separators
 *      depending on whether it came straight from QMP or through Excel.
 *
 * Everything here is pure: text in, rows out, no store and no I/O.
 * scripts/cpa-checks.ts holds it to the three rules above.
 */

import { affiliateRevenueOf } from './analytics';
import type { CpaRate, CpaReport } from './types';

/** What the parser could not make sense of, for showing to whoever uploaded. */
export type CpaParseIssue = { line: number; detail: string };

export type CpaParseResult = {
  rows: CpaRate[];
  /** The "Day of" line, as an ISO day. Empty when the export has no such line. */
  reportDate: string;
  /** Parent rows of tiered cards, which carry no rate and are not data. */
  scaffold: number;
  issues: CpaParseIssue[];
};

/**
 * A spreadsheet parsed into cells: quotes, doubled quotes, embedded commas and
 * embedded newlines all handled, because a card name with a comma in it is a
 * normal thing and splitting on commas would silently shift every column after
 * it by one.
 *
 * Tabs are accepted as well as commas: "Save as" in Excel offers both, and a
 * file saved as "Text (tab delimited)" is otherwise indistinguishable from a
 * CSV with one very wide column.
 */
export function parseDelimited(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  const delimiter = chooseDelimiter(body);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;

    if (quoted) {
      if (ch !== '"') {
        cell += ch;
      } else if (body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  // Whatever the file ended on, unless it ended on a newline and left nothing.
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

/**
 * Comma or tab, decided by which one appears more outside of quotes on the
 * first few lines. Counting the whole file would let a single long quoted note
 * full of commas outvote the actual delimiter.
 */
function chooseDelimiter(text: string): ',' | '\t' {
  let commas = 0;
  let tabs = 0;
  let quoted = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 5; i += 1) {
    const ch = text[i]!;
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === ',') commas += 1;
    else if (ch === '\t') tabs += 1;
    else if (ch === '\n') lines += 1;
  }
  return tabs > commas ? '\t' : ',';
}

/** Header cells compared with the spacing, case and punctuation taken out. */
function headerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Which column is which, by name rather than by position.
 *
 * By name because the file passes through Excel on its way here, and a person
 * who moves a column or deletes one they do not care about should get a report
 * that still reads correctly rather than one where every issuer is a dollar
 * amount.
 */
const COLUMNS = {
  placement: ['placementname', 'placement'],
  issuer: ['issuer'],
  card: ['cardname', 'card'],
  tier: ['tier'],
  current: ['currentnetcpa', 'currentcpa', 'netcpa', 'cpa', 'current'],
  previous: ['previousnetcpa', 'previouscpa', 'previous'],
  change: ['percentchange', 'change'],
  changedOn: ['datechangeofcurrentnetcpa', 'datechange', 'effectivedate', 'date'],
} as const;

type Column = keyof typeof COLUMNS;

function mapHeader(cells: string[]): Partial<Record<Column, number>> | null {
  const found: Partial<Record<Column, number>> = {};
  cells.forEach((cell, index) => {
    const key = headerKey(cell);
    if (!key) return;
    for (const [column, aliases] of Object.entries(COLUMNS) as [Column, readonly string[]][]) {
      if (found[column] === undefined && aliases.includes(key)) found[column] = index;
    }
  });
  // A card and a rate are the two columns the page cannot be drawn without.
  return found.card !== undefined && found.current !== undefined ? found : null;
}

/**
 * A money cell as a number, or null for "nothing".
 *
 * "-" is QMP's way of writing "no value", and it has to stay distinct from
 * zero: a card at $0 has been switched off and is worth seeing, while a blank
 * previous rate only means the card is new.
 */
export function parseAmount(raw: string): number | null {
  const text = raw.trim();
  if (text === '' || text === '-') return null;
  const cleaned = text.replace(/[$,\s]/g, '');
  const negated = /^\((.*)\)$/.exec(cleaned);
  const value = Number(negated ? `-${negated[1]}` : cleaned);
  return Number.isFinite(value) ? value : null;
}

/** "10.00%" as 0.1. Null for "-" and for anything that is not a number. */
export function parsePercent(raw: string): number | null {
  const text = raw.trim();
  if (text === '' || text === '-') return null;
  const value = Number(text.replace(/[%\s,]/g, ''));
  return Number.isFinite(value) ? value / 100 : null;
}

/**
 * A date cell as an ISO day, or "" for "nothing".
 *
 * Both orders are accepted because the file arrives written both ways:
 * QuinStreet exports the body as 2026-07-01 and the "Day of" line as
 * 08/20/2026, and Excel rewrites whichever it feels like on save.
 */
export function parseDay(raw: string): string {
  const text = raw.trim();
  if (text === '' || text === '-') return '';

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (slashed) {
    const month = slashed[1]!.padStart(2, '0');
    const day = slashed[2]!.padStart(2, '0');
    return `${slashed[3]}-${month}-${day}`;
  }

  return '';
}

/** "Tier 1" kept as written; anything blank or "-" means the card has one rate. */
function parseTier(raw: string): string {
  const text = raw.trim();
  return text === '-' ? '' : text;
}

/**
 * The whole export, read into rows.
 *
 * Nothing throws. A file that is not a CPA report at all comes back with no
 * rows and one issue saying so, which the upload route turns into a message
 * rather than a 500 — the person on the other end picked the wrong file, and
 * that is not an error condition of the server.
 */
export function parseCpaExport(text: string): CpaParseResult {
  const table = parseDelimited(text);
  const issues: CpaParseIssue[] = [];

  let headerAt = -1;
  let columns: Partial<Record<Column, number>> | null = null;
  for (let i = 0; i < table.length; i += 1) {
    const mapped = mapHeader(table[i]!);
    if (mapped) {
      headerAt = i;
      columns = mapped;
      break;
    }
  }

  if (!columns) {
    return {
      rows: [],
      reportDate: '',
      scaffold: 0,
      issues: [
        {
          line: 0,
          detail:
            'No header row was found. A CPA report has a row naming its columns, and at least ' +
            '"Card Name" and "Current Net CPA" have to be among them.',
        },
      ],
    };
  }

  // The title lines above the header. "Day of" is the day the rates were read.
  let reportDate = '';
  for (const cells of table.slice(0, headerAt)) {
    const label = headerKey(cells[0] ?? '');
    if (label === 'dayof' || label === 'asof' || label === 'reportdate') {
      reportDate = parseDay(cells[1] ?? '');
    }
  }

  const at = (cells: string[], column: Column): string => {
    const index = columns![column];
    return index === undefined ? '' : (cells[index] ?? '');
  };

  const rows: CpaRate[] = [];
  let scaffold = 0;

  for (let i = headerAt + 1; i < table.length; i += 1) {
    const cells = table[i]!;
    const card = at(cells, 'card').trim();
    const tier = parseTier(at(cells, 'tier'));
    const current = parseAmount(at(cells, 'current'));
    const previous = parseAmount(at(cells, 'previous'));

    if (!card) {
      issues.push({ line: i + 1, detail: 'No card name on this row, so it was skipped.' });
      continue;
    }

    /*
     * The parent row of a tiered card: no tier of its own and no rate either
     * way, because the rates are on the tier rows underneath it. Counted rather
     * than reported, since it is a normal part of the format and not a problem
     * with the file.
     */
    if (!tier && current === null && previous === null) {
      scaffold += 1;
      continue;
    }

    rows.push({
      placement: at(cells, 'placement').trim(),
      issuer: at(cells, 'issuer').trim(),
      card,
      tier,
      current,
      previous,
      change: parsePercent(at(cells, 'change')),
      changedOn: parseDay(at(cells, 'changedOn')),
    });
  }

  if (rows.length === 0) {
    issues.push({ line: headerAt + 1, detail: 'The header was found but no rate rows followed it.' });
  }

  return { rows, reportDate, scaffold, issues };
}

/** Issuer, then card, then tier in numeric order — the order QMP writes them in. */
export function sortRates(rows: CpaRate[]): CpaRate[] {
  return [...rows].sort(
    (a, b) =>
      a.issuer.localeCompare(b.issuer, undefined, { sensitivity: 'base' }) ||
      a.card.localeCompare(b.card, undefined, { sensitivity: 'base' }) ||
      tierNumber(a.tier) - tierNumber(b.tier),
  );
}

/** "Tier 10" sorts after "Tier 9", and a card with one rate sorts first. */
export function tierNumber(tier: string): number {
  const match = /(\d+)/.exec(tier);
  return match ? Number(match[1]) : 0;
}

/**
 * A rate as the table draws it.
 *
 * The placement is gone — it is the same string on every row of the export and
 * the table never shows it — and the affiliate's half is worked out here rather
 * than in the browser, because for most readers it is the only money figure
 * that crosses at all.
 */
export type CpaRateView = {
  issuer: string;
  card: string;
  tier: string;
  /** Half of what the card pays. The one money figure everybody is shown. */
  revenue: number | null;
  /** What the merchant pays. Null for a viewer who is not shown it. */
  current: number | null;
  previous: number | null;
  change: number | null;
  changedOn: string;
};

/**
 * The rate card cut to what this viewer may see.
 *
 * An affiliate is shown their own half and nothing else — not the merchant's
 * rate, not what it used to be, not how it moved. Those are dropped here rather
 * than hidden in the table, so they are not sitting in the page source of a
 * browser that was never meant to have them.
 *
 * The half is kept even where the gross is dropped, and that is the point: the
 * figure an affiliate quotes from is theirs, and it does not depend on being
 * told the number it came from.
 */
export function ratesForViewer(rates: CpaRate[], gross: boolean): CpaRateView[] {
  return rates.map((rate) => ({
    issuer: rate.issuer,
    card: rate.card,
    tier: rate.tier,
    revenue: rate.current === null ? null : affiliateRevenueOf(rate.current),
    current: gross ? rate.current : null,
    previous: gross ? rate.previous : null,
    change: gross ? rate.change : null,
    changedOn: rate.changedOn,
  }));
}

/** An empty report, so a page with nothing uploaded yet has something to render. */
export function emptyCpaReport(): CpaReport {
  return { reportDate: '', updatedAt: '', updatedBy: '', source: '', rows: [] };
}
