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
    <div className="border border-dashed border-rule px-6 py-14 text-center">
      <p className="font-display text-2xl">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">{body}</p>
      {ctaHref && ctaLabel ? (
        <Link href={ctaHref} className="btn mt-6">
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
