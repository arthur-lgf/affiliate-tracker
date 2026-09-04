/**
 * Payments recorded against a payout cycle.
 *
 * Sits beside lib/onboarding-store.ts rather than inside the Store interface,
 * and for the same reason: these rows say what each person was paid, and a
 * Google Sheet is the wrong place for that. Supabase or nothing.
 *
 * The cycles are not stored. They are 45 days from the day somebody signed, so
 * lib/payout works them out and this only holds what a person did about one:
 * paid it, attached a receipt, confirmed it landed. A cycle nobody has touched
 * has no row here, which is why every read hands back a map rather than a list
 * of periods, and why the pages ask "is there a payment for this window" rather
 * than "give me the windows".
 *
 * The receipt is the reason the column lists below are spelled out. A scan of a
 * bank transfer is a few hundred kilobytes of base64, and the admin page reads
 * every affiliate on every render: selecting * there would drag the lot across
 * the wire to draw a row that says "Receipt attached".
 */

import { StoreConfigError } from './store/errors';
import { getSupabaseClient, isSupabaseConfigured } from './store/supabase';

export function payoutsEnabled(): boolean {
  return isSupabaseConfigured();
}

function requireStore(): void {
  if (!payoutsEnabled()) {
    throw new StoreConfigError(
      'Payouts need a database. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then reload.',
    );
  }
}

type PostgrestErrorish = { code?: string; message?: string; details?: string } | null;

function fail(context: string, error: PostgrestErrorish): never {
  const code = error?.code ?? '';
  const message = error?.message ?? 'unknown error';
  if (code === '42P01' || code === 'PGRST205') {
    throw new StoreConfigError(
      'The payouts table is missing from this Supabase project. Run: npx supabase db push',
    );
  }
  if (code === '42703' || code === 'PGRST204') {
    throw new StoreConfigError(
      'The payouts table is missing columns this version needs. Run: npx supabase db push',
    );
  }
  if (code === '42501') {
    throw new StoreConfigError(
      'Supabase refused the request. SUPABASE_SERVICE_ROLE_KEY must be the service role key, not the publishable one.',
    );
  }
  if (code === '23503') {
    throw new StoreConfigError('That account no longer exists.');
  }
  throw new Error(`${context}: ${message}${code ? ` (${code})` : ''}`);
}

/* ------------------------------------------------------------------ shape --- */

/**
 * A payment as the pages read it. No receipt bytes: whether one is attached is
 * a boolean here, and the file itself is fetched one at a time by readProof.
 */
export type PayoutRecord = {
  userId: string;
  /** The cycle this belongs to, named by its first day. */
  periodStart: string;
  periodEnd: string;
  /**
   * What was sent, or null where a receipt was attached before a payment was
   * recorded. Nullable rather than defaulted to zero, which would read as
   * "we paid them nothing".
   */
  amount: number | null;
  paidAt: string | null;
  paidBy: string;
  reference: string;
  note: string;
  proof: { name: string; type: string; at: string | null; by: string } | null;
  confirmedAt: string | null;
  updatedAt: string;
};

/** Everything except the receipt itself. */
const COLUMNS =
  'user_id, period_start, period_end, amount, paid_at, paid_by, reference, note, ' +
  'proof_name, proof_type, proof_at, proof_by, confirmed_at, updated_at';

function toRecord(raw: unknown): PayoutRecord {
  const row = raw as Record<string, unknown>;
  const name = String(row.proof_name ?? '');
  return {
    userId: String(row.user_id ?? ''),
    periodStart: String(row.period_start ?? '').slice(0, 10),
    periodEnd: String(row.period_end ?? '').slice(0, 10),
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    paidAt: (row.paid_at as string | null) ?? null,
    paidBy: String(row.paid_by ?? ''),
    reference: String(row.reference ?? ''),
    note: String(row.note ?? ''),
    /*
     * A name is what makes a receipt a receipt here. The bytes live in a column
     * this query does not ask for, so "is there one" is the only question a
     * listing can answer, and it is the only one a listing asks.
     */
    proof: name
      ? {
          name,
          type: String(row.proof_type ?? ''),
          at: (row.proof_at as string | null) ?? null,
          by: String(row.proof_by ?? ''),
        }
      : null,
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    updatedAt: String(row.updated_at ?? ''),
  };
}

/** `${userId}|${periodStart}`: how a page finds the payment for one window. */
export function payoutKey(userId: string, periodStart: string): string {
  return `${userId}|${periodStart}`;
}

export function indexPayouts(rows: PayoutRecord[]): Map<string, PayoutRecord> {
  return new Map(rows.map((row) => [payoutKey(row.userId, row.periodStart), row]));
}

/* ------------------------------------------------------------------ reads --- */

/** Every payment on record, for the admin schedule. Without the receipts. */
export async function listPayouts(): Promise<PayoutRecord[]> {
  requireStore();
  const { data, error } = await getSupabaseClient()
    .from('payouts')
    .select(COLUMNS)
    .order('period_start', { ascending: false });
  if (error) fail('reading payouts', error);
  return (data ?? []).map(toRecord);
}

