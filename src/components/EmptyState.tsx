import Link from 'next/link';

export function EmptyState({
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-pine-700 px-6 py-16 text-center">
      {/* A heading, not a paragraph: it is the visual heading of the block, and
          on a fresh install it is the only one on the page. */}
      <h2 className="font-display text-[28px] leading-tight">{title}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-sage">{body}</p>
      {ctaHref && ctaLabel ? (
        <Link href={ctaHref} className="btn-accent mt-7">
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
