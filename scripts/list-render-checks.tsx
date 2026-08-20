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
import { CpaBrowser, groupRates, tierCount, tiersOf } from '../src/components/CpaBrowser';
import { sortRows } from '../src/lib/report-table';
import { EarnersTable } from '../src/components/EarnersTable';
import { LinksBrowser, type LinkRow } from '../src/components/LinksBrowser';
import { Pager } from '../src/components/Pager';
import { affiliateRevenueOf, formatMoney, type ConversionView, type EarningsRow } from '../src/lib/analytics';
import type { CpaRate } from '../src/lib/types';

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

console.log('\n— the CPA rate card —');
/*
 * Twelve cards paying one flat rate and three paying by tier, which is the
 * shape of the real export. Fifteen cards, twenty-one rates: the difference
 * between those two numbers is what the grouping and the pager are for.
 */
const flat: CpaRate[] = Array.from({ length: 12 }, (_, i) => ({
  placement: '714025 - LGF',
  issuer: i % 2 === 0 ? 'AmEx Consumer' : 'Capital One',
  card: 'Flat Card ' + i,
  tier: '',
  current: i === 5 ? 0 : 100 + i,
  previous: i === 7 ? null : 90 + i,
  change: i === 7 ? null : 0.1,
  changedOn: i === 9 ? '' : '2026-07-01',
}));
const tiered: CpaRate[] = ['Platinum', 'Gold', 'Venture'].flatMap((name, card) =>
  [1, 2, 3].map((tier) => ({
    placement: '714025 - LGF',
    issuer: 'AmEx Consumer',
    card: name + ' Card',
    tier: 'Tier ' + tier,
    current: 400 + card * 10 + tier * 100,
    previous: 300,
    change: 0.1,
    changedOn: '2026-07-01',
  })),
);
// Tiered first, so the fold controls land on the first page where these
// checks can see them. The store sorts by issuer and card, which puts the
// AmEx tiers near the top of the real card too.
const rates = [...tiered, ...flat];
const card = renderToStaticMarkup(<CpaBrowser rows={rates} />);

// Fifteen cards out of twenty-one rates: the page counts cards.
check('a page is ten cards, not ten rates', (card.match(/aria-expanded|Flat Card/g) || []).length >= 10);
check('the pager counts cards', card.includes('Showing 1–10 of 15'));
check('and names them', card.includes('Cards'));
check('there is a search box', card.includes('id="cpa-search"'));
check('the columns are sortable', card.includes('aria-sort'));
check('the rate column is named for what it answers', card.includes('Pays now'));
check('the affiliate half has a column', card.includes('Affiliate revenue'));
// 100 for the first flat card, so the affiliate keeps 50.
check('and it is half of what the card pays', card.includes(formatMoney(affiliateRevenueOf(100))));
check('a card at zero pays the affiliate zero, not a dash', (card.match(/\$0/g) || []).length >= 2);

// The grouping itself.
check('a tiered card is foldable', card.includes('aria-expanded="true"'));
check('and says how many tiers it has', card.includes('>3</span>'));
check('its tiers are drawn under it', card.includes('Tier 1') && card.includes('Tier 3'));
check('with an indent marker', card.includes('↳'));
check('a screen reader still hears which card a tier belongs to', card.includes('Platinum Card, '));
check('there is a way to fold them all', card.includes('Fold every card'));
// A flat card has no tiers to fold, so it gets a dash rather than a control.
const flatOnly = renderToStaticMarkup(<CpaBrowser rows={flat} />);
check('a card with one rate has nothing to fold', !flatOnly.includes('aria-expanded'));
check('and no fold-everything button', !flatOnly.includes('Fold every card'));
check('twelve flat cards is twelve cards', flatOnly.includes('Showing 1–10 of 12'));

const noRates = renderToStaticMarkup(<CpaBrowser rows={[]} />);
check('an empty card says nothing is uploaded', noRates.includes('No rates uploaded yet'));
check('and offers no page controls', !noRates.includes('Previous'));

console.log('\n— sorting by tier —');
/*
 * The Tier column puts cards in order by how many tiers they pay at, which is
 * the number the badge shows. A card with no tiers has nothing to be ordered
 * by, so it reads blank and sinks, the same as every other blank here.
 */
const cardGroups = groupRates(rates);
check('a three-tier card counts three', tierCount(cardGroups[0]!) === 3);
check('a flat card counts nothing at all', tierCount(cardGroups[3]!) === null);

const byTier = sortRows(cardGroups, tierCount, 'number', 'desc');
check('the tiered cards come first', byTier.slice(0, 3).every((g) => g.tiered));
check('and the flat ones sink', byTier.slice(3).every((g) => !g.tiered));
check(
  'ascending sinks them too — a blank is not a low number',
  sortRows(cardGroups, tierCount, 'number', 'asc').slice(3).every((g) => !g.tiered),
);

// The direction has to mean something inside the card as well, or "highest
// first" reorders three cards and leaves Tier 1 at the top of each of them.
const platinum = cardGroups[0]!;
check(
  'unsorted, the tiers read as the report writes them',
  tiersOf(platinum, null).map((r) => r.tier).join() === 'Tier 1,Tier 2,Tier 3',
);
check(
  'highest first turns the tiers round',
  tiersOf(platinum, { key: 'tier', direction: 'desc' }).map((r) => r.tier).join() ===
    'Tier 3,Tier 2,Tier 1',
);
check(
  'lowest first puts them back',
  tiersOf(platinum, { key: 'tier', direction: 'asc' }).map((r) => r.tier).join() ===
    'Tier 1,Tier 2,Tier 3',
);
check(
  'sorting by another column leaves the tiers alone',
  tiersOf(platinum, { key: 'current', direction: 'desc' }).map((r) => r.tier).join() ===
    'Tier 1,Tier 2,Tier 3',
);
check('and the card itself is never reordered in place', platinum.rates[0]!.tier === 'Tier 1');

console.log('\n— the banding —');
/*
 * Every other card sits on a band and takes its tiers with it. Read off the
 * rendered rows rather than trusted: the rule is only worth anything if a
 * tiered card's four rows really do come out one colour.
 */
const body = card.slice(card.indexOf('<tbody>'), card.indexOf('</tbody>'));
const banded = [...body.matchAll(/<tr class="([^"]*)"/g)].map((m) => m[1]!.includes('bg-paper-sunk'));
check('the first page draws every row', banded.length === 19);
check('the first card takes no band', banded.slice(0, 4).every((on) => !on));
check('the second card takes one, tiers and all', banded.slice(4, 8).every((on) => on));
check('the third takes none again', banded.slice(8, 12).every((on) => !on));
check(
  'and flat cards alternate a row at a time',
  banded.slice(12).join(',') === 'true,false,true,false,true,false,true',
);
check('a table with no tiers still stripes', flatOnly.includes('bg-paper-sunk'));
check('the Tier heading is a control now', card.includes('Sort by Tier'));

console.log(`\nlist-render: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
