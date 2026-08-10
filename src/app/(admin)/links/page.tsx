import { headers } from 'next/headers';
import Link from 'next/link';
import type { Metadata } from 'next';
import { CopyLink } from '@/components/CopyLink';
import { EmptyState } from '@/components/EmptyState';
import { ErrorPanel } from '@/components/ErrorPanel';
import { LinkActions } from '@/components/LinkActions';
import { countsByLink, formatPercent, linkKey } from '@/lib/analytics';
import { configuredBaseUrl } from '@/lib/config';
import { loadAll } from '@/lib/load';
import { originFromHeaders } from '@/lib/request';
import { affiliateUrl, prettyUrl } from '@/lib/url';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Affiliate Links' };

export default async function LinksPage() {
  const { links, submissions, visits, error } = await loadAll();
  const origin = originFromHeaders(await headers(), configuredBaseUrl());

  if (error) {
    return <ErrorPanel title="Could not read your links" message={error} />;
  }

  const counts = countsByLink(links, submissions, visits);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl">Affiliate links</h2>
          <p className="mt-1 text-sm text-ink-2">
            {links.length === 0
              ? 'Nothing here yet.'
              : `${links.length} link${links.length === 1 ? '' : 's'} · ${
                  links.filter((l) => l.active).length
                } active`}
          </p>
        </div>
        <Link href="/links/new" className="btn">
          + New link
        </Link>
      </div>

      {links.length === 0 ? (
        <EmptyState
          title="No affiliate links yet"
          body="Create one by pairing a destination URL with the person it belongs to. You'll get a shareable link like /cashback?usr=arthur."
          ctaHref="/links/new"
          ctaLabel="Create a link"
        />
      ) : (
        <ul className="space-y-0">
          {links.map((link, index) => {
            const stat = counts.get(linkKey(link)) ?? { visits: 0, submissions: 0 };
            const url = affiliateUrl(link, origin);
            return (
              <li
                key={link.id}
                className="rise grid gap-6 border-t border-ink py-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto]"
                style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
              >
                {/* Identity + shareable URL */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-display text-2xl leading-tight">
                      {link.campaign || link.slug}
                    </h3>
                    <span
                      className="tag"
                      style={{ color: link.active ? 'var(--color-ok)' : 'var(--color-muted)' }}
                    >
                      {link.active ? 'Live' : 'Paused'}
                    </span>
                    {link.passUsrParam ? (
                      <span className="tag" style={{ color: 'var(--color-muted)' }}>
                        →{link.passUsrParam}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 max-w-xl">
                    <CopyLink value={url} />
                  </div>

                  <p className="mt-3 text-xs leading-relaxed text-muted">
                    Forwards to{' '}
                    <a
                      href={link.destination}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="font-mono underline decoration-rule underline-offset-2 hover:decoration-signal"
                      title={link.destination}
                    >
                      {prettyUrl(link.destination, 58)}
                    </a>
                  </p>
                  {link.notes ? (
                    <p className="mt-2 max-w-xl text-xs italic leading-relaxed text-muted">
                      {link.notes}
                    </p>
                  ) : null}
                </div>

                {/* Assignee + performance */}
                <div className="grid grid-cols-3 gap-4 self-start lg:border-l lg:border-rule lg:pl-6">
                  <div className="col-span-3">
                    <span className="eyebrow">Assigned to</span>
                    <p className="mt-1 text-sm font-medium">
                      {link.assignee || <span className="text-muted">House link</span>}
                    </p>
                    <p className="font-mono text-[0.6875rem] text-muted">
                      {link.usr ? `usr=${link.usr}` : 'no usr param'}
                    </p>
                    {link.assigneeEmail ? (
                      <p className="font-mono text-[0.6875rem] text-muted">{link.assigneeEmail}</p>
                    ) : null}
                  </div>
                  <Metric label="Visits" value={stat.visits} />
                  <Metric label="Leads" value={stat.submissions} accent />
                  <Metric
                    label="Conv."
                    value={stat.visits > 0 ? formatPercent(stat.submissions / stat.visits, 0) : '—'}
                  />
                </div>

                {/* Actions */}
                <div className="flex flex-col items-start gap-2 self-start lg:items-end">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost !px-3 !py-1.5 !text-[0.625rem]"
                  >
                    Preview ↗
                  </a>
                  <LinkActions id={link.id} active={link.active} label={link.campaign || link.slug} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div>
      <span className="eyebrow">{label}</span>
      <p
        className="tnum mt-0.5 font-display text-2xl leading-none"
        style={{ color: accent ? 'var(--color-signal)' : undefined }}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
