import type { LeadStatus } from './types';

/**
 * Where a lead is in the funnel.
 *
 * `pending` is stamped automatically the first time someone submits the form —
 * nobody has to set it. The other state is set by hand, either from the
 * dashboard or by editing the Status column in the spreadsheet, and is also
 * read off the approvals: see `displayStatus` below.
 *
 * The stored word is `registered`, which is what every row already written and
 * every cell already typed says. On screen it reads "Approved", which is what
 * the team calls it. Renaming the value as well would mean rewriting history in
 * a database and a spreadsheet to change a caption, so the two meet in exactly
 * one place — `statusLabel` — and nowhere else.
 */
export const LEAD_STATUSES = ['pending', 'registered'] as const;

export const DEFAULT_LEAD_STATUS: LeadStatus = 'pending';

/**
 * Values a human might type into the Status column that plainly mean the lead
 * is through. Matched whole, after trimming and lowercasing — a partial match
 * would read "registration pending" as registered, which is the exact opposite
 * of what it says, and "not approved" as approved.
 *
 * Both vocabularies are here on purpose. The column has been filled in by hand
 * for months with "registered", and the screen now says "Approved", so somebody
 * typing what they read has to land in the same place as somebody typing what
 * they have always typed.
 *
 * Anything unrecognised (including an empty cell, which is what every row
 * written before this column existed has) counts as pending. A lead is only
 * through when someone has said so.
 */
const REGISTERED_SPELLINGS = new Set([
  'registered',
  'approved',
  'approve',
  'approval',
  'aprobado',
  'aprobada',
  'register',
  'registration',
  'registrado',
  'registro',
  'signed up',
  'signed-up',
  'signup',
  'done',
  'complete',
  'completed',
  'yes',
  'y',
  'true',
  '1',
  '✓',
  '✔',
]);

/** Coerce anything — a sheet cell, a legacy JSON row, an API body — to a status. */
export function normalizeLeadStatus(raw: unknown): LeadStatus {
  if (typeof raw !== 'string') return DEFAULT_LEAD_STATUS;
  const value = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return REGISTERED_SPELLINGS.has(value) ? 'registered' : DEFAULT_LEAD_STATUS;
}

export function statusLabel(status: LeadStatus): string {
  return status === 'registered' ? 'Approved' : 'Pending';
}

/**
 * What a lead reads as once the approvals are taken into account.
 *
 * An approval outranks the stored status. The merchant has agreed to pay for
 * this person, which is stronger evidence that they went through than anybody's
 * memory of ticking a box — and a lead left at pending underneath one is not a
 * state somebody chose, it is one nothing got round to updating.
 *
 * Deriving it rather than only writing it is what keeps the two panels honest:
 * the approvals list and the leads list are reading the same fact, so they
 * cannot disagree, no matter who recorded the approval or whether anyone has
 * re-run a sync since. The sync still writes the status through (see the QMP
 * route) so that column N of the spreadsheet says the same thing.
 */
export function displayStatus(stored: LeadStatus, hasApproval: boolean): LeadStatus {
  return hasApproval ? 'registered' : stored;
}