/** One person's payments, for their payslip list. */
export async function listPayoutsFor(userId: string): Promise<PayoutRecord[]> {
  requireStore();
  const { data, error } = await getSupabaseClient()
    .from('payouts')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('period_start', { ascending: false });
  if (error) fail('reading payouts', error);
  return (data ?? []).map(toRecord);
}

export async function readPayout(userId: string, periodStart: string): Promise<PayoutRecord | null> {
  requireStore();
  const { data, error } = await getSupabaseClient()
    .from('payouts')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('period_start', periodStart)
    .maybeSingle();
  if (error) fail('reading a payout', error);
  return data ? toRecord(data) : null;
}

/**
 * The receipt itself.
 *
 * The only query in this file that touches the bytes, so that handing somebody
 * a receipt is a deliberate, greppable act rather than a side effect of drawing
 * a table. The same shape as the two `reveal` functions in lib/onboarding-store.
 */
export async function readProof(
  userId: string,
  periodStart: string,
): Promise<{ name: string; type: string; data: string } | null> {
  requireStore();
  const { data, error } = await getSupabaseClient()
    .from('payouts')
    .select('proof_name, proof_type, proof_data')
    .eq('user_id', userId)
    .eq('period_start', periodStart)
    .maybeSingle();
  if (error) fail('reading a receipt', error);
  const row = data as Record<string, unknown> | null;
  const content = String(row?.proof_data ?? '');
  if (!row || !content) return null;
  return {
    name: String(row.proof_name ?? 'receipt'),
    type: String(row.proof_type ?? 'application/octet-stream'),
    data: content,
  };
}

/* ----------------------------------------------------------------- writes --- */

/** What names a cycle. Passed together because a row is meaningless without
 *  both, and because the end is what the check constraint compares against. */
export type PeriodRef = { userId: string; periodStart: string; periodEnd: string };

/**
 * Record a payment against one cycle.
 *
 * An upsert rather than an insert: correcting an amount somebody mistyped is
 * the ordinary case, not an error, and a second row for the same window would
 * give one payday two answers.
 */
export async function recordPayment(
  ref: PeriodRef,
  input: { amount: number; paidOn: string; reference: string; note: string; by: string },
): Promise<void> {
  requireStore();
  const { error } = await getSupabaseClient()
    .from('payouts')
    .upsert(
      {
        user_id: ref.userId,
        period_start: ref.periodStart,
        period_end: ref.periodEnd,
        amount: input.amount,
        /*
         * Midday on the day the money actually left, which is not always today:
         * a transfer sent on Friday gets recorded on Monday. Midday rather than
         * midnight so that reading it back in any timezone lands on the day
         * that was typed.
         */
        paid_at: `${input.paidOn}T12:00:00.000Z`,
        paid_by: input.by,
        reference: input.reference.trim().slice(0, 120),
        note: input.note.trim().slice(0, 500),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,period_start' },
    );
  if (error) fail('recording a payment', error);
}

/**
 * Take a payment back off a cycle.
 *
 * The receipt stays. Somebody undoing a payment recorded against the wrong
 * person has not un-uploaded the file, and deleting it here would mean finding
 * it again to attach it to the right one.
 */
export async function clearPayment(ref: PeriodRef): Promise<void> {
  requireStore();
  const { error } = await getSupabaseClient()
    .from('payouts')
    .update({
      amount: null,
      paid_at: null,
      paid_by: '',
      reference: '',
      // The affiliate's confirmation went with the payment it confirmed.
      confirmed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', ref.userId)
    .eq('period_start', ref.periodStart);
  if (error) fail('clearing a payment', error);
}

/** Attach the receipt. Upserts, so one can be attached before or after the
 *  payment is recorded, and replacing a bad scan is a single action. */
export async function saveProof(
  ref: PeriodRef,
  input: { name: string; type: string; data: string; by: string },
): Promise<void> {
  requireStore();
  const { error } = await getSupabaseClient()
    .from('payouts')
    .upsert(
      {
        user_id: ref.userId,
        period_start: ref.periodStart,
        period_end: ref.periodEnd,
        proof_name: input.name.slice(0, 200),
        proof_type: input.type.slice(0, 100),
        proof_data: input.data,
        proof_at: new Date().toISOString(),
        proof_by: input.by,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,period_start' },
    );
  if (error) fail('saving a receipt', error);
}

export async function removeProof(ref: PeriodRef): Promise<void> {
  requireStore();
  const { error } = await getSupabaseClient()
    .from('payouts')
    .update({
      proof_name: '',
      proof_type: '',
      proof_data: '',
      proof_at: null,
      proof_by: '',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', ref.userId)
    .eq('period_start', ref.periodStart);
  if (error) fail('removing a receipt', error);
}

/**
 * The affiliate says the money arrived.
 *
 * An update rather than an upsert, and that is the guard: there is nothing to
 * confirm until an admin has recorded a payment, so a confirmation cannot
 * conjure the row it belongs to. Returns false when it matched nothing, which
 * the route turns into a plain sentence rather than a silent success.
 */
export async function confirmReceipt(userId: string, periodStart: string): Promise<boolean> {
  requireStore();
  const { data, error } = await getSupabaseClient()
    .from('payouts')
    .update({ confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('period_start', periodStart)
    .not('paid_at', 'is', null)
    .select('user_id');
  if (error) fail('confirming a payment', error);
  return (data ?? []).length > 0;
}
