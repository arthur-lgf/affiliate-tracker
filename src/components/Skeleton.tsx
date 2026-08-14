/**
 * The pieces a loading screen is built from.
 *
 * A skeleton is worth having only if it is the shape of what is coming. A
 * generic spinner in the middle of an empty page tells you to wait; a skeleton
 * in the right shape tells you what you are waiting for, and the content lands
 * without the page jumping. So these are laid out to match the real panels
 * rather than kept vague.
 *
 * The whole tree is `aria-hidden`, with one polite "Loading" for the region.
 * Announcing forty grey rectangles one at a time is worse than silence.
 */

export function SkeletonLine({
  width = '100%',
  height = 20,
  className = '',
}: {
  width?: string | number;
  /** A number is pixels; a string is whatever CSS length you say, e.g. '60%'. */
  height?: string | number;
  className?: string;
}) {
  return <span className={`skeleton ${className}`} style={{ width, height }} />;
}

/** A panel with the same border, radius and padding as a real one. */
export function SkeletonPanel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`panel p-6 sm:p-8 ${className}`}>{children}</div>;
}

/** The page heading and its one-line summary. */
export function SkeletonHeading({ wide = 420 }: { wide?: number }) {
  return (
    <div className="flex flex-col gap-3">
      <SkeletonLine width={wide} height={44} />
      <SkeletonLine width={Math.round(wide * 0.62)} height={22} />
    </div>
  );
}

/** A row of pills, as the period filters render. */
export function SkeletonPills({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-wrap gap-3">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonLine key={index} width={104} height={48} className="rounded-full" />
      ))}
    </div>
  );
}

/** One list row: a disc, two lines of text, and a figure on the right. */
export function SkeletonRow({ disc = true }: { disc?: boolean }) {
  return (
    <div className="card-row flex items-center gap-5 p-5 sm:px-6">
      {disc ? <SkeletonLine width={56} height={56} className="flex-none rounded-full" /> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <SkeletonLine width="45%" height={22} />
        <SkeletonLine width="28%" height={18} />
      </span>
      <SkeletonLine width={110} height={30} className="flex-none" />
    </div>
  );
}

/**
 * The wrapper every loading.tsx returns. One announcement for the region, and
 * everything inside it hidden from the accessibility tree.
 */
export function SkeletonScreen({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="w-full">
      <span role="status" className="sr-only">
        {label}
      </span>
      <div aria-hidden>{children}</div>
    </div>
  );
}
