import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LeadForm } from '@/components/LeadForm';
import { initialsOf } from '@/lib/analytics';
import { resolveLink } from '@/lib/store';
import { normalizeKey } from '@/lib/validate';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const query = await searchParams;
  // Resolve with the same usr as the page body, or the title can come from a
  // different assignee's row than the one the visitor is actually being shown.
  const usr = normalizeKey(firstValue(query.usr));
  try {
    const resolved = await resolveLink(normalizeKey(slug), usr);
    if (resolved.status === 'ok') {
      return {
        // Absolute: public landing pages must not inherit the admin tool's
        // title template.
        title: { absolute: resolved.link.headline || resolved.link.campaign },
        description: resolved.link.subheadline || undefined,
        // A lead-capture interstitial has no business being indexed.
        robots: { index: false, follow: false },
      };
    }
  } catch {
    // Fall through to the generic title.
  }
  return {
    title: { absolute: 'Offer' },
    description: 'This offer is not currently available.',
    robots: { index: false, follow: false },
  };
}

const ASSURANCES = [
  'Under thirty seconds',
  'Straight to the offer after',
  'Your details stay with us',
];

export default async function LandingPage({ params, searchParams }: PageProps) {
  const { slug: rawSlug } = await params;
  const query = await searchParams;
  const slug = normalizeKey(rawSlug);
  const usr = normalizeKey(firstValue(query.usr));

  let resolved: Awaited<ReturnType<typeof resolveLink>>;
  try {
    resolved = await resolveLink(slug, usr);
  } catch {
    return (
      <Notice
        title="This page is temporarily unavailable"
        body="We couldn't reach our records just now. Please try again in a moment."
      />
    );
  }

  if (resolved.status === 'missing') notFound();

  if (resolved.status === 'paused') {
    return (
      <Notice
        title="This offer is paused"
        body="The link you followed is no longer accepting sign-ups. Please check back later or contact the person who shared it with you."
      />
    );
  }

  const { link, assigned } = resolved;
  const headline = link.headline || link.campaign;
  const subheadline =
    link.subheadline ||
    'Tell us where to send your matches and we’ll take you straight through to the offer.';
  const ctaLabel = link.ctaLabel || 'Continue to the offer';

  // Set the last word of the headline in italic mustard — the one flourish on
  // an otherwise plain page.
  const words = headline.trim().split(/\s+/);
  // Only accent the last word when there is a rest of the headline to contrast
  // it against — a one-word headline would otherwise be entirely italic mustard.
  const accentTail = words.length > 1;
  const lead = accentTail ? words.slice(0, -1).join(' ') : headline;
  const tail = accentTail ? words[words.length - 1]! : '';

  return (
    <main data-surface="cream" className="min-h-screen bg-cream-100 px-5 py-10 text-ink sm:px-8 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[640px] flex-col sm:min-h-[calc(100vh-6rem)]">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2.5 text-[12.5px] text-ink-faint">
            <span aria-hidden className="h-5 w-5 rounded-full bg-mustard" />
            {link.campaign}
          </span>
          <span className="text-xs text-ink-faint">One short step</span>
        </div>

        <div className="rise mt-10">
          <h1 className="font-display text-[38px] leading-[1.06] tracking-[-0.01em] sm:text-[48px]">
            {lead}
            {accentTail ? (
              <>
                {' '}
                <span className="italic" style={{ color: 'var(--color-mustard-deep)' }}>
                  {tail}
                </span>
              </>
            ) : null}
          </h1>
          <p className="mt-4 max-w-[460px] text-[15px] leading-[1.65] text-ink-muted">
            {subheadline}
          </p>
        </div>

        <ul className="rise mt-6 flex flex-wrap gap-2.5" style={{ animationDelay: '90ms' }}>
          {ASSURANCES.map((item) => (
            <li
              key={item}
              className="flex items-center gap-2.5 rounded-full bg-cream-200 px-3.5 py-2.5 text-[12.5px] text-ink-soft"
            >
              <span
                aria-hidden
                className="flex h-4 w-4 items-center justify-center rounded-full bg-moss text-[9px] font-medium text-pine-900"
              >
                ✓
              </span>
              {item}
            </li>
          ))}
        </ul>

        <div className="rise mt-6" style={{ animationDelay: '150ms' }}>
          <LeadForm
            slug={link.slug}
            usr={usr}
            requirePhone={link.requirePhone}
            ctaLabel={ctaLabel}
          />
        </div>

        <div className="flex-1" />

        {assigned && link.assignee ? (
          <div className="mt-8 flex items-center gap-3 border-t border-cream-300 pt-5">
            <span
              aria-hidden
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-pine-900 text-[12px] font-medium"
              style={{ color: 'var(--color-mustard)' }}
            >
              {initialsOf(link.assignee)}
            </span>
            <span className="text-[12.5px] leading-[1.45] text-ink-faint">
              Prepared for you by
              <br />
              <span className="font-medium text-ink">{link.assignee}</span>
            </span>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main data-surface="cream" className="flex min-h-screen items-center justify-center bg-cream-100 px-6 py-20 text-ink">
      <div className="w-full max-w-lg text-center">
        <div aria-hidden className="mx-auto mb-8 h-1.5 w-1.5 rounded-full bg-mustard" />
        <h1 className="font-display text-[38px] leading-tight">{title}</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-muted">{body}</p>
      </div>
    </main>
  );
}
