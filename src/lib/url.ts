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
 * params (e.g. ?src=714025&var2=1412) are always preserved.
 *
 * `lead` adds the reference for one particular person, normally as var3. It is
 * only ever passed when a form was actually filled in and the row saved: a
 * reference in the URL that matches no row would be worse than none at all,
 * because it looks like an answer.
 */
export function destinationUrl(
  link: AffiliateLink,
  usr: string,
  lead?: { param: string; id: string },
): string {
  const withUsr = Boolean(link.passUsrParam && usr);
  const withLead = Boolean(lead?.param && lead?.id);
  if (!withUsr && !withLead) return link.destination;

  try {
    const url = new URL(link.destination);
    if (withUsr) url.searchParams.set(link.passUsrParam, usr);
    // set(), not append(): if the destination already carries the parameter,
    // the live reference replaces it rather than arriving as a second copy the
    // merchant would be free to read either way round.
    if (withLead) url.searchParams.set(lead!.param, lead!.id);
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
