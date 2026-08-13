import type { EarningsDay } from '@/lib/analytics';

/**
 * Thirty days of clicks with approvals overlaid. Visits are the stems; an
 * approval sits on top as a mustard dot, so a day that earned is visible even
 * when it is one approval against two hundred clicks — scaling them on a shared
 * axis would render every approval invisible.
 */
export function EarningsChart({ series }: { series: EarningsDay[] }) {
  const peak = Math.max(1, ...series.map((d) => d.visits));
  const first = series[0];
  const mid = series[Math.floor(series.length / 2)];

  return (
    <figure className="relative m-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-xl">Last 30 days</h2>
        <span className="flex gap-4 text-[11.5px] text-sage">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-moss" />
            Visits
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-mustard" />
            Approved
          </span>
        </span>
      </div>

      {/* Decorative; the numbers below carry the same data. */}
      <div
        aria-hidden
        className="mt-5 flex h-[184px] items-end gap-px border-b border-pine-700 sm:gap-[6px]"
      >
        {series.map((day, index) => (
          <div
            key={day.date}
            className="flex h-full flex-1 flex-col items-center justify-end"
            title={`${day.label} — ${day.visits} visit${day.visits === 1 ? '' : 's'}, ${
              day.approved
            } approved`}
          >
            {day.approved > 0 ? (
              <span className="mb-1 h-[7px] w-[7px] flex-none rounded-full bg-mustard" />
            ) : null}
            <span
              className="grow-bar w-[2px] rounded-full bg-moss sm:w-[3px]"
              style={{
                height: `${(day.visits / peak) * 100}%`,
                animationDelay: `${index * 14}ms`,
              }}
            />
          </div>
        ))}
      </div>

      {/* Wrapped in a div rather than putting sr-only on the table itself: auto
          table layout treats width:1px as a MINIMUM, so a bare sr-only table
          still lays out at its content width and widens the document. */}
      <div className="sr-only left-0">
        <table>
          <caption>Visits and approvals per day over the last 30 days</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Visits</th>
              <th scope="col">Approved</th>
            </tr>
          </thead>
          <tbody>
            {series.map((day) => (
              <tr key={day.date}>
                <th scope="row">{day.label}</th>
                <td>{day.visits}</td>
                <td>{day.approved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <figcaption className="mt-2.5 flex justify-between text-[11.5px] text-sage-dim">
        <span>{first?.label}</span>
        <span>{mid?.label}</span>
        <span>Today</span>
      </figcaption>
    </figure>
  );
}
