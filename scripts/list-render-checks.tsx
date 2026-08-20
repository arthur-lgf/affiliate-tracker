// Paging and filtering a list, rendered rather than reasoned about.
//
// The arithmetic is pinned in paging-checks; this pins the wiring, which is
// where the mistakes actually are: a slice taken but the whole list still
// mapped, a filter that lists nobody, a page counter reading the wrong total.
// Rendering the real component and reading the markup back catches all three,
// and none of them are visible in a type check.
//
// UsersPanel is deliberately absent: it calls useRouter at the top, which
// cannot be mounted outside a Next request, so what it adds is covered by the
// Pager checks below and by pageSlice in paging-checks.
//
// The extra tsconfig switches on the automatic JSX runtime. The app's own is
// "preserve", because Next does that step itself.
//
//   npx tsx --tsconfig scripts/render.tsconfig.json scripts/list-render-checks.tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { ApprovalsList } from '../src/components/ApprovalsList';
import { EarnersTable } from '../src/components/EarnersTable';
import { LinksBrowser, type LinkRow } from '../src/components/LinksBrowser';
import { Pager } from '../src/components/Pager';
import { affiliateRevenueOf, formatMoney, type ConversionView, type EarningsRow } from '../src/lib/analytics';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

const PEOPLE = ['mark', 'dana', 'ali'];

/** Every seventh link is a house link: no key, no assignee. */
function row(i: number): LinkRow {
  const usr = i % 7 === 0 ? '' : PEOPLE[i % PEOPLE.length]!;
  return {
    id: `id${i}`,
    slug: `slug-${i}`,
    usr,
    assignee: usr ? usr.toUpperCase() : '',
    assigneeEmail: '',
    destination: 'https://example.test/offer',
    campaign: `Campaign ${i}`,
    headline: '',
    subheadline: '',
    ctaLabel: '',
    requirePhone: false,
    passUsrParam: 'subid',
    active: i % 3 !== 0,
    notes: '',
    createdAt: `2026-08-${String((i % 27) + 1).padStart(2, '0')}T00:00:00.000Z`,
    visits: i * 3,
    submissions: i,
    url: `https://example.test/slug-${i}?usr=${usr}`,
  };
}

const rows = Array.from({ length: 23 }, (_, i) => row(i + 1));

console.log('— links —');
const html = renderToStaticMarkup(<LinksBrowser rows={rows} capture canEdit={false} />);
const cards = (html.match(/<li /g) || []).length;
check('the first page holds ten cards, not all twenty-three', cards === 10);
check('the count is of the whole matched list', html.includes('Showing 1–10 of 23'));
check('and the page count follows from it', html.includes('Page 1 of 3'));
check('the size picker is offered', html.includes('>250</option>'));
check('the person filter is drawn', html.includes('id="link-person"'));
check('with everyone as the way out of it', html.includes('>Everyone</option>'));
check('one entry per person', PEOPLE.every((p) => html.includes(`>${p.toUpperCase()}</option>`)));
check('house links get an entry of their own', html.includes('>House links</option>'));
check('the status pills count within the person scope', html.includes('All 23'));

// Under the smallest page size there is no page to turn and no size worth
// choosing, so the controls go away and the count stays.
const short = renderToStaticMarkup(<LinksBrowser rows={rows.slice(0, 6)} capture canEdit={false} />);
check('a short list says so plainly', short.includes('Showing all 6'));
check('and offers no page buttons', !short.includes('Previous'));
check('nor a size picker', !short.includes('>250</option>'));

// One person, one entry: the affiliate's own view, where the filter would be a
// control with a single possible answer.
const mine = rows.filter((r) => r.usr === 'mark');
const own = renderToStaticMarkup(<LinksBrowser rows={mine} capture canEdit={false} />);
check('a single person gets no person filter', !own.includes('id="link-person"'));

console.log('\n— the pager on its own —');
const noop = () => {};
const accounts = renderToStaticMarkup(
  <Pager total={23} page={3} perPage={10} onPage={noop} onPerPage={noop} label="Accounts" />,
);
check('the last page stops at the last row', accounts.includes('Showing 21–23 of 23'));
check('it is named for what it holds', accounts.includes('Accounts'));
const empty = renderToStaticMarkup(
  <Pager total={0} page={1} perPage={10} onPage={noop} onPerPage={noop} />,
);
check('an empty list says nothing to show', empty.includes('Nothing to show'));
check('and offers no controls', !empty.includes('Previous'));
const noted = renderToStaticMarkup(
  <Pager total={23} page={1} perPage={10} onPage={noop} onPerPage={noop} note=", sorted" />,
);
check('a note rides along with the count', noted.includes('of 23, sorted'));

console.log('\n— who is earning —');
const earners: EarningsRow[] = Array.from({ length: 23 }, (_, i) => ({
  key: 'k' + i,
  usr: 'usr' + i,
  person: 'Person ' + i,
  card: '',
  cardCount: 2,
  visits: 100 + i,
  approved: i,
  earnings: 12.35 + i,
  approvalRate: 0.1,
}));
const table = renderToStaticMarkup(
  <EarnersTable
    rows={earners}
    totals={{ visits: 1, approved: 1, earnings: earners.reduce((s, r) => s + r.earnings, 0), approvalRate: 0.1 }}
    period="month"
  />,
);
check('ten people to a page', (table.match(/<tr class="divider-row/g) || []).length === 10);
check('the money column is called Amount now', table.includes('>Amount</th>'));
check('and it is joined by the affiliate share', table.includes('>Affiliate revenue</th>'));
check('earnings is not a column heading any more', !table.includes('>Total earnings</th>'));
check('a row shows half of its own amount', table.includes(formatMoney(affiliateRevenueOf(12.35))));
// The footer is the whole window, not the page, and it says so.
const total = Math.round(earners.reduce((s, r) => s + affiliateRevenueOf(r.earnings), 0) * 100) / 100;
check('the total is the sum of the rows', table.includes(formatMoney(total)));
check('the footer admits it counts more than the page', table.includes('everyone, not just this page'));
check('and the people page through', table.includes('Showing 1–10 of 23'));

console.log('\n— approvals —');
const approvals: ConversionView[] = Array.from({ length: 23 }, (_, i) => ({
  id: 'c' + i,
  createdAt: '2026-08-01T00:00:00.000Z',
  approvedOn: '2026-08-12',
  slug: 'slug',
  usr: 'usr',
  amount: 100 + i,
  notes: '',
  person: 'Person ' + i,
  card: 'Card',
  client: '-',
  note: '',
}));
const list = renderToStaticMarkup(<ApprovalsList rows={approvals} canEdit={false} empty="none" />);
check('ten approvals to a page', (list.match(/<li /g) || []).length === 10);
check('with the rest a page away', list.includes('Showing 1–10 of 23'));
const noApprovals = renderToStaticMarkup(<ApprovalsList rows={[]} canEdit={false} empty="none yet" />);
check('an empty history says so and stops', noApprovals.includes('none yet') && !noApprovals.includes('Showing'));

console.log(`\nlist-render: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
