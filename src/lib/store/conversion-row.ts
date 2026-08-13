import type { Conversion } from '../types';
import { normalizeKey } from '../validate';

/**
 * The Conversions row shape, in one place so the sheet and the local JSON store
 * cannot drift — they fingerprint rows with this projection, and two encodings
 * of "the same row" would make a delete fail against one store and not the other.
 *
 * Columns: created_at, approved_on, slug, usr, amount, notes.
 *
 * No id (rows are addressed by position + fingerprint, see row-id.ts), no
 * assignee and no card: the link that (slug, usr) points at already carries the
 * person's name and the card, so storing them again only creates two versions
 * of the truth that can disagree.
 */

/**
 * Amounts are typed by hand as often as they are written by us, so "1,250.00",
 * "$1,250" and "1 250" all land on the same number. Anything unparseable reads
 * as 0 rather than NaN — one bad cell must not poison a whole earnings column.
 */
export function amountFromCell(value: string): number {
  const cleaned = (value ?? '').replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Canonical cells for a row, used for writing AND for fingerprinting. */
export function conversionToCells(row: Omit<Conversion, 'id'>): string[] {
  return [
    row.createdAt,
    row.approvedOn,
    row.slug,
    row.usr,
    // Bare so the cell stays a number in the sheet and SUM works.
    String(row.amount),
    row.notes,
  ];
}

/** Parse a row's cells. `id` is supplied by the caller, which knows the position. */
export function conversionFromCells(cells: string[], id: string): Conversion {
  const [createdAt, approvedOn, slug, usr, amount, notes] = cells;
  return {
    id,
    createdAt: createdAt ?? '',
    // Fall back to the row's own creation date so a blank approval date still
    // buckets somewhere sensible instead of dropping out of every period.
    approvedOn: (approvedOn || createdAt || '').slice(0, 10),
    // Normalised on read: a slug typed by hand in the sheet (" CashBack") would
    // otherwise never match the link it belongs to, and the row would report
    // under a card of its own.
    slug: normalizeKey(slug ?? ''),
    usr: normalizeKey(usr ?? ''),
    amount: amountFromCell(amount ?? ''),
    notes: notes ?? '',
  };
}
