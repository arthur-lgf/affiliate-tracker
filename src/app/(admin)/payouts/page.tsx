import type { Metadata } from 'next';
import { ErrorPanel } from '@/components/ErrorPanel';
import { PayoutSchedule, type PayoutRow } from '@/components/PayoutSchedule';
import { asAffiliateShare, loadAll } from '@/lib/load';
import { listOnboarding } from '@/lib/onboarding-store';
import {
  anchorFor,
  bandOf,
  BAND_ORDER,
  hasAnchor,
  linesIn,
  PAYOUT_DAYS,
  periodsThrough,
  totalOf,
} from '@/lib/payout';
import { indexPayouts, listPayouts, payoutKey, payoutsEnabled } from '@/lib/payout-store';
import { requireAdmin } from '@/lib/viewer';
import type { Conversion } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Payouts' };

/**
 * When everybody gets paid, and what has been paid already.
 *
 * The schedule is not stored anywhere. Each person is paid 45 days from the day
 * they signed, so the windows are arithmetic on a date the database already
 * holds, and this page works them out on every render. That is what makes it
 * impossible for the schedule and the contract to disagree: there is one date,
 * and one sum done on it.
 *
 * What is fetched is the three things that cannot be derived — who exists and
 * when they signed, what has been approved, and which payments have been
 * recorded — and each is read once for everybody rather than once per row.
 */
export default async function PayoutsPage() {
  const viewer = await requireAdmin();
  const today = new Date().toISOString().slice(0, 10);

  if (!payoutsEnabled()) {
    return (
      <ErrorPanel
        title="Payouts need a database"
        message={
          'The payout schedule is worked out from the day each affiliate signed, and payments are recorded in Supabase. ' +
          'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then reload this page.'
        }
      />
    );
  }

  const { conversions, settings, error } = await loadAll(viewer);

  /*
   * An admin reads gross payouts everywhere else in the app. A payout is the
   * other number: what this person is owed, at the rate in force on the day
   * each approval landed. Converted once, here, so no figure on the page can
   * be the merchant's money wearing somebody's name.
   */
  const owedRows = asAffiliateShare(conversions, settings);
  const byUsr = new Map<string, Conversion[]>();
  for (const row of owedRows) {
    if (!row.usr) continue;
    const list = byUsr.get(row.usr);
    if (list) list.push(row);
    else byUsr.set(row.usr, [row]);
  }

  let people: Awaited<ReturnType<typeof listOnboarding>> = [];
  let payments = new Map<string, Awaited<ReturnType<typeof listPayouts>>[number]>();
  let readError: string | null = null;
  try {
    const [roster, recorded] = await Promise.all([listOnboarding(), listPayouts()]);
    people = roster;
    payments = indexPayouts(recorded);
  } catch (caught) {
    readError = caught instanceof Error ? caught.message : 'Could not read the payout schedule.';
  }

  const rows: PayoutRow[] = [];
  /** Accounts with no clock running. Named rather than silently missing: an
   *  affiliate who is not on this page is a question, not an absence. */
  const unscheduled: string[] = [];

  for (const person of people) {
    const anchor = anchorFor({
      agreementSignedAt: person.agreementSignedAt,
      bypassedAt: person.bypass.at,
      createdAt: person.createdAt,
    });
    const name = person.fullName || person.username;

    if (!hasAnchor(anchor)) {
      unscheduled.push(name);
      continue;
    }

    const earned = byUsr.get(person.usr) ?? [];
    const periods = periodsThrough(anchor.day, today);
    const current = periods[0]?.index ?? 0;

    for (const period of periods) {
      const lines = linesIn(period, earned);
      const amount = totalOf(lines);
      const record = payments.get(payoutKey(person.userId, period.from)) ?? null;

      /*
       * A closed cycle that earned nothing and was never paid is not a payment
       * anybody has to make, and a page listing one row per empty cycle buries
       * the rows that matter. The cycle running today always shows, because
       * "when is this person next paid" is the question being asked.
       */
      if (amount === 0 && !record && period.index !== current) continue;

      rows.push({
        userId: person.userId,
        name,
        usr: person.usr,
        anchorDay: anchor.day,
        anchorSource: anchor.source,
        period,
        approvals: lines.length,
        amount,
        band: bandOf(period, today, record?.paidAt ?? null),
        paidAt: record?.paidAt ?? null,
        paidAmount: record?.amount ?? null,
        paidBy: record?.paidBy ?? '',
        reference: record?.reference ?? '',
        note: record?.note ?? '',
        proof: record?.proof ? { name: record.proof.name, at: record.proof.at } : null,
        confirmedAt: record?.confirmedAt ?? null,
      });
    }
  }

  /*
   * Soonest payday first inside each band, which is what "arranged by upcoming
   * payments" comes to once the bands have separated the urgent from the merely
   * scheduled. Paid rows read the other way round: the last thing you did is
   * the thing you want to see.
   */
  rows.sort((a, b) => {
    const byBand = BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band);
    if (byBand !== 0) return byBand;
    if (a.band === 'paid') return (b.paidAt ?? '').localeCompare(a.paidAt ?? '');
    if (a.period.to !== b.period.to) return a.period.to.localeCompare(b.period.to);
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="w-full">
      <div className="rise">
        <h1 className="font-display text-[26px] leading-[1.05]">Payouts</h1>
        <p className="plain mt-3">
          Everybody is paid {PAYOUT_DAYS} days from the day they signed, so nobody shares a payday.
          Sign on 15 August and the first one falls on 29 September. An account an admin waved
          through is counted from the day it joined instead.
        </p>
      </div>

      {error ? (
        <div className="mt-5">
          <ErrorPanel title="Could not read the approvals" message={error} />
        </div>
      ) : null}
      {readError ? (
        <div className="mt-5">
          <ErrorPanel title="Could not read the schedule" message={readError} />
        </div>
      ) : null}

      <PayoutSchedule rows={rows} today={today} />

      {unscheduled.length > 0 ? (
        <p className="plain-note mt-5">
          <strong className="font-semibold text-ink">
            {unscheduled.length === 1
              ? 'One account has no schedule yet.'
              : `${unscheduled.length} accounts have no schedule yet.`}
          </strong>{' '}
          {unscheduled.join(', ')}. A payout clock starts when somebody signs the agreement, or when
          an admin waives it for them.
        </p>
      ) : null}
    </div>
  );
}
