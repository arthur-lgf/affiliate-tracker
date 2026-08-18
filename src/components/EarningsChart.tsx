import type { EarningsSeries } from '@/lib/analytics';

/**
 * The context around the selected window, as bars: visits in green, approvals
 * in gold.
 *
 * The buckets, the heading, the span and the caption all arrive together from
 * buildEarningsSeries, because the size of a bar is the thing that says what it
 * means — six bars are one week each on 7 days and one month each on 30 days,
 * and only the series knows which. Nothing about the shape is decided here.
 *
 * The span is printed beside the heading and is not decoration: the chart
 * deliberately reaches back further than the filter, so the bars add up to more
 * than the figure beside them and the reader has to be told how far back they
 * go.
 *
 * Every bar carries its own number above it, so the picture is a convenience
 * and never the only way to read a figure. An empty bucket still draws a 6px
 * stub on the baseline — an absent bar reads as missing data, a flat one reads
 * as "nothing came in", and those are different things.
 *
 * Visits and approvals share an axis, and approvals are almost always the
 * smaller by an order of magnitude, so that stub is also what keeps a single
 * approval from rendering as nothing at all.
 */
export function EarningsChart({ series }: { series: EarningsSeries }) {
  const { buckets } = series;
  const peak = Math.max(1, ...buckets.map((bucket) => Math.max(bucket.visits, bucket.approved)));
  const height = (value: number) => (value === 0 ? 6 : Math.max(14, (value / peak) * 210));

  return (
    <figure className="m-0 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
        <h2 className="font-display text-[26px]">
          {series.title}{' '}
          <span className="whitespace-nowrap text-[19px] font-normal text-ink-soft">
            · {series.span}
          </span>
        </h2>
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

          Bars and labels share one scroller so they can never drift out of
          register, and the bars themselves shrink to fit first: on a phone this
          only scrolls if a three-digit count needs more room than its column. */}
      <div aria-hidden className="mt-6 overflow-x-auto">
        {/* Room for every label, whatever the chart is made of: seven daily
            bars squeezed into a phone gave every column 31px, which clipped
            even the word "Today". Sized by the bar count so the scroller does
            its job instead. On a laptop the panel is wider than this anyway,
            so nothing moves. */}
        <div style={{ minWidth: `${Math.max(300, buckets.length * 76)}px` }}>
          <div className="flex h-[250px] items-end gap-3 border-b-2 border-edge px-1 sm:gap-8 sm:px-2">
            {buckets.map((bucket, index) => (
              <div
                key={bucket.start}
                className="flex h-full min-w-0 flex-1 items-end justify-center gap-1.5 sm:gap-2"
              >
                <Bar
                  value={bucket.visits}
                  px={height(bucket.visits)}
                  delay={index * 60}
                  className="bg-leaf-bar"
                />
                <Bar
                  value={bucket.approved}
                  px={height(bucket.approved)}
                  delay={index * 60 + 30}
                  className={
                    bucket.approved > 0
                      ? 'border-2 border-b-0 border-gold-edge bg-gold'
                      : 'bg-gold-faint'
                  }
                />
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-3 px-1 sm:gap-8 sm:px-2">
            {buckets.map((bucket) => (
              <div
                key={bucket.start}
                /* The bucket the clock is in is bold, whatever it is called and
                   wherever it sits. Matching on the word "This week" only
                   worked while every chart was weeks, and bolding the last bar
                   only works while the chart ends at now. */
                className={`min-w-0 flex-1 truncate text-center text-[17px] sm:text-[18px] ${
                  bucket.current ? 'font-bold text-ink' : 'text-ink-soft'
                }`}
              >
                {bucket.label}
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
          <caption>{series.caption}</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Visits</th>
              <th scope="col">Approved</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.start}>
                <th scope="row">{bucket.range}</th>
                <td>{bucket.visits}</td>
                <td>{bucket.approved}</td>
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
