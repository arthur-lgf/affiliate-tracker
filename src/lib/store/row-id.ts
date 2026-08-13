import { createHash } from 'node:crypto';

/**
 * Addressing a row that has no id column.
 *
 * The Conversions tab is meant to be typed into by hand, so it carries no
 * opaque uuid — a row is identified by WHERE it sits plus a fingerprint of WHAT
 * it says.
 *
 * The fingerprint is the part that matters. Between the dashboard rendering a
 * row and someone clicking Remove, a row can be inserted or deleted in the
 * spreadsheet and shift every position below it. Re-checking the content at
 * that position before deleting turns a silent wrong-row deletion — of a money
 * record — into a refusal the caller can show.
 */

/**
 * Joined on a separator no cell can contain, so ["a","b"] and ["ab",""] cannot
 * fingerprint the same.
 *
 * Built from a char code rather than typed as an escape: written either way it
 * is a NUL, but keeping the source pure ASCII means no literal control
 * character can end up embedded in this file. One that did - invisible in
 * every editor - has already cost this project a silent bug.
 */
const CELL_SEPARATOR = String.fromCharCode(0);

export function rowFingerprint(cells: readonly string[]): string {
  return createHash('sha1').update(cells.join(CELL_SEPARATOR)).digest('hex').slice(0, 10);
}

/** `"7:1f3c9a0b2d"` — sheet row 7, holding this exact content. */
export function makeRowId(position: number, cells: readonly string[]): string {
  return `${position}:${rowFingerprint(cells)}`;
}

export function parseRowId(id: string): { position: number; fingerprint: string } | null {
  const match = /^(\d+):([0-9a-f]{10})$/.exec(id);
  if (!match) return null;
  return { position: Number(match[1]), fingerprint: match[2]! };
}
