import { formatMoney, initialsOf } from '@/lib/analytics';
import { shortDay } from '@/lib/payout';
import {
  describePending,
  PENDING_SECTIONS,
  pendingEmptyText,
  type PendingRow,
  type PendingSplit,
} from '@/lib/payout-admin';
import { BLANK } from '@/lib/report-table';

/**
 * The Pending tab: approved cards nobody has asked to be paid for yet.
 *
 * Nothing on this tab is an admin's to do. A card becomes money somebody is
 * owed when its affiliate asks for it, and that request is what lands on the
 * Requests tab. This is the view of what is coming: which cards could be
 * asked for today, and when each of the rest can be.
 *
 * So it has no buttons, no highlighted figure, and no client code. It is drawn
 * on the server from rows buildPending has already split, priced and ordered,
 * which is also what lets the render checks mount it without a router.
 *
 * Same flex-wrap rows as the Requests tab rather than a table: the columns
 * fold onto a second line on a phone instead of scrolling sideways.
 */
export function PendingApprovals({ ready, countingDown, approved }: PendingSplit) {
  if (ready.length === 0 && countingDown.length === 0) {
    return (
      <p className="panel mt-5 px-5 py-14 text-center text-[13px] text-ink-soft">
        {pendingEmptyText(approved)}
      </p>
    );
  }

  const lists: Record<(typeof PENDING_SECTIONS)[number]['key'], PendingRow[]> = { ready, countingDown };

  return (
    <>
      <p className="plain mt-5">{describePending({ ready, countingDown })}</p>

      {PENDING_SECTIONS.map((meta) => {
        const list = lists[meta.key];
        if (list.length === 0) return null;

        return (
          <section key={meta.key} className="panel mt-5 overflow-hidden">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-edge bg-paper-card px-5 py-3.5">
              <h2 className="text-[14px] font-semibold text-ink">{meta.label}</h2>
              <span className="tnum text-[12px] text-ink-dim">{list.length}</span>
              <p className="w-full text-[12px] text-ink-dim sm:w-auto">{meta.blurb}</p>
            </div>

            <ul>
              {list.map((row) => (
                <PendingItem key={row.id} row={row} ready={meta.key === 'ready'} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function PendingItem({ row, ready }: { row: PendingRow; ready: boolean }) {
  return (
    <li className="border-b border-edge-faint last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
        <span
          aria-hidden
          className="flex h-[30px] w-[30px] flex-none items-center justify-center bg-paper-sunk text-[11px] font-semibold text-ink-dim"
        >
          {initialsOf(row.name)}
        </span>

        <span className="min-w-[150px] flex-1">
          <span className="block text-[13px] font-semibold text-ink">{row.name}</span>
          <span className="tnum block text-[11px] text-ink-dim">{`usr=${row.usr}`}</span>
        </span>

        <span className="min-w-[170px] flex-1">
          <span className="block text-[13px] text-ink">{row.card}</span>
          <span className="block text-[11px] text-ink-dim">{row.customer}</span>
        </span>

        <span className="w-[130px] flex-none">
          <span className="tnum block text-[13px] text-ink">
            {row.approvedOn ? shortDay(row.approvedOn) : BLANK}
          </span>
          <span className="block text-[11px] text-ink-dim">Approved</span>
        </span>

        <span className="w-[100px] flex-none text-right">
          <span className="tnum block text-[15px] font-semibold text-ink">{formatMoney(row.amount)}</span>
        </span>

        {/*
          The count and the day together. "12 days left" alone makes somebody
          do date arithmetic to plan around it; the day is what they would put
          in a calendar, and it is still true once the count reaches zero.
        */}
        <span className="w-[150px] flex-none">
          {ready ? (
            <span className="chip chip-gold">Ready</span>
          ) : (
            <span className="tnum block text-[13px] font-semibold text-ink">{row.countdown}</span>
          )}
          <span className="tnum mt-1 block text-[11px] text-ink-dim">{row.readyDay}</span>
        </span>
      </div>
    </li>
  );
}
