import type { AffiliateLink, Conversion, Submission, Visit } from './types';

export type DayBucket = { date: string; label: string; submissions: number; visits: number };

export type PerformanceRow = {
  key: string;
  label: string;
  sublabel: string;
  visits: number;
  submissions: number;
  conversion: number;
};

export type Insight = {
  campaign: string;
  slug: string;
  visitShare: number;
  conversion: number;
} | null;

export type DashboardStats = {
  totalSubmissions: number;
  /** Leads someone has marked registered, here or in the sheet. */
  registered: number;
  /** Everything else — the working list. */
  pending: number;
  /** Share of all leads that reached registered. */
  registrationRate: number;
  totalVisits: number;
  conversion: number;
  activeLinks: number;
  totalLinks: number;
  totalPeople: number;
  submissionsToday: number;
  submissionsYesterday: number;
  visitsToday: number;
  submissionsLast7: number;
  submissionsPrev7: number;
  trend7: number | null;
  /** Change vs yesterday, null when yesterday was empty. */
  trendDay: number | null;
  series: DayBucket[];
  byAssignee: PerformanceRow[];
  byCampaign: PerformanceRow[];
  /** The campaign taking a big share of traffic and returning the least. */
  insight: Insight;
};

function dayKey(iso: string): string {
  // ISO timestamps are stored in UTC; bucket on the date portion.
  return iso.slice(0, 10);
}

function daysAgoKey(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Visits are a best-effort beacon, so a blocked beacon can leave submissions >
 * visits. Clamping keeps "142% conversion" off the dashboard.
 */
function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.min(1, numerator / denominator);
}

export function buildStats(
  links: AffiliateLink[],
  submissions: Submission[],
  visits: Visit[],
  days = 30,
): DashboardStats {
  const today = daysAgoKey(0);
  const yesterday = daysAgoKey(1);
  const start7 = daysAgoKey(6);
  const startPrev7 = daysAgoKey(13);

  let submissionsToday = 0;
  let submissionsYesterday = 0;
  let visitsToday = 0;
  let submissionsLast7 = 0;
  let submissionsPrev7 = 0;
  let registered = 0;

  const submissionsByDay = new Map<string, number>();
  const visitsByDay = new Map<string, number>();

  for (const row of submissions) {
    const key = dayKey(row.createdAt);
    submissionsByDay.set(key, (submissionsByDay.get(key) ?? 0) + 1);
    if (row.status === 'registered') registered += 1;
    if (key === today) submissionsToday += 1;
    if (key === yesterday) submissionsYesterday += 1;
    if (key >= start7) submissionsLast7 += 1;
    else if (key >= startPrev7) submissionsPrev7 += 1;
  }

  for (const row of visits) {
    const key = dayKey(row.createdAt);
    visitsByDay.set(key, (visitsByDay.get(key) ?? 0) + 1);
    if (key === today) visitsToday += 1;
  }

  const series: DayBucket[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = daysAgoKey(i);
    const date = new Date(`${key}T00:00:00Z`);
    series.push({
      date: key,
      label: date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
      submissions: submissionsByDay.get(key) ?? 0,
      visits: visitsByDay.get(key) ?? 0,
    });
  }

  // Assignee rollup — keyed on the `usr` value so visits (which only carry usr)
  // line up with submissions.
  // Newest link wins, independent of the order the caller happened to pass in:
  // renaming an assignee on a new link shouldn't leave the dashboard showing the
  // name from their oldest one.
  const newestFirst = [...links].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const assigneeNames = new Map<string, string>();
  for (const link of newestFirst) {
    if (link.usr && !assigneeNames.has(link.usr)) {
      assigneeNames.set(link.usr, link.assignee || link.usr);
    }
  }
  for (const row of submissions) {
    if (row.usr && row.assignee && !assigneeNames.has(row.usr)) {
      assigneeNames.set(row.usr, row.assignee);
    }
  }

  const byAssignee = rollup(
    submissions,
    visits,
    (row) => row.usr || '(house)',
    (key) => ({
      label: key === '(house)' ? 'Unassigned / house' : assigneeNames.get(key) ?? key,
      sublabel: key === '(house)' ? 'no usr param' : `usr=${key}`,
    }),
  );

  const campaignNames = new Map<string, string>();
  for (const link of newestFirst) {
    if (!campaignNames.has(link.slug)) campaignNames.set(link.slug, link.campaign || link.slug);
  }

  const byCampaign = rollup(
    submissions,
    visits,
    (row) => row.slug,
    (key) => ({ label: campaignNames.get(key) ?? key, sublabel: `/${key}` }),
  );

  const people = new Set(links.filter((l) => l.usr).map((l) => l.usr));

  return {
    totalSubmissions: submissions.length,
    registered,
    pending: submissions.length - registered,
    registrationRate: safeRate(registered, submissions.length),
    totalVisits: visits.length,
    conversion: safeRate(submissions.length, visits.length),
    activeLinks: links.filter((l) => l.active).length,
    totalLinks: links.length,
    totalPeople: people.size,
    submissionsToday,
    submissionsYesterday,
    visitsToday,
    submissionsLast7,
    submissionsPrev7,
    trend7:
      submissionsPrev7 === 0
        ? submissionsLast7 > 0
          ? null
          : 0
        : (submissionsLast7 - submissionsPrev7) / submissionsPrev7,
    trendDay:
      submissionsYesterday === 0
        ? null
        : (submissionsToday - submissionsYesterday) / submissionsYesterday,
    series,
    byAssignee,
    byCampaign,
    insight: findInsight(byCampaign, visits.length),
  };
}

