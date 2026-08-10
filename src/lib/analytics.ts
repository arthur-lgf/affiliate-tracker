import type { AffiliateLink, Submission, Visit } from './types';

export type DayBucket = { date: string; label: string; submissions: number; visits: number };

export type PerformanceRow = {
  key: string;
  label: string;
  sublabel: string;
  visits: number;
  submissions: number;
  conversion: number;
};

export type DashboardStats = {
  totalSubmissions: number;
  totalVisits: number;
  conversion: number;
  activeLinks: number;
  totalLinks: number;
  submissionsToday: number;
  submissionsLast7: number;
  submissionsPrev7: number;
  trend7: number | null;
  series: DayBucket[];
  byAssignee: PerformanceRow[];
  byCampaign: PerformanceRow[];
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
  days = 14,
): DashboardStats {
  const today = daysAgoKey(0);
  const start7 = daysAgoKey(6);
  const startPrev7 = daysAgoKey(13);

  let submissionsToday = 0;
  let submissionsLast7 = 0;
  let submissionsPrev7 = 0;

  const submissionsByDay = new Map<string, number>();
  const visitsByDay = new Map<string, number>();

  for (const row of submissions) {
    const key = dayKey(row.createdAt);
    submissionsByDay.set(key, (submissionsByDay.get(key) ?? 0) + 1);
    if (key === today) submissionsToday += 1;
    if (key >= start7) submissionsLast7 += 1;
    else if (key >= startPrev7) submissionsPrev7 += 1;
  }

  for (const row of visits) {
    const key = dayKey(row.createdAt);
    visitsByDay.set(key, (visitsByDay.get(key) ?? 0) + 1);
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

  return {
    totalSubmissions: submissions.length,
    totalVisits: visits.length,
    conversion: safeRate(submissions.length, visits.length),
    activeLinks: links.filter((l) => l.active).length,
    totalLinks: links.length,
    submissionsToday,
    submissionsLast7,
    submissionsPrev7,
    trend7:
      submissionsPrev7 === 0
        ? submissionsLast7 > 0
          ? null
          : 0
        : (submissionsLast7 - submissionsPrev7) / submissionsPrev7,
    series,
    byAssignee,
    byCampaign,
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

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
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
