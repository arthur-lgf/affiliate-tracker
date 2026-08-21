import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { LeadForm } from '@/components/LeadForm';
import { initialsOf } from '@/lib/analytics';
import { captureFormEnabled } from '@/lib/config';
import { resolveLink } from '@/lib/store';
import { destinationUrl } from '@/lib/url';
import { logVisit } from '@/lib/visit-log';
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
        body="The link you followed is no longer accepting sign-ups. Please check back later, or contact the person who shared it with you."
      />
    );
  }

  const { link, assigned } = resolved;

  // Pass-through: no interstitial, straight to the merchant.
  //
  // Deliberately outside the try/catch above — redirect() signals by throwing,
  // so a catch around it would swallow the redirect and render the error notice
  // instead of forwarding the visitor.
  if (!captureFormEnabled()) {
    // Only a key that exists in the Links tab is ever appended to the merchant
    // URL — a visitor must not be able to inject an arbitrary value into it.
    const attributionKey = assigned ? usr : link.usr;
    // The raw ?usr= is what gets logged, so an unknown or stale key shows up on
    // the dashboard rather than being quietly folded into the house row.
    await logVisit({ headers: await headers() }, { slug: link.slug, usr });
    redirect(destinationUrl(link, attributionKey));
  }

  const headline = link.headline || link.campaign;
  const subheadline =
    link.subheadline ||
    'Tell us where to send your matches and we’ll take you straight through to the offer.';
  const ctaLabel = link.ctaLabel || 'Continue to the offer';

  // Set the last word of the headline in italic gold — the one flourish on an
  // otherwise plain page. gold-deep, not gold: #F0C24B as type on paper is
  // 1.4:1, which is a decoration rather than a word.
  const words = headline.trim().split(/\s+/);
  // Only accent the last word when there is a rest of the headline to contrast
  // it against — a one-word headline would otherwise be entirely italic gold.
  const accentTail = words.length > 1;
  const lead = accentTail ? words.slice(0, -1).join(' ') : headline;
  const tail = accentTail ? words[words.length - 1]! : '';

  return (
    <main className="min-h-screen bg-paper px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[680px] flex-col sm:min-h-[calc(100vh-7rem)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="flex items-center gap-3 text-[12px] text-ink-soft">
            <span aria-hidden className="h-4 w-4 bg-gold" />
            {link.campaign}
          </span>
          <span className="text-[12px] text-ink-soft">One short step</span>
        </div>

        <div className="rise mt-10">
          <h1 className="font-display text-[26px] leading-[1.05] sm:text-[26px]">
            {lead}
            {accentTail ? (
              <>
                {' '}
                <span className="italic text-gold-deep">{tail}</span>
              </>
            ) : null}
          </h1>
          <p className="mt-5 max-w-[540px] text-[14px] leading-[1.6] text-ink-soft">
            {subheadline}
          </p>
        </div>

        <ul className="rise mt-7 flex flex-wrap gap-3" style={{ animationDelay: '90ms' }}>
          {ASSURANCES.map((item) => (
            <li key={item} className="chip chip-quiet min-h-[48px] font-normal">
              <span
                aria-hidden
                className="flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 border-leaf-live bg-leaf-wash text-[11px] font-bold text-leaf-text"
              >
                ✓
              </span>
              {item}
            </li>
          ))}
        </ul>

        <div className="rise mt-7" style={{ animationDelay: '150ms' }}>
          <LeadForm slug={link.slug} usr={usr} requirePhone={link.requirePhone} ctaLabel={ctaLabel} />
        </div>

        <div className="flex-1" />

        {assigned && link.assignee ? (
          <div className="mt-10 flex items-center gap-4 border-t-2 border-edge pt-6">
            <span aria-hidden className="disc h-12 w-12 text-[12px]">
              {initialsOf(link.assignee)}
            </span>
            <span className="text-[12px] leading-[1.5] text-ink-soft">
              Prepared for you by
              <br />
              <span className="font-semibold text-ink">{link.assignee}</span>
            </span>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-20">
      <div className="w-full max-w-xl text-center">
        <div aria-hidden className="mx-auto mb-8 h-3 w-3 bg-gold" />
        <h1 className="font-display text-[26px] leading-tight">{title}</h1>
        <p className="mt-5 text-[14px] leading-relaxed text-ink-soft">{body}</p>
      </div>
    </main>
  );
}
