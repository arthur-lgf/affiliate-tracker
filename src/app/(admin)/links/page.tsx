import { headers } from 'next/headers';
import Link from 'next/link';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { ErrorPanel } from '@/components/ErrorPanel';
import { LinksBrowser, type LinkRow } from '@/components/LinksBrowser';
import { countsByLink, linkKey } from '@/lib/analytics';
import { configuredBaseUrl } from '@/lib/config';
import { loadAll } from '@/lib/load';
import { originFromHeaders } from '@/lib/request';
import { affiliateUrl } from '@/lib/url';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Links' };

export default async function LinksPage() {
  const { links, submissions, visits, error } = await loadAll();
  const origin = originFromHeaders(await headers(), configuredBaseUrl());

  if (error) {
    return <ErrorPanel title="Could not read your links" message={error} />;
  }

  const counts = countsByLink(links, submissions, visits);
  const rows: LinkRow[] = links.map((link) => ({
    ...link,
    ...(counts.get(linkKey(link)) ?? { visits: 0, submissions: 0 }),
    url: affiliateUrl(link, origin),
  }));

  const live = links.filter((l) => l.active).length;
  const people = new Set(links.filter((l) => l.usr).map((l) => l.usr)).size;

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[34px] leading-none">Affiliate links</h1>
          <p className="mt-2.5 text-[13px] text-sage">
            {links.length === 0
              ? 'Nothing here yet.'
              : `${links.length} in total · ${live} live, ${links.length - live} paused · assigned across ${people} ${
                  people === 1 ? 'person' : 'people'
                }`}
          </p>
        </div>
        <Link href="/links/new" className="btn-accent !px-5 !py-3 !text-[13px]">
          New link
        </Link>
      </div>

      {links.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No affiliate links yet"
            body="Create one by pairing a destination URL with the person it belongs to. You'll get a shareable link like /cashback?usr=arthur."
            ctaHref="/links/new"
            ctaLabel="Create a link"
          />
        </div>
      ) : (
        <LinksBrowser rows={rows} />
      )}
    </div>
  );
}
