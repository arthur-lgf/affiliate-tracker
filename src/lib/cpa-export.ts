/**
 * The rate card as a file: a spreadsheet to work in, or a CSV to feed a tool.
 *
 * Both are built from the same flattened list, so the two downloads can never
 * disagree about which cards were in the export. What differs is only what a
 * reader can do with them:
 *
 *   - The workbook is a document. It carries the heading, what the filter was,
 *     column widths, currency formats, a frozen header row and Excel's own
 *     filter arrows, because somebody is going to open it and read it.
 *   - The CSV is data. It cannot carry any of that, so instead it is written in
 *     the shape this app's own upload page reads: an admin can filter the rate
 *     card on screen, export it, and upload it straight back. That workflow is
 *     the reason the CSV exists at all, and it is why its column names are
 *     QMP's rather than the ones on the page.
 *
 * scripts/cpa-export-checks.ts reads both back.
 */

import { formatDay } from './analytics';
import { describeFilter, tiersOf, type CpaFilter, type CpaGroup, type CpaSort } from './cpa-groups';
import { buildWorkbook, columnName, excelDay, type XlsxCell } from './xlsx';

export type CpaExportMeta = {
  /** The day the rates were read, from the "Day of" line of the export. */
  reportDate: string;
  /** When this file was made, as an ISO timestamp. */
  exportedOn: string;
  exportedBy: string;
  /** Whether this reader is shown the merchant's own figures. */
  gross: boolean;
  filter: CpaFilter;
  sort: CpaSort;
  /** Cards on the whole rate card, before the filter, so the file can say so. */
  total: number;
};

/**
 * One line of the file: one rate, with the card it belongs to repeated on it.
 *
 * Repeated rather than left blank the way the table on screen does it. A blank
 * carries the grouping down the page for a human eye, and destroys it for
 * every tool: sort a spreadsheet whose card names appear once per group and the
 * tiers come loose from their cards for good.
 */
export type ExportLine = {
  issuer: string;
  card: string;
  tier: string;
  current: number | null;
  revenue: number | null;
  previous: number | null;
  change: number | null;
  changedOn: string;
  /** The first line of its card, which is the one that carries the name in bold. */
  first: boolean;
  /** Whether this card sits on the shaded band. Whole cards, never half of one. */
  band: boolean;
};

export function exportLines(groups: CpaGroup[], sort: CpaSort): ExportLine[] {
  const lines: ExportLine[] = [];
  groups.forEach((group, index) => {
    tiersOf(group, sort).forEach((rate, at) => {
      lines.push({
        issuer: group.issuer,
        card: group.card,
        tier: rate.tier,
        current: rate.current,
        revenue: rate.revenue,
        previous: rate.previous,
        change: rate.change,
        changedOn: rate.changedOn,
        first: at === 0,
        band: index % 2 === 1,
      });
    });
  });
  return lines;
}

/** What the top of a file says about how much of the rate card is in it. */
export function describeScope(groups: CpaGroup[], meta: CpaExportMeta): string {
  const rates = groups.reduce((count, group) => count + group.rates.length, 0);
  const cards =
    groups.length === meta.total
      ? `${groups.length} cards`
      : `${groups.length} of ${meta.total} cards`;
  return `${cards}, ${rates} rate${rates === 1 ? '' : 's'}`;
}

/** The filter in words, or the sentence that says there was not one. */
export function scopeNote(meta: CpaExportMeta): string {
  return describeFilter(meta.filter, meta.gross) || 'Every card on the rate card';
}

/** A download's name. Dated, because two of these in a folder are two dates. */
export function exportName(format: 'pdf' | 'xlsx' | 'csv', day: string): string {
  return `rate-card-${day.slice(0, 10)}.${format}`;
}

/* ---------------------------------------------------------------- CSV ---- */

/**
 * The columns, and what each one is called in the file.
 *
 * An admin's file uses QMP's own names for the three merchant figures, so that
 * a filtered export can be uploaded straight back into this app: the upload
 * matches columns by name, and "Pays now" is not a name it knows. "Potential
 * Revenue" sits between them and is ignored on the way back in, which is
 * correct, because it is worked out from the rate rather than stored.
 */
function csvColumns(gross: boolean): { label: string; of: (line: ExportLine) => string }[] {
  const money = (value: number | null) => (value === null ? '-' : String(value));
  const day = (value: string) => value || '-';

  const opening = [
    { label: 'Issuer', of: (line: ExportLine) => line.issuer },
    { label: 'Card Name', of: (line: ExportLine) => line.card },
    { label: 'Tier', of: (line: ExportLine) => line.tier || '-' },
  ];

  if (!gross) {
    return [
      ...opening,
      { label: 'Potential Revenue', of: (line: ExportLine) => money(line.revenue) },
      { label: 'Rate Changed', of: (line: ExportLine) => day(line.changedOn) },
    ];
  }

  return [
    ...opening,
    { label: 'Current Net CPA', of: (line: ExportLine) => money(line.current) },
    { label: 'Potential Revenue', of: (line: ExportLine) => money(line.revenue) },
    { label: 'Previous Net CPA', of: (line: ExportLine) => money(line.previous) },
    {
      label: 'Percent Change',
      of: (line: ExportLine) => (line.change === null ? '-' : `${(line.change * 100).toFixed(2)}%`),
    },
    { label: 'Date Change of Current Net CPA', of: (line: ExportLine) => day(line.changedOn) },
  ];
}

