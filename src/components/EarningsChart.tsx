import type { EarningsWeek } from '@/lib/analytics';

/**
 * Five weeks, two bars each: visits in green, approvals in gold.
 *
 * Every bar carries its own number above it, so the picture is a convenience
 * and never the only way to read a figure. A week with nothing still draws a
 * 6px stub on the baseline — an absent bar reads as missing data, a flat one
 * reads as "nothing came in", and those are different things.
 *
 * Visits and approvals are on the same axis but approvals are almost always
 * the smaller of the two by an order of magnitude, so the stub is what keeps a
 * single approval from rendering as nothing at all.
 */
export function EarningsChart({ series }: { series: EarningsWeek[] }) {
  const peak = Math.max(1, ...series.map((week) => Math.max(week.visits, week.approved)));
  const height = (value: number) => (value === 0 ? 6 : Math.max(14, (value / peak) * 210));

  return (
    <figure className="m-0 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
        <h2 className="font-display text-[26px]">Week by week</h2>
        <span className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[18px] text-ink-soft">
          <span className="flex items-center gap-2.5">
            <span aria-hidden className="h-4 w-4 flex-none rounded bg-leaf-bar" />
            Visits
          </span>
          <span className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="h-4 w-4 flex-none rounded border-2 border-gold-edge bg-gold"
            />
            Approved
          </span>
        </span>
      </div>

      {/* Decorative — the table below carries the same numbers.

          Bars and week labels share one scroller so they can never drift out of
          register, and the bars themselves shrink to fit first: on a phone this
          only scrolls if a three-digit count needs more room than its column. */}
      <div aria-hidden className="mt-6 overflow-x-auto">
        <div className="min-w-[300px]">
          <div className="flex h-[250px] items-end gap-3 border-b-2 border-edge px-1 sm:gap-8 sm:px-2">
            {series.map((week, index) => (
              <div
                key={week.start}
                className="flex h-full min-w-0 flex-1 items-end justify-center gap-1.5 sm:gap-2"
              >
                <Bar
                  value={week.visits}
                  px={height(week.visits)}
                  delay={index * 60}
                  className="bg-leaf-bar"
                />
                <Bar
                  value={week.approved}
                  px={height(week.approved)}
                  delay={index * 60 + 30}
                  className={
                    week.approved > 0
                      ? 'border-2 border-b-0 border-gold-edge bg-gold'
                      : 'bg-gold-faint'
                  }
                />
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-3 px-1 sm:gap-8 sm:px-2">
            {series.map((week) => (
              <div
                key={week.start}
                className={`min-w-0 flex-1 truncate text-center text-[17px] sm:text-[18px] ${
                  week.label === 'This week' ? 'font-bold text-ink' : 'text-ink-soft'
                }`}
              >
                {week.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Wrapped in a div rather than putting sr-only on the table itself: auto
          table layout treats width:1px as a MINIMUM, so a bare sr-only table
          still lays out at its content width and widens the document. */}
      <div className="sr-only left-0">
        <table>
          <caption>Visits and approvals per week over the last five weeks</caption>
          <thead>
            <tr>
              <th scope="col">Week</th>
              <th scope="col">Visits</th>
              <th scope="col">Approved</th>
            </tr>
          </thead>
          <tbody>
            {series.map((week) => (
              <tr key={week.start}>
                <th scope="row">{week.range}</th>
                <td>{week.visits}</td>
                <td>{week.approved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function Bar({
  value,
  px,
  delay,
  className,
}: {
  value: number;
  px: number;
  delay: number;
  className: string;
}) {
  return (
    <span className="flex min-w-0 max-w-[44px] flex-1 flex-col items-center gap-2">
      <span
        className={`tnum text-[17px] sm:text-[18px] ${
          value > 0 ? 'font-bold text-ink' : 'font-semibold text-ink-dim'
        }`}
      >
        {value}
      </span>
      <span
        className={`grow-bar w-full rounded-t ${className}`}
        style={{ height: `${px}px`, animationDelay: `${delay}ms` }}
      />
    </span>
  );
}