/**
 * The campaign worth a second look: it takes a meaningful share of the traffic
 * and converts worse than the rest. Returns null until there is enough traffic
 * for the comparison to mean anything.
 */
function findInsight(byCampaign: PerformanceRow[], totalVisits: number): Insight {
  if (totalVisits < 20 || byCampaign.length < 2) return null;

  const candidates = byCampaign.filter((row) => row.visits >= 10);
  if (candidates.length < 2) return null;

  const worst = [...candidates].sort((a, b) => a.conversion - b.conversion)[0]!;
  const rest = candidates.filter((row) => row.key !== worst.key);
  const restRate = safeRate(
    rest.reduce((sum, row) => sum + row.submissions, 0),
    rest.reduce((sum, row) => sum + row.visits, 0),
  );

  // Only worth surfacing if it is meaningfully behind the others.
  if (worst.conversion >= restRate * 0.6) return null;

  return {
    campaign: worst.label,
    slug: worst.sublabel.replace(/^\//, ''),
    visitShare: safeRate(worst.visits, totalVisits),
    conversion: worst.conversion,
  };
}

function rollup(
  submissions: Submission[],
  visits: Visit[],
  keyOf: (row: { slug: string; usr: string }) => string,
  labelOf: (key: string) => { label: string; sublabel: string },
): PerformanceRow[] {
  const subCounts = new Map<string, number>();
  const visitCounts = new Map<string, number>();

  for (const row of submissions) {
    const key = keyOf(row);
    subCounts.set(key, (subCounts.get(key) ?? 0) + 1);
  }
  for (const row of visits) {
    const key = keyOf(row);
    visitCounts.set(key, (visitCounts.get(key) ?? 0) + 1);
  }

  const keys = new Set([...subCounts.keys(), ...visitCounts.keys()]);
  return [...keys]
    .map((key) => {
      const submissionCount = subCounts.get(key) ?? 0;
      const visitCount = visitCounts.get(key) ?? 0;
      return {
        key,
        ...labelOf(key),
        submissions: submissionCount,
        visits: visitCount,
        conversion: safeRate(submissionCount, visitCount),
      };
    })
    .sort((a, b) => b.submissions - a.submissions || b.visits - a.visits);
}

/**
 * Identity of a link for counting purposes. Exported so callers look rows up
 * with the exact same key the map was built with — constructing this key in two
 * places is how per-link stats silently render as zero.
 */
export function linkKey(row: { slug: string; usr: string }): string {
  return `${row.slug}::${row.usr}`;
}

/** Per-link counts for the links table. */
export function countsByLink(
  links: AffiliateLink[],
  submissions: Submission[],
  visits: Visit[],
): Map<string, { visits: number; submissions: number }> {
  const out = new Map<string, { visits: number; submissions: number }>();
  for (const link of links) {
    out.set(linkKey(link), { visits: 0, submissions: 0 });
  }
  for (const row of visits) {
    const entry = out.get(linkKey(row));
    if (entry) entry.visits += 1;
  }
  for (const row of submissions) {
    const entry = out.get(linkKey(row));
    if (entry) entry.submissions += 1;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Performance: one row per person per card                            */
/* ------------------------------------------------------------------ */

/**
 * Rolling windows, not calendar ones. "Week" is the last 7 days including
 * today, not Monday-to-now — so a figure never collapses to almost nothing just
 * because it happens to be Monday morning. The labels say days for that reason.
 */
export type Period = 'day' | 'week' | 'month' | 'all';

export const PERIODS: { key: Period; label: string; days: number | null }[] = [
  { key: 'day', label: 'Today', days: 1 },
  { key: 'week', label: '7 days', days: 7 },
  { key: 'month', label: '30 days', days: 30 },
  { key: 'all', label: 'All time', days: null },
];

/** Earliest day key included by a period, or '' for all time. */
export function periodStart(period: Period): string {
  const days = PERIODS.find((p) => p.key === period)?.days ?? null;
  if (days === null) return '';
  return daysAgoKey(days - 1);
}

export type EarningsRow = {
  key: string;
  usr: string;
  /** Display name for the assignee, or the house label. */
  person: string;
  /** The card, when grouping by card. Empty when grouping by person. */
  card: string;
  /** How many distinct cards are folded into this row. Person grouping only. */
  cardCount: number;
  visits: number;
  approved: number;
  earnings: number;
  /** Approvals per visit, clamped — approvals can be logged without a tracked click. */
  approvalRate: number;
};

/**
 * Person rows on the dashboard, card rows on a person's own page. Same numbers,
 * one level apart — so the two views can never disagree about a total.
 */
export type GroupBy = 'person' | 'card';

/**
 * One bar group in the chart. Weeks rather than days: thirty daily bars on a
 * traffic level of single figures is thirty hairlines and one spike, which
 * carries no information you can read. A week is wide enough to label and to
 * put a number on.
 */
export type EarningsWeek = {
  /** First day in the bucket, YYYY-MM-DD. */
  start: string;
  /** Last day in the bucket, inclusive. */
  end: string;
  /** "Jul 16", or "This week" for the bucket ending today. */
  label: string;
  /** "16–22 Jul" — the span spelled out, for the table and the tooltip. */
  range: string;
  visits: number;
  approved: number;
};

export type EarningsView = {
  rows: EarningsRow[];
  totals: { visits: number; approved: number; earnings: number; approvalRate: number };
  /** Everyone who has a link, a visit or an approval — the filter's options. */
  people: { usr: string; name: string }[];
  series: EarningsWeek[];
};

/**
 * Stands in for "no usr" wherever a key is needed — in a URL as well as in a
 * map. The underscore is what makes it collision-proof: normalizeKey turns any
 * non-alphanumeric into a dash, so no real tracking key can ever be `_house`.
 */
export const HOUSE_KEY = '_house';
const HOUSE_LABEL = 'Unassigned / house';

/** The URL for one person's own earnings page. */
export function affiliateHref(usr: string, period?: Period): string {
  const base = `/affiliate/${encodeURIComponent(usr || HOUSE_KEY)}`;
  return period && period !== 'month' ? `${base}?period=${period}` : base;
}

/**
 * usr → display name, newest link wins so a rename shows the current name.
 *
 * Links are the only source: a conversion stores just the tracking key, so a
 * person whose links have all been deleted shows as their bare `usr` rather
 * than a name frozen at the time of the sale. That is the honest reading — the
 * name lives in one place and one place only.
 */
function nameIndex(links: AffiliateLink[]): Map<string, string> {
  const names = new Map<string, string>();
  const newestFirst = [...links].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const link of newestFirst) {
    if (link.usr && link.assignee && !names.has(link.usr)) names.set(link.usr, link.assignee);
  }
  return names;
}

/**
 * slug+usr → card name. Falls back to any link on the same slug, so a click that
 * arrived with an unknown ?usr= (which the landing page serves from the house
 * row) still reports under the campaign it actually saw rather than a bare slug.
 */
function cardIndex(links: AffiliateLink[]): { exact: Map<string, string>; bySlug: Map<string, string> } {
  const exact = new Map<string, string>();
  const bySlug = new Map<string, string>();
  const newestFirst = [...links].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const link of newestFirst) {
    const card = link.campaign || link.slug;
    exact.set(linkKey(link), card);
    if (!bySlug.has(link.slug)) bySlug.set(link.slug, card);
  }
  return { exact, bySlug };
}

type CardIndex = ReturnType<typeof cardIndex>;

/** The card a row belongs to: its own link, else any link on the same slug, else the slug. */
function cardFor(cards: CardIndex, row: { slug: string; usr: string }): string {
  return cards.exact.get(linkKey(row)) ?? cards.bySlug.get(row.slug) ?? row.slug;
}

/** A conversion with the person and card its link supplies, for display. */
export type ConversionView = Conversion & { person: string; card: string };

/**
 * Decorate raw conversions for listing. The name and card are resolved through
 * the links here rather than stored on the row, so a list and the table above it
 * can never label the same sale differently.
 */
export function describeConversions(
  links: AffiliateLink[],
  conversions: Conversion[],
): ConversionView[] {
  const names = nameIndex(links);
  const cards = cardIndex(links);
  return conversions.map((row) => ({
    ...row,
    person: row.usr ? names.get(row.usr) ?? row.usr : 'House',
    card: cardFor(cards, row),
  }));
}

/**
 * Visits, approvals and earnings rolled up per person per card.
 *
 * Visits are bucketed by when the click happened and approvals by their approval
 * date, which is the honest reading of each: an approval that lands three weeks
 * after the click belongs to the week it was approved, since that is when it was
 * earned. It also means a period can show approvals with no visits, so the rate
 * is clamped rather than allowed past 100%.
 */
export function buildEarnings(
  links: AffiliateLink[],
  visits: Visit[],
  conversions: Conversion[],
  {
    period = 'month',
    usr = '',
    groupBy = 'person',
  }: { period?: Period; usr?: string; groupBy?: GroupBy } = {},
): EarningsView {
  const names = nameIndex(links);
  const cards = cardIndex(links);
  const start = periodStart(period);
  const matchesPerson = (rowUsr: string) => !usr || (rowUsr || HOUSE_KEY) === usr;

  const rows = new Map<string, EarningsRow>();
  // Tracked per row rather than derived at the end, so a person's card count is
  // the number of cards that actually had activity in this window.
  const cardsSeen = new Map<string, Set<string>>();

  const rowFor = (rowUsr: string, card: string): EarningsRow => {
    const personKey = rowUsr || HOUSE_KEY;
    const key = groupBy === 'card' ? card : personKey;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        usr: rowUsr,
        person: rowUsr ? names.get(rowUsr) ?? rowUsr : HOUSE_LABEL,
        card: groupBy === 'card' ? card : '',
        cardCount: 0,
        visits: 0,
        approved: 0,
        earnings: 0,
        approvalRate: 0,
      };
      rows.set(key, row);
    }
    const seen = cardsSeen.get(key) ?? new Set<string>();
    seen.add(card);
    cardsSeen.set(key, seen);
    row.cardCount = seen.size;
    return row;
  };

  for (const visit of visits) {
    if (!matchesPerson(visit.usr)) continue;
    const day = dayKey(visit.createdAt);
    if (start && day < start) continue;
    rowFor(visit.usr, cardFor(cards, visit)).visits += 1;
  }

  for (const conversion of conversions) {
    if (!matchesPerson(conversion.usr)) continue;
    const day = conversion.approvedOn.slice(0, 10);
    if (start && day < start) continue;
    // The card comes from the link the sale came through — the row itself only
    // stores (slug, usr). Renaming a campaign therefore renames its historic
    // earnings too, which is the trade for having one name in one place.
    const card = cardFor(cards, conversion);
    const row = rowFor(conversion.usr, card);
    row.approved += 1;
    row.earnings += conversion.amount;
  }

  const list = [...rows.values()];
  for (const row of list) row.approvalRate = safeRate(row.approved, row.visits);
  // Earnings first — the column the table is read for.
  list.sort(
    (a, b) =>
      b.earnings - a.earnings ||
      b.approved - a.approved ||
      b.visits - a.visits ||
      (groupBy === 'card' ? a.card.localeCompare(b.card) : a.person.localeCompare(b.person)),
  );

  const totals = list.reduce(
    (acc, row) => ({
      visits: acc.visits + row.visits,
      approved: acc.approved + row.approved,
      earnings: acc.earnings + row.earnings,
      approvalRate: 0,
    }),
    { visits: 0, approved: 0, earnings: 0, approvalRate: 0 },
  );
  totals.approvalRate = safeRate(totals.approved, totals.visits);

  // Everyone selectable, independent of the period — a filter whose options
  // vanish when you narrow the dates is worse than useless.
  const peopleKeys = new Set<string>();
  for (const link of links) peopleKeys.add(link.usr || HOUSE_KEY);
  for (const visit of visits) peopleKeys.add(visit.usr || HOUSE_KEY);
  for (const row of conversions) peopleKeys.add(row.usr || HOUSE_KEY);
  const people = [...peopleKeys]
    .map((key) => ({
      usr: key,
      name: key === HOUSE_KEY ? HOUSE_LABEL : names.get(key) ?? key,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { rows: list, totals, people, series: buildEarningsWeeks(visits, conversions, usr) };
}

/** "Jul 16" — UTC, to match every other date in the app. */
function shortDay(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Five rolling weeks for the chart, oldest first, the last one ending today.
 *
 * Rolling like the period filters, so the newest bar is always a full seven
 * days rather than collapsing to almost nothing on a Monday. Follows the person
 * filter but not the period — the shape of the last five weeks is the context
 * you read the selected window against, so narrowing to "Today" should not also
 * shrink the chart to a single bar.
 */
export function buildEarningsWeeks(
  visits: Visit[],
  conversions: Conversion[],
  usr = '',
  weeks = 5,
): EarningsWeek[] {
  const matchesPerson = (rowUsr: string) => !usr || (rowUsr || HOUSE_KEY) === usr;
  const visitsByDay = new Map<string, number>();
  const approvedByDay = new Map<string, number>();

  for (const visit of visits) {
    if (!matchesPerson(visit.usr)) continue;
    const key = dayKey(visit.createdAt);
    visitsByDay.set(key, (visitsByDay.get(key) ?? 0) + 1);
  }
  for (const row of conversions) {
    if (!matchesPerson(row.usr)) continue;
    // Approvals are bucketed by their approval date, visits by the click —
    // the same split the tables use, so a bar and a row cannot disagree.
    const key = row.approvedOn.slice(0, 10);
    approvedByDay.set(key, (approvedByDay.get(key) ?? 0) + 1);
  }

  const series: EarningsWeek[] = [];
  for (let week = weeks - 1; week >= 0; week -= 1) {
    const startOffset = week * 7 + 6;
    const start = daysAgoKey(startOffset);
    const end = daysAgoKey(week * 7);
    let visitCount = 0;
    let approvedCount = 0;
    for (let day = startOffset; day >= week * 7; day -= 1) {
      const key = daysAgoKey(day);
      visitCount += visitsByDay.get(key) ?? 0;
      approvedCount += approvedByDay.get(key) ?? 0;
    }
    series.push({
      start,
      end,
      label: week === 0 ? 'This week' : shortDay(start),
      range: `${shortDay(start)} – ${shortDay(end)}`,
      visits: visitCount,
      approved: approvedCount,
    });
  }
  return series;
}

/** Whole-unit currency for dense table cells: 1250 → "$1,250". */
export function formatMoney(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** "MS" from "Mark Salvador", "A" from "Arthur". Falls back to a question mark. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Compact age for dense rows ("4 min ago"). Falls back to the absolute UTC
 * timestamp once something is older than a week, where "8 days ago" stops
 * being more useful than the date.
 */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDateTime(iso);
}

/**
 * "13 Aug 2026" from a YYYY-MM-DD day key. An approval date is read, not
 * sorted, so it is spelled out rather than left as an ISO string.
 */
export function formatDay(key: string): string {
  const date = new Date(`${key.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // UTC to match the day buckets and the "Since 00:00 UTC" label — rendering
  // this one field in server-local time made rows look like they landed on a
  // different day from the one they were counted in.
  return `${date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  })} UTC`;
}
