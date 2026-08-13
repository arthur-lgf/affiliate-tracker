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
    <div className="rounded-[20px] border-2 border-dashed border-edge-strong bg-panel px-6 py-16 text-center">
      {/* A heading, not a paragraph: it is the visual heading of the block, and
          on a fresh install it is the only one on the page. */}
      <h2 className="font-display text-[34px] leading-tight">{title}</h2>
      <p className="mx-auto mt-4 max-w-[560px] text-[20px] leading-relaxed text-ink-soft">{body}</p>
      {ctaHref && ctaLabel ? (
        <Link href={ctaHref} className="btn-primary mt-8">
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