/** Quoted the way the QMP export quotes: every field, always. */
function cell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function cpaCsv(groups: CpaGroup[], meta: CpaExportMeta): string {
  const columns = csvColumns(meta.gross);
  const lines: string[] = [];

  /*
   * The same title block the QMP export carries, so the day the rates were read
   * survives a round trip through this app: the upload reads "Day of" back off
   * the file. The other three lines are ours and are ignored on the way in.
   */
  lines.push([cell('Report Name'), cell('Commission per approvals')].join(','));
  lines.push([cell('Day of'), cell(meta.reportDate || '-')].join(','));
  lines.push([cell('Filter'), cell(scopeNote(meta))].join(','));
  lines.push([cell('Exported'), cell(exportedLine(meta))].join(','));
  lines.push([cell('Cards'), cell(describeScope(groups, meta))].join(','));
  lines.push('');

  lines.push(columns.map((column) => cell(column.label)).join(','));
  for (const line of exportLines(groups, meta.sort)) {
    lines.push(columns.map((column) => cell(column.of(line))).join(','));
  }

  // The BOM Excel wants before it will read a CSV as UTF-8, and the line ending
  // every other tool on Windows expects.
  return `﻿${lines.join('\r\n')}\r\n`;
}

function exportedLine(meta: CpaExportMeta): string {
  const day = formatDay(meta.exportedOn.slice(0, 10));
  return meta.exportedBy ? `${day} by ${meta.exportedBy}` : day;
}

/* -------------------------------------------------------------- Excel ---- */

type SheetColumn = {
  label: string;
  width: number;
  /** Right-aligned in the header, because the figures under it are. */
  number: boolean;
  cell: (line: ExportLine) => XlsxCell;
};

function sheetColumns(gross: boolean): SheetColumn[] {
  const money = (value: number | null, band: boolean): XlsxCell =>
    value === null ? { value: '-', style: 'text', band } : { value, style: 'money', band };

  const columns: SheetColumn[] = [
    {
      label: 'Issuer',
      width: 24,
      number: false,
      cell: (line) => ({ value: line.issuer, style: 'text', band: line.band }),
    },
    {
      label: 'Card',
      width: 42,
      number: false,
      // Bold on the card's first line only, so a tiered card still reads as one
      // thing once the tiers are repeating its name underneath it.
      cell: (line) => ({ value: line.card, style: line.first ? 'bold' : 'text', band: line.band }),
    },
    {
      label: 'Tier',
      width: 12,
      number: false,
      cell: (line) => ({ value: line.tier || '-', style: 'indent', band: line.band }),
    },
  ];

  if (gross) {
    columns.push({
      label: 'Pays now',
      width: 14,
      number: true,
      cell: (line) => money(line.current, line.band),
    });
  }

  columns.push({
    label: 'Potential revenue',
    width: 18,
    number: true,
    cell: (line) => money(line.revenue, line.band),
  });

  if (gross) {
    columns.push(
      {
        label: 'Paid before',
        width: 14,
        number: true,
        cell: (line) => money(line.previous, line.band),
      },
      {
        label: 'Change',
        width: 12,
        number: true,
        cell: (line) =>
          line.change === null
            ? { value: '-', style: 'text', band: line.band }
            : { value: line.change, style: 'percent', band: line.band },
      },
    );
  }

  columns.push({
    label: 'Rate changed',
    width: 15,
    number: true,
    cell: (line) => {
      const serial = line.changedOn ? excelDay(line.changedOn) : null;
      return serial === null
        ? { value: '-', style: 'text', band: line.band }
        : { value: serial, style: 'date', band: line.band };
    },
  });

  return columns;
}

export function cpaWorkbook(groups: CpaGroup[], meta: CpaExportMeta): Buffer {
  const columns = sheetColumns(meta.gross);
  const lines = exportLines(groups, meta.sort);
  const last = columnName(columns.length - 1);

  const asAt = meta.reportDate ? `Rates as at ${formatDay(meta.reportDate)}` : 'Rates as uploaded';

  const rows: XlsxCell[][] = [
    [{ value: 'Commission per approvals', style: 'title' }],
    [{ value: `${asAt} · ${describeScope(groups, meta)} · exported ${exportedLine(meta)}`, style: 'note' }],
    [{ value: scopeNote(meta), style: 'note' }],
    columns.map((column) => ({ value: column.label, style: column.number ? 'headNum' : 'headText' })),
    ...lines.map((line) => columns.map((column) => column.cell(line))),
  ];

  return buildWorkbook({
    name: 'Rate card',
    columns: columns.map((column) => column.width),
    rows,
    heights: { 1: 26, 2: 15, 3: 15, 4: 22 },
    // The three lines of heading and the column names stay put. Without this a
    // reader who scrolls to the bottom of a long rate card is looking at eight
    // unlabelled columns of money.
    freeze: 4,
    filter: `A4:${last}${Math.max(rows.length, 4)}`,
    merges: [`A1:${last}1`, `A2:${last}2`, `A3:${last}3`],
  });
}
