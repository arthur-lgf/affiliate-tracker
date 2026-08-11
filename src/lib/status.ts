import type { LeadStatus } from './types';

/**
 * Where a lead is in the funnel.
 *
 * `pending` is stamped automatically the first time someone submits the form —
 * nobody has to set it. `registered` is set by hand, either from the dashboard
 * or by editing the Status column in the spreadsheet.
 */
export const LEAD_STATUSES = ['pending', 'registered'] as const;

export const DEFAULT_LEAD_STATUS: LeadStatus = 'pending';

/**
 * Values a human might type into the Status column that plainly mean
 * "registered". Matched whole, after trimming and lowercasing — a partial match
 * would read "registration pending" as registered, which is the exact opposite
 * of what it says.
 *
 * Anything unrecognised (including an empty cell, which is what every row
 * written before this column existed has) counts as pending. A lead is only
 * registered when someone has said so.
 */
const REGISTERED_SPELLINGS = new Set([
  'registered',
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
  return status === 'registered' ? 'Registered' : 'Pending';
}
