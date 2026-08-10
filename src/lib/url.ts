import type { AffiliateLink } from './types';

/**
 * The shareable affiliate URL for a link, e.g. https://host/cashback?usr=arthur
 */
export function affiliateUrl(link: Pick<AffiliateLink, 'slug' | 'usr'>, origin: string): string {
  const base = `${origin.replace(/\/+$/, '')}/${link.slug}`;
  return link.usr ? `${base}?usr=${encodeURIComponent(link.usr)}` : base;
}

/**
 * Final destination for a lead. When `passUsrParam` is configured the assignee
 * key is appended so the merchant can attribute the click; the merchant's own
 * params (e.g. ?src=714025) are always preserved.
 */
export function destinationUrl(link: AffiliateLink, usr: string): string {
  if (!link.passUsrParam || !usr) return link.destination;
  try {
    const url = new URL(link.destination);
    url.searchParams.set(link.passUsrParam, usr);
    return url.toString();
  } catch {
    return link.destination;
  }
}

/** Strip the protocol for compact display in tables. */
export function prettyUrl(value: string, max = 52): string {
  const stripped = value.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
}
