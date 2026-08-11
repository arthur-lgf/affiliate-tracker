import type { DayBucket } from '@/lib/analytics';

const RECENT_DAYS = 8;

/**
 * Thirty days of leads as a dot-and-stem plot. The most recent eight days are
 * mustard so the current stretch separates from the run-up without needing a
 * second axis. A day with no leads still shows its dot on the baseline, so gaps
 * read as "nothing came in" rather than "no data".
 */
export function LeadsChart({ series }: { series: DayBucket[] }) {
  const peak = Math.max(1, ...series.map((d) => d.submissions));
  const cutoff = series.length - RECENT_DAYS;

  const first = series[0];
  const last = series[series.length - 1];
  const mid = series[Math.floor(series.length / 2)];

  return (
    <figure className="relative m-0">
      {/* wraps rather than overflowing: 30 columns plus a legend does not fit
          on a phone in one row */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-xl">Thirty days of leads</h2>
        <span className="flex gap-4 text-[11.5px] text-sage">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-moss" />
            Earlier
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-mustard" />
            Last 8 days
          </span>
        </span>
      </div>

      {/* The marks are decorative; the numbers below carry the same data for
          anyone not reading the picture. */}
      <div
        aria-hidden
        className="mt-5 flex h-[184px] items-end gap-px border-b border-pine-700 sm:gap-[6px]"
      >
        {series.map((day, index) => {
          const recent = index >= cutoff;
          const heightPct = (day.submissions / peak) * 100;
          return (
            <div
              key={day.date}
              className="flex h-full flex-1 flex-col items-center justify-end"
              title={`${day.label} — ${day.submissions} lead${day.submissions === 1 ? '' : 's'}, ${
                day.visits
              } visit${day.visits === 1 ? '' : 's'}`}
            >
              <span
                className="h-[5px] w-[5px] flex-none rounded-full sm:h-[7px] sm:w-[7px]"
                style={{ background: recent ? 'var(--color-mustard)' : 'var(--color-moss)' }}
              />
              <span
                className="grow-bar w-[2px]"
                style={{
                  height: `${heightPct}%`,
                  background: recent ? 'var(--color-mustard)' : 'var(--color-moss)',
                  animationDelay: `${index * 14}ms`,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Wrapped in a div rather than putting sr-only on the table itself:
          auto table layout treats width:1px as a MINIMUM, so a bare
          `<table class="sr-only">` still lays out at its content width and
          widens the document. The div clips it properly. */}
      <div className="sr-only left-0">
      <table>
        <caption>Leads captured per day over the last 30 days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Leads</th>
            <th scope="col">Visits</th>
          </tr>
        </thead>
        <tbody>
          {series.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.label}</th>
              <td>{day.submissions}</td>
              <td>{day.visits}</td>
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
