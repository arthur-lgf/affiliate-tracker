// The bars around the selected window.
//
// The chart is drawn one step coarser than the filter asks for — today in days,
// a week in weeks, a month in months — so it is the context the figure sits in
// rather than a second copy of it. That is only worth anything if the bars land
// in the right bucket and the chart says how far back it reaches, which is what
// these pin down.
//
//   npx tsx scripts/earnings-series-checks.ts
import { buildEarningsSeries } from '../src/lib/analytics';
import type { Conversion, Visit } from '../src/lib/types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

/** The same UTC day key the app buckets everything on. */
function dayKey(daysAgo: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** The first day of the month `back` months before this one, UTC. */
function monthStart(back: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    .toISOString()
    .slice(0, 10);
}

function at(daysAgo: number, hour = 12): string {
  return `${dayKey(daysAgo)}T${String(hour).padStart(2, '0')}:30:00.000Z`;
}

let seq = 0;
function visit(daysAgo: number, usr = 'mark'): Visit {
  seq += 1;
  return {
    id: `v${seq}`,
    createdAt: at(daysAgo),
    slug: 'cards',
    usr,
    referrer: '',
    userAgent: '',
    ip: '',
  };
}

function approval(daysAgo: number, usr = 'mark'): Conversion {
  seq += 1;
  return {
    id: `c${seq}`,
    createdAt: at(daysAgo),
    approvedOn: dayKey(daysAgo),
    slug: 'cards',
    usr,
    amount: 100,
    notes: '',
  };
}

/** A visit dated to the first day of a past month, for the monthly chart. */
function visitInMonth(back: number, usr = 'mark'): Visit {
  seq += 1;
  return {
    id: `m${seq}`,
    createdAt: `${monthStart(back)}T12:00:00.000Z`,
    slug: 'cards',
    usr,
    referrer: '',
    userAgent: '',
    ip: '',
  };
}

const totalVisits = (series: { buckets: { visits: number }[] }) =>
  series.buckets.reduce((sum, bucket) => sum + bucket.visits, 0);

/** The day key `offset` days before `key`. Negative walks forward. */
function dayKeyOf(key: string, offset: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

console.log('— Today: the past days, one bar each —');
const day = buildEarningsSeries(
  [visit(0), visit(0), visit(1), visit(6), visit(7), visit(40)],
  [approval(0), approval(6)],
  { period: 'day' },
);
check('seven daily bars', day.buckets.length === 7);
check('one day each', day.buckets.every((b) => b.start === b.end));
check('the last is today', day.buckets[6]!.start === dayKey(0));
check('and says so', day.buckets[6]!.label === 'Today');
check('the first is six days back', day.buckets[0]!.start === dayKey(6));
check("today's two visits are together", day.buckets[6]!.visits === 2);
check('yesterday keeps its own bar', day.buckets[5]!.visits === 1);
check('the far edge is included', day.buckets[0]!.visits === 1);
// A week and a day ago is off the end of this chart, and forty days ago is
// nowhere near it.
check('older visits are not drawn', totalVisits(day) === 4);
check('approvals land on their approval date', day.buckets[6]!.approved === 1 && day.buckets[0]!.approved === 1);
check('the heading says days', day.title === 'Day by day');
check('the span says how far back', day.span === 'last 7 days');
check('the caption agrees', day.caption === 'Visits and approvals over the last 7 days, one bar per day.');
// The whole point of the change: the chart is wider than the figure beside it.
check('today alone would have been one bar', totalVisits(day) > day.buckets[6]!.visits);

console.log('\n— 7 days: week by week —');
const week = buildEarningsSeries(
  [visit(0), visit(6), visit(7), visit(41), visit(42)],
  [approval(8)],
  { period: 'week' },
);
check('six weekly bars', week.buckets.length === 6);
check('seven days each', week.buckets.every((b) => b.start === dayKeyOf(b.end, 6)));
check('the last week ends today', week.buckets[5]!.end === dayKey(0));
check('and is called this week', week.buckets[5]!.label === 'This week');
check('the first starts six weeks back', week.buckets[0]!.start === dayKey(41));
check('this week holds days 0 to 6', week.buckets[5]!.visits === 2);
check('day seven falls into the week before', week.buckets[4]!.visits === 1);
check('the oldest edge is included', week.buckets[0]!.visits === 1);
// Six weeks is 42 days, so day 42 is one day past the end.
check('older than six weeks is dropped', totalVisits(week) === 4);
check('an approval eight days back is in the second-newest week', week.buckets[4]!.approved === 1);
check('the heading says weeks', week.title === 'Week by week');
check('the span says six weeks', week.span === 'last 6 weeks');
check('the caption agrees', week.caption === 'Visits and approvals over the last 6 weeks, one bar per week.');

console.log('\n— 30 days: month by month —');
const month = buildEarningsSeries(
  [visitInMonth(0), visitInMonth(0), visitInMonth(1), visitInMonth(5), visitInMonth(6)],
  [],
  { period: 'month' },
);
check('six monthly bars', month.buckets.length === 6);
check('the last is this month', month.buckets[5]!.start === monthStart(0));
// The current month keeps its own name rather than the words "This month",
// which is the one label that does not fit a sixth of the chart. The bold in
// the component and the range below say which one it is.
check('and is named, not called "this month"', /^[A-Z][a-z]{2}$/.test(month.buckets[5]!.label));
check('its range says it is only part-run', month.buckets[5]!.range.endsWith(', so far'));
check('a finished month says no such thing', !month.buckets[0]!.range.includes('so far'));
check('the first is five months back', month.buckets[0]!.start === monthStart(5));
check('this month has its two', month.buckets[5]!.visits === 2);
check('last month has its one', month.buckets[4]!.visits === 1);
check('five months back has its one', month.buckets[0]!.visits === 1);
check('six months back is off the chart', totalVisits(month) === 4);
// Calendar months, so every bar ends on a real month end rather than 30 days
// after it started.
check(
  'each bar ends on the last day of its month',
  month.buckets.every((b) => {
    const end = new Date(`${b.end}T00:00:00Z`);
    const next = new Date(end);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.getUTCDate() === 1;
  }),
);
check('and starts on the first', month.buckets.every((b) => b.start.endsWith('-01')));
check('months run oldest to newest', month.buckets.every((b, i, all) => i === 0 || all[i - 1]!.end < b.start));
check('the heading says months', month.title === 'Month by month');
check('the span says six months', month.span === 'last 6 months');
check('the caption says the last one is partial', month.caption.includes('the month so far'));
check('a month label is a month name', /^[A-Z][a-z]{2}( '\d{2})?$/.test(month.buckets[0]!.label));
check('the range spells out the year', /^[A-Z][a-z]+ \d{4}$/.test(month.buckets[0]!.range));

console.log('\n— All time: six slices of whatever there is —');
const youngAccount = buildEarningsSeries([visit(3), visit(0)], [], { period: 'all' });
check('four days of history draws four daily bars', youngAccount.buckets.length === 4);
check('one day each', youngAccount.buckets.every((b) => b.start === b.end));
check('oldest first', youngAccount.buckets[0]!.start === dayKey(3));
check('every visit is on the chart', totalVisits(youngAccount) === 2);
check('a day-wide bar says days', youngAccount.title === 'Day by day');

const oldAccount = buildEarningsSeries([visit(100), visit(0)], [], { period: 'all' });
check('a hundred days is still six bars', oldAccount.buckets.length === 6);
check('each about seventeen days wide', oldAccount.title === '17 days at a time');
check('the oldest visit is on it', totalVisits(oldAccount) === 2);
check('and the newest bar ends today', oldAccount.buckets[5]!.end === dayKey(0));
check('the span is spelled out', oldAccount.span === 'last 102 days');

// A history that happens to be six weeks wide gets weeks, and says weeks.
const sevens = buildEarningsSeries([visit(41), visit(0)], [], { period: 'all' });
check('a six-week history is drawn in weeks', sevens.title === 'Week by week');

const nothing = buildEarningsSeries([], [], { period: 'all' });
check('an empty account still draws a chart', nothing.buckets.length === 6);
check('of empty days', totalVisits(nothing) === 0 && nothing.buckets.every((b) => b.start === b.end));

console.log('\n— every window —');
for (const period of ['day', 'week', 'month', 'all'] as const) {
  const series = buildEarningsSeries([visit(0), visit(2)], [approval(0)], { period });
  check(`${period}: has bars`, series.buckets.length > 0);
  check(`${period}: every bar is labelled`, series.buckets.every((b) => b.label.length > 0));
  check(`${period}: every bar has a spelled-out range`, series.buckets.every((b) => b.range.length > 0));
  check(`${period}: keys are unique`, new Set(series.buckets.map((b) => b.start)).size === series.buckets.length);
  check(`${period}: has a heading`, series.title.length > 0);
  check(`${period}: says how far back it reaches`, series.span.startsWith('last '));
  check(`${period}: has a caption`, series.caption.endsWith('.'));
  check(`${period}: exactly one bar is now`, series.buckets.filter((b) => b.current).length === 1);
  check(`${period}: and it is the newest`, series.buckets[series.buckets.length - 1]!.current);
  // Contiguous: no day falls between two bars, and none is counted twice.
  let joined = true;
  for (let i = 1; i < series.buckets.length; i += 1) {
    if (series.buckets[i]!.start !== dayKeyOf(series.buckets[i - 1]!.end, -1)) joined = false;
  }
  check(`${period}: bars are edge to edge, no gap and no overlap`, joined);
}

console.log('\n— labels read the way a person writes them —');
const labels = buildEarningsSeries([], [], { period: 'day' }).buckets.map((b) => b.label);
check('a day bar is "Wed 12", not "12 Wed"', /^[A-Z][a-z]{2} \d{1,2}$/.test(labels[0]!));
check('the newest day says Today', labels[6] === 'Today');
check('no label is empty', labels.every((label) => label.length > 0));

console.log('\n— whose bars they are —');
const mixed = [visit(0, 'mark'), visit(0, 'gimson'), visit(1, 'mark')];
check('everyone counts everyone', totalVisits(buildEarningsSeries(mixed, [], { period: 'day' })) === 3);
check(
  'one person counts one person',
  totalVisits(buildEarningsSeries(mixed, [], { period: 'day', usr: 'mark' })) === 2,
);
const house = buildEarningsSeries([visit(0, ''), visit(0, 'mark')], [], {
  period: 'day',
  usr: '_house',
});
check('the house is a person like any other', totalVisits(house) === 1);
check(
  'the person filter applies to the monthly chart too',
  totalVisits(buildEarningsSeries(mixed, [], { period: 'month', usr: 'mark' })) === 2,
);

console.log(`\nearnings-series: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
