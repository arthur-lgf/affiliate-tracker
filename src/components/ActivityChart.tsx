import type { DayBucket } from '@/lib/analytics';

/**
 * Fourteen-day column chart. Visits are the hollow column, submissions the
 * solid one drawn inside it — so the gap between them *is* the conversion gap.
 */
export function ActivityChart({ series }: { series: DayBucket[] }) {
  const peak = Math.max(1, ...series.map((d) => Math.max(d.visits, d.submissions)));
  const hasVisits = series.some((d) => d.visits > 0);
  const hasAny = series.some((d) => d.visits > 0 || d.submissions > 0);

  return (
    <figure className="relative m-0">
      {!hasAny ? (
        <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted">
          No activity in the last 14 days yet.
        </p>
      ) : null}
      <div className="flex items-end gap-[3px] sm:gap-[6px]" style={{ height: 148 }}>
        {series.map((day, index) => {
          const visitH = Math.round((day.visits / peak) * 100);
          const subH = Math.round((day.submissions / peak) * 100);
          return (
            <div
              key={day.date}
              className="group relative flex h-full flex-1 items-end"
              title={`${day.label} — ${day.submissions} submission${
                day.submissions === 1 ? '' : 's'
              }, ${day.visits} visit${day.visits === 1 ? '' : 's'}`}
            >
              {/* Visits: hollow column */}
              <div
                className="absolute bottom-0 w-full border border-b-0 border-rule transition-colors group-hover:border-ink"
                style={{ height: `${Math.max(visitH, day.visits > 0 ? 2 : 0)}%` }}
              />
              {/* Submissions: solid column */}
              <div
                className="rise relative w-full transition-colors group-hover:bg-signal"
                style={{
                  height: `${Math.max(subH, day.submissions > 0 ? 2 : 0)}%`,
                  background: 'var(--color-ink)',
                  animationDelay: `${index * 28}ms`,
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-[-1px] border-t border-ink" />

      <figcaption className="mt-2 flex items-center justify-between">
        <span className="font-mono text-[0.625rem] tracking-[0.1em] text-muted">
          {series[0]?.label}
        </span>
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted">
            <span aria-hidden className="inline-block h-2.5 w-2.5 bg-ink" />
            Submissions
          </span>
          {hasVisits ? (
            <span className="flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted">
              <span aria-hidden className="inline-block h-2.5 w-2.5 border border-rule" />
              Visits
            </span>
          ) : null}
        </span>
        <span className="font-mono text-[0.625rem] tracking-[0.1em] text-muted">
          {series[series.length - 1]?.label}
        </span>
      </figcaption>
    </figure>
  );
}
