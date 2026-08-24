/**
 * Keeping an optimistic value honest.
 *
 * Showing the new value before the server has agreed is the easy half. The hard
 * half is putting the opinion down afterwards, and it is the half that gets
 * skipped: an override map that only ever grows turns into a set of values one
 * browser will keep painting over the truth for as long as the tab is open.
 *
 * The failure is quiet and specific. Two admins have the leads table open. One
 * marks a lead registered, the other marks it back to pending. The first tab
 * refreshes, receives "pending" from the server, and goes on showing
 * "Registered" because that is what it clicked. Nothing errors. The number in
 * the corner is simply wrong, for one person, until they reload.
 *
 * Pure and rowless: no React, no fetch. It is here rather than inside the
 * component so the rule can be checked directly, which is the only way anybody
 * would ever notice it breaking.
 */

/**
 * The overrides the server has caught up with, dropped.
 *
 * Returns the same object when there is nothing to drop, so a caller can hand
 * the result straight to setState without causing a render.
 *
 * An override for a row that is no longer in the list is kept, not dropped:
 * filtering the table to "Registered" removes the rows that are pending, and
 * forgetting an in-flight change because its row scrolled out of the current
 * filter would make the pill flip back under a filter change.
 */
export function dropSettled<Row extends { id: string }, T>(
  overrides: Record<string, T>,
  rows: Row[],
  valueOf: (row: Row) => T,
): Record<string, T> {
  const ids = Object.keys(overrides);
  if (ids.length === 0) return overrides;

  const settled = ids.filter((id) => {
    const row = rows.find((candidate) => candidate.id === id);
    return row !== undefined && valueOf(row) === overrides[id];
  });
  if (settled.length === 0) return overrides;

  const next = { ...overrides };
  for (const id of settled) delete next[id];
  return next;
}

/**
 * Whether a reply still speaks for the row it belongs to.
 *
 * Clicks outrun replies. Without this, toggling a lead twice quickly and having
 * the first response land second rolls the pill back to a value nobody asked
 * for, or raises an error about a change that has already been superseded.
 */
export function isCurrent(tickets: Record<string, number>, id: string, ticket: number): boolean {
  return tickets[id] === ticket;
}

/** The next ticket for a row, and the record of it. Mutates, because it is a
 *  ref in the caller and there is exactly one of it per component. */
export function takeTicket(tickets: Record<string, number>, id: string): number {
  const next = (tickets[id] ?? 0) + 1;
  tickets[id] = next;
  return next;
}
