import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LeadForm } from '@/components/LeadForm';
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
        // "· Affiliate Ledger" title template.
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
      <Shell>
        <Notice
          title="This page is temporarily unavailable"
          body="We couldn't reach our records just now. Please try again in a moment."
        />
      </Shell>
    );
  }

  if (resolved.status === 'missing') notFound();

  if (resolved.status === 'paused') {
    return (
      <Shell>
        <Notice
          title="This offer is paused"
          body="The link you followed is no longer accepting sign-ups. Please check back later or contact the person who shared it with you."
        />
      </Shell>
    );
  }

  const { link, assigned } = resolved;
  const headline = link.headline || link.campaign;
  const subheadline =
    link.subheadline ||
    'Add your details below and we’ll take you straight through to the offer.';
  const ctaLabel = link.ctaLabel || 'Continue to the offer';

  return (
    <main className="min-h-screen lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Editorial side */}
      <section className="panel-ink relative flex flex-col justify-between overflow-hidden px-6 py-12 sm:px-12 lg:min-h-screen lg:py-16">
        {/* Oversized ghost numeral for depth */}
        <span
          aria-hidden
          className="pointer-events-none absolute -right-10 bottom-[-6rem] select-none font-display text-[22rem] leading-none opacity-[0.06]"
        >
          ✳
        </span>

        <div className="relative">
          <span className="eyebrow" style={{ color: 'var(--color-paper-3)' }}>
            {/* Don't echo the campaign when the headline already is the campaign. */}
            {headline === link.campaign ? 'Exclusive offer' : link.campaign}
          </span>
          <h1 className="rise mt-5 max-w-[16ch] font-display text-[3rem] leading-[0.98] sm:text-[4.25rem]">
            {headline}
          </h1>
          <p
            className="rise mt-6 max-w-md text-base leading-relaxed"
            style={{ animationDelay: '120ms', color: 'var(--color-paper-3)' }}
          >
            {subheadline}
          </p>
        </div>

        <ul className="relative mt-12 space-y-3 lg:mt-0">
          {[
            'Takes under 30 seconds',
            'You go straight to the offer after',
            'No spam — your details stay with us',
          ].map((item, index) => (
            <li
              key={item}
              className="rise flex items-baseline gap-3 border-t pt-3 text-sm"
              style={{
                animationDelay: `${200 + index * 80}ms`,
                borderColor: 'rgba(244,240,230,0.18)',
                color: 'var(--color-paper-3)',
              }}
            >
              <span className="font-mono text-[0.625rem]" style={{ color: 'var(--color-signal-3)' }}>
                {String(index + 1).padStart(2, '0')}
              </span>
              {item}
            </li>
          ))}
        </ul>

        {assigned && link.assignee ? (
          <p
            className="relative mt-10 font-mono text-[0.6875rem] uppercase tracking-[0.16em]"
            style={{ color: 'var(--color-paper-3)' }}
          >
            Prepared for you by {link.assignee}
          </p>
        ) : null}
      </section>

      {/* Form side */}
      <section className="flex items-center justify-center px-6 py-14 sm:px-12">
        <div className="w-full max-w-md">
          <div className="mb-8 border-b-[3px] border-ink pb-4">
            <span className="eyebrow">Your details</span>
            <h2 className="mt-1 font-display text-3xl leading-tight">Where should we send it?</h2>
          </div>

          <LeadForm
            slug={link.slug}
            usr={usr}
            requirePhone={link.requirePhone}
            ctaLabel={ctaLabel}
          />
        </div>
      </section>
    </main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-20">
      <div className="w-full max-w-lg text-center">{children}</div>
    </main>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <>
      <div className="mx-auto mb-8 h-px w-16 bg-signal" />
      <h1 className="font-display text-4xl leading-tight">{title}</h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-2">{body}</p>
    </>
  );
}
