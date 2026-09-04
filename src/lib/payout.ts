/**
 * When somebody gets paid, and for what.
 *
 * The clock starts on the day they signed the agreement and runs in 45-day
 * cycles from there. Sign on 15 August and the first payday is 29 September;
 * the next is 13 November. Nobody shares a calendar: two people who signed a
 * week apart are paid a week apart, for as long as they are here.
 *
 * Everything in this file is arithmetic on day keys. No rows, no store, no
 * React, so the schedule can be checked without a database and a payslip drawn
 * for a date that has not happened yet.
 *
 * The window is half open: [from, to). Payday is the first day of the next
 * cycle, so an approval can never land in two payslips or in none. It reads as
 * "15 Aug to 29 Sep" because that is the span somebody is waiting through.
 */

import { PAYMENT_DAYS } from './agreement';

/** The cycle, in days. Net 45 in the agreement, and the same 45 here. */
export const PAYOUT_DAYS = PAYMENT_DAYS;

const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ days --- */

/** The UTC day a timestamp falls on, as a key. '' for anything unreadable. */
export function dayOf(value: string | null | undefined): string {
  if (!value) return '';
  const text = String(value);
  /*
   * A day key, or a timestamp that opens with one, is taken as it stands.
   * Parsing "2026-08-15" and re-formatting it can move it a day in either
   * direction depending on where the server is, and a payday that moves with
   * the server's timezone is a payday nobody can check.
   */
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  // Postgres writes "2026-08-24 20:12:01.308994+00", which is not an ISO
  // string. Normalised rather than handed to the engine and hoped for.
  const parsed = Date.parse(text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toISOString().slice(0, 10);
}

function stamp(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** `day` moved on by `days`, as a day key. */
export function addDays(day: string, days: number): string {
  const at = stamp(day);
  if (!Number.isFinite(at)) return day;
  return new Date(at + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. Negative when `to` is the earlier one. */
export function daysBetween(from: string, to: string): number {
  const a = stamp(from);
  const b = stamp(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

/**
 * A key that means the day it says.
 *
 * The shape is not enough. V8 reads "2026-02-30" as 2 March rather than
 * refusing it, so a typed date that does not exist would quietly become a
 * different one, and a payslip would cover a window nobody chose. Printing it
 * back and comparing is the only way to catch that.
 */
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = stamp(value);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}

/* ----------------------------------------------------------------- anchor --- */

/**
 * Where a person's clock starts, and why.
 *
 * `agreement` is the day they signed, which is the answer whenever there is
 * one. `joined` is for an account an admin waved through: there is no signature
 * to date a schedule from, so the day the account was opened stands in. Both
 * are named on the page, because "45 days from what, exactly" is the first
 * question anybody asks about a date they did not pick.
 *
 * `none` is not an error. It is somebody who has neither signed nor been waived
 * through, and the honest thing to say about them is that no clock is running.
 */
export type AnchorSource = 'agreement' | 'joined' | 'none';

export type Anchor = { day: string; source: AnchorSource };

export const NO_ANCHOR: Anchor = { day: '', source: 'none' };

export function anchorFor(input: {
  agreementSignedAt?: string | null;
  bypassedAt?: string | null;
  createdAt?: string | null;
}): Anchor {
  const signed = dayOf(input.agreementSignedAt);
  if (signed) return { day: signed, source: 'agreement' };

  /*
   * Waived through. There is no signature to date anything from, so the day the
   * account was opened is the day the arrangement began. A waiver with no
   * opening date behind it falls back to the day of the waiver, which is the
   * next best evidence of when somebody started.
   */
  if (input.bypassedAt) {
    const joined = dayOf(input.createdAt) || dayOf(input.bypassedAt);
    if (joined) return { day: joined, source: 'joined' };
  }

  return { ...NO_ANCHOR };
}

export function hasAnchor(anchor: Anchor): boolean {
  return anchor.source !== 'none' && isDay(anchor.day);
}

/** What the page calls the day the schedule is counted from. */
export function anchorLabel(source: AnchorSource): string {
  if (source === 'agreement') return 'Signed';
  if (source === 'joined') return 'Joined';
  return 'Not started';
}

/* ---------------------------------------------------------------- periods --- */

export type Period = {
  /** 1 for the first cycle after signing. Stable for the life of the account. */
  index: number;
  /** First day covered, inclusive. */
  from: string;
  /** Payday, and the first day of the next cycle. Not covered by this one. */
  to: string;
};

export function periodByIndex(anchorDay: string, index: number): Period {
  const at = Math.max(1, Math.floor(index));
  const from = addDays(anchorDay, (at - 1) * PAYOUT_DAYS);
  return { index: at, from, to: addDays(from, PAYOUT_DAYS) };
}

/** Which cycle a day falls in, or null for a day before the clock started. */
export function periodAt(anchorDay: string, day: string): Period | null {
  if (!isDay(anchorDay) || !isDay(day)) return null;
  const elapsed = daysBetween(anchorDay, day);
  if (elapsed < 0) return null;
  return periodByIndex(anchorDay, Math.floor(elapsed / PAYOUT_DAYS) + 1);
}

/**
 * Every cycle from the one running today back to the first, newest first.
 *
 * A payslip list is read from the top and the top is the one somebody is
 * waiting on. `limit` caps how far back it goes: an account three years old has
 * two dozen of these and nobody scrolls to the bottom of it.
 */
export function periodsThrough(anchorDay: string, today: string, limit = 24): Period[] {
  const current = periodAt(anchorDay, today);
  if (!current) return [];
  const oldest = Math.max(1, current.index - limit + 1);
  const out: Period[] = [];
  for (let index = current.index; index >= oldest; index -= 1) {
    out.push(periodByIndex(anchorDay, index));
  }
  return out;
}

export function coversDay(period: Period, day: string): boolean {
  return day >= period.from && day < period.to;
}

/** How far through the cycle today is, 0 to 1. Clamped at both ends. */
export function progressOf(period: Period, today: string): number {
  const done = daysBetween(period.from, today);
  if (done <= 0) return 0;
  return Math.min(1, done / PAYOUT_DAYS);
}

/** Days until payday. Negative once it has gone past. */
export function daysUntil(period: Period, today: string): number {
  return daysBetween(today, period.to);
}

/* ---------------------------------------------------------------- status --- */

/**
 * Where one cycle stands.
 *
 * `open` is still running and there is nothing to pay yet. `due` is a closed
 * cycle nobody has paid. `paid` is a payment somebody recorded. Overdue is not
 * a fourth state: it is a `due` cycle whose payday has been and gone, worked
 * out from the date rather than stored, so nothing has to run at midnight to
 * keep it true.
 */
export type PayoutStatus = 'open' | 'due' | 'paid';

export function statusOf(period: Period, today: string, paidAt: string | null): PayoutStatus {
  if (paidAt) return 'paid';
  return today < period.to ? 'open' : 'due';
}

export function isOverdue(period: Period, today: string, paidAt: string | null): boolean {
  return statusOf(period, today, paidAt) === 'due' && today > period.to;
}

/**
 * Which band of the schedule a payment belongs in.
 *
 * These are the sections of the admin page rather than a column to sort on: an
 * overdue payment and one due next month are different kinds of thing, and a
 * single list ordered by date makes the reader do the sorting.
 */
export type PayoutBand = 'overdue' | 'due' | 'soon' | 'later' | 'paid';

export const BANDS: { key: PayoutBand; label: string; blurb: string }[] = [
  { key: 'overdue', label: 'Overdue', blurb: 'Payday has passed with nothing recorded.' },
  { key: 'due', label: 'Due today', blurb: 'The cycle has closed. These can be paid now.' },
  { key: 'soon', label: 'Within a week', blurb: 'Closing in the next seven days.' },
  { key: 'later', label: 'Later', blurb: 'Still earning. Nothing to do yet.' },
  { key: 'paid', label: 'Paid', blurb: 'Recorded as paid. Each one wants a receipt against it.' },
];

export function bandOf(period: Period, today: string, paidAt: string | null): PayoutBand {
  if (paidAt) return 'paid';
  if (today >= period.to) return today > period.to ? 'overdue' : 'due';
  return daysUntil(period, today) <= 7 ? 'soon' : 'later';
}

/** Bands in the order the page shows them, most urgent first. */
export const BAND_ORDER: PayoutBand[] = ['overdue', 'due', 'soon', 'later', 'paid'];

/* --------------------------------------------------------------- wording --- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "15 Aug 2026". The same shape as formatDay in lib/analytics, built here so
 *  a payslip does not have to import a module of aggregation to print a date. */
export function shortDay(day: string): string {
  const key = dayOf(day);
  if (!isDay(key)) return day;
  const [year, month, date] = key.split('-');
  return `${Number(date)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/**
 * "15 Aug to 29 Sep 2026", with the year said once when both ends share it.
 *
 * "to" rather than a dash: it is how the span was asked for, it reads aloud,
 * and a dash inside a row of figures is one more thing to mistake for a minus.
 */
export function periodLabel(period: Period): string {
  if (!isDay(period.from) || !isDay(period.to)) return `${period.from} to ${period.to}`;
  const sameYear = period.from.slice(0, 4) === period.to.slice(0, 4);
  const from = sameYear ? shortDay(period.from).replace(/ \d{4}$/, '') : shortDay(period.from);
  return `${from} to ${shortDay(period.to)}`;
}

/** The countdown, in words, to sit beside the date. */
export function describeDue(period: Period, today: string, paidAt: string | null): string {
  if (paidAt) return `Paid ${shortDay(dayOf(paidAt))}`;
  const days = daysUntil(period, today);
  if (days === 0) return 'Due today';
  if (days < 0) {
    const late = Math.abs(days);
    return late === 1 ? '1 day late' : `${late} days late`;
  }
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

/* ----------------------------------------------------------- what is owed --- */

/** Anything with an approval date and an amount: a conversion, or a view of one. */
export type Earned = { approvedOn: string; amount: number };

/** The approvals that belong to one payslip. */
export function linesIn<T extends Earned>(period: Period, rows: T[]): T[] {
  return rows.filter((row) => coversDay(period, dayOf(row.approvedOn)));
}

/** What a cycle came to. Rounded once at the end rather than per row. */
export function totalOf(rows: Earned[]): number {
  return Math.round(rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) * 100) / 100;
}

/**
 * Whether what was paid still matches what the cycle comes to.
 *
 * Worth asking, because the two drift honestly: an approval entered late lands
 * in a cycle that has already been paid. The page says so rather than quietly
 * showing the newer figure, since the older one is what left the bank.
 */
export function settlesUp(computed: number, paid: number | null): boolean {
  if (paid === null) return true;
  return Math.abs(computed - paid) < 0.005;
}
