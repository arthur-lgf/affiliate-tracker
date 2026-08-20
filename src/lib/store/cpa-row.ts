/**
 * One rate as a row of cells, and back.
 *
 * Shared by the Sheets and the JSON adapters so a rate reads the same whichever
 * one is running, exactly as conversion-row.ts does for approvals. The column
 * order lives in SHEET_HEADERS.cpa and this file must follow it.
 *
 * The four stamps at the front repeat on every row. A spreadsheet has nowhere
 * else to put them, and the alternative — a header row of metadata above the
 * data — is what made the source export hard to parse in the first place.
 */

import type { CpaRate, CpaReport } from '../types';

/** A number as a cell, with "" for null so blank stays distinct from zero. */
function numberCell(value: number | null): string {
  return value === null ? '' : String(value);
}

/** Back again: "" is null, and anything unreadable is null rather than zero. */
function cellNumber(raw: string): number | null {
  const text = (raw ?? '').trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function cpaRowToCells(report: CpaReport, rate: CpaRate): string[] {
  return [
    report.reportDate,
    report.updatedAt,
    report.updatedBy,
    report.source,
    rate.placement,
    rate.issuer,
    rate.card,
    rate.tier,
    numberCell(rate.current),
    numberCell(rate.previous),
    numberCell(rate.change),
    rate.changedOn,
  ];
}

export function cpaRateFromCells(cells: string[]): CpaRate {
  const at = (index: number) => (cells[index] ?? '').trim();
  return {
    placement: at(4),
    issuer: at(5),
    card: at(6),
    tier: at(7),
    current: cellNumber(at(8)),
    previous: cellNumber(at(9)),
    change: cellNumber(at(10)),
    changedOn: at(11),
  };
}

/**
 * The stamps, taken from the first row.
 *
 * Every row carries the same four, so the first is as good as any. Reading them
 * per row and disagreeing would mean a half-written sheet, which the replace is
 * written to avoid.
 */
export function cpaReportFromCells(rows: string[][]): CpaReport | null {
  if (rows.length === 0) return null;
  const first = rows[0]!;
  return {
    reportDate: (first[0] ?? '').trim(),
    updatedAt: (first[1] ?? '').trim(),
    updatedBy: (first[2] ?? '').trim(),
    source: (first[3] ?? '').trim(),
    rows: rows.map(cpaRateFromCells),
  };
}
