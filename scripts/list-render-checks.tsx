// Paging and filtering a list, rendered rather than reasoned about.
//
// The arithmetic is pinned in paging-checks; this pins the wiring, which is
// where the mistakes actually are: a slice taken but the whole list still
// mapped, a filter that lists nobody, a page counter reading the wrong total.
// Rendering the real component and reading the markup back catches all three,
// and none of them are visible in a type check.
//
// UsersPanel is not rendered: it calls useRouter at the top, which cannot be
// mounted outside a Next request. Its filtering is exported as a plain
// function instead and checked directly at the bottom of this file; the rest
// is covered by the Pager checks below and by pageSlice in paging-checks.
//
// The extra tsconfig switches on the automatic JSX runtime. The app's own is
// "preserve", because Next does that step itself.
//
//   npx tsx --tsconfig scripts/render.tsconfig.json scripts/list-render-checks.tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { ApprovalsList } from '../src/components/ApprovalsList';
import { CpaBrowser, groupRates, tierCount, tiersOf } from '../src/components/CpaBrowser';
import { problemsIn } from '../src/components/CampaignSettings';
import { ratesForViewer } from '../src/lib/cpa';
import { sortRows } from '../src/lib/report-table';
import { EarnersTable } from '../src/components/EarnersTable';
import { LinksBrowser, type LinkRow } from '../src/components/LinksBrowser';
import { Pager } from '../src/components/Pager';
import { matchAccounts, type AccountRow } from '../src/components/UsersPanel';
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
const linkRows = (html.match(/<tr class="divider-row/g) || []).length;
check('the first page holds ten rows, not all twenty-three', linkRows === 10);
check('the count is of the whole matched list', html.includes('Showing 1–10 of 23'));
check('and the page count follows from it', html.includes('Page 1 of 3'));
check('the size picker is offered', html.includes('>250</option>'));
check('the person filter is drawn', html.includes('id="link-person"'));
check('with everyone as the way out of it', html.includes('>Everyone</option>'));
check('one entry per person', PEOPLE.every((p) => html.includes(`>${p.toUpperCase()}</option>`)));
check('house links get an entry of their own', html.includes('>House links</option>'));
check('the status counts count within the person scope', html.includes('All 23'));

/*
 * The redesign turned each card into a row. These pin the columns rather than
 * the styling: a column quietly dropped in a refactor is invisible in a type
 * check, and invisible in a screenshot of a table that still looks like a
 * table.
 */
for (const heading of ['Campaign', 'Owner', 'Short link', 'Status', 'Visits', 'Leads', 'Conversion']) {
  check(`the ${heading} column is drawn`, html.includes(`>${heading}</th>`));
}
check('a live link says so', html.includes('>Live</span>'));
check('and a paused one says that', html.includes('>Paused</span>'));
check('every row can be copied', (html.match(/>Copy</g) || []).length === 10);
// An affiliate may copy their links but not change them.
check('but not paused by someone who cannot edit', !html.includes('aria-label="Pause the link'));
check('nor deleted', !html.includes('aria-label="Delete the link'));
check('where the link forwards to is still on the row', html.includes('example.test/offer'));
// The admin side of that is not rendered here: LinkActions calls useRouter, so
// canEdit={true} cannot be mounted outside a Next request.

// With the capture form off there are no leads, so the two columns that count
// them go rather than standing at zero forever.
const noCapture = renderToStaticMarkup(<LinksBrowser rows={rows} capture={false} canEdit={false} />);
check('no capture form, no Leads column', !noCapture.includes('>Leads</th>'));
check('and no conversion column either', !noCapture.includes('>Conversion</th>'));
check('visits stay, because they are counted either way', noCapture.includes('>Visits</th>'));
check('and the leads sort goes with them', !noCapture.includes('>Most leads first</option>'));

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
const earnerTotals = {
  visits: 1,
  approved: 1,
  earnings: earners.reduce((s, r) => s + r.earnings, 0),
  approvalRate: 0.1,
};
const table = renderToStaticMarkup(
  <EarnersTable rows={earners} totals={earnerTotals} period="month" gross />,
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

/*
 * The same table read by the affiliate it belongs to. Their rows arrive already
 * halved, so the Amount column is dropped rather than blanked — and the halving
 * must not happen a second time here, which would quietly pay them a quarter.
 */
const ownTable = renderToStaticMarkup(
  <EarnersTable
    rows={earners.map((row) => ({ ...row, earnings: affiliateRevenueOf(row.earnings) }))}
    totals={{ ...earnerTotals, earnings: affiliateRevenueOf(earnerTotals.earnings) }}
    period="month"
    gross={false}
  />,
);
check('an affiliate is shown no Amount column', !ownTable.includes('>Amount</th>'));
check('but still the affiliate revenue', ownTable.includes('>Affiliate revenue</th>'));
check('their row is their half, not a quarter of it', ownTable.includes(formatMoney(affiliateRevenueOf(12.35))));
check(
  'and the merchant gross is nowhere in the page',
  !ownTable.includes(formatMoney(12.35)) && !ownTable.includes(formatMoney(earnerTotals.earnings)),
);
check('the total is still the sum of the column above it', ownTable.includes(formatMoney(total)));
check('they still page through', ownTable.includes('Showing 1–10 of 23'));

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
/*
 * canEdit stays false throughout: DeleteApproval calls useRouter, which cannot
 * be mounted outside a Next request. What that costs is one column; what it
 * buys is the ability to check the two that matter here.
 */
const list = renderToStaticMarkup(
  <ApprovalsList rows={approvals} canEdit={false} gross empty="none" />,
);
check('ten approvals to a page', (list.match(/<tr class="divider-row/g) || []).length === 10);
check('with the rest a page away', list.includes('Showing 1–10 of 23'));
for (const heading of ['Date', 'Person', 'Card']) {
  check(`the ${heading} column is drawn`, list.includes(`>${heading}</th>`));
}
check('an admin sees what the merchant paid', list.includes('>Payout</th>'));
check('and the share of it beside', list.includes('>Affiliate share</th>'));
check('with both figures on the row', list.includes(formatMoney(100)));
check('and the share worked out', list.includes(formatMoney(affiliateRevenueOf(100))));
check('nothing to press without the right to press it', !list.includes('>Actions</th>'));

/*
 * The same rows as an affiliate reads them. Their amounts arrive already
 * worked out, so there is one money column, it is called Amount, and it prints
 * what it was given: halving an already-halved figure would quarter it, and a
 * column called "affiliate share" would name a split they are not shown.
 */
const theirs = renderToStaticMarkup(
  <ApprovalsList rows={approvals} canEdit={false} gross={false} empty="none" />,
);
check('an affiliate gets one money column', theirs.includes('>Amount</th>'));
check('not the merchant payout', !theirs.includes('>Payout</th>'));
check('and nothing calling it a share', !theirs.includes('>Affiliate share</th>'));
check('their figure is printed as it arrived', theirs.includes(formatMoney(100)));
check('not halved a second time', !theirs.includes(formatMoney(affiliateRevenueOf(100))));

// One person's own page: the heading names them, so the column would be that
// name repeated down the side of it.
const solo = renderToStaticMarkup(
  <ApprovalsList rows={approvals} canEdit={false} gross={false} showPerson={false} empty="none" />,
);
check('their own page drops the Person column', !solo.includes('>Person</th>'));
check('but keeps the card', solo.includes('>Card</th>'));

const noApprovals = renderToStaticMarkup(
  <ApprovalsList rows={[]} canEdit={false} gross empty="none yet" />,
);
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
const card = renderToStaticMarkup(<CpaBrowser rows={ratesForViewer(rates, true)} gross />);

// Fifteen cards out of twenty-one rates: the page counts cards.
check('a page is ten cards, not ten rates', (card.match(/aria-expanded|Flat Card/g) || []).length >= 10);
check('the pager counts cards', card.includes('Showing 1–10 of 15'));
check('and names them', card.includes('Cards'));
check('there is a search box', card.includes('id="cpa-search"'));
check('the columns are sortable', card.includes('aria-sort'));
check('the rate column is named for what it answers', card.includes('Pays now'));
check('the affiliate half has a column', card.includes('Potential revenue'));
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
const flatOnly = renderToStaticMarkup(<CpaBrowser rows={ratesForViewer(flat, true)} gross />);
check('a card with one rate has nothing to fold', !flatOnly.includes('aria-expanded'));
check('and no fold-everything button', !flatOnly.includes('Fold every card'));
check('twelve flat cards is twelve cards', flatOnly.includes('Showing 1–10 of 12'));

const noRates = renderToStaticMarkup(<CpaBrowser rows={[]} gross />);
check('an empty card says nothing is uploaded', noRates.includes('No rates uploaded yet'));
check('and offers no page controls', !noRates.includes('Previous'));

console.log('\n— sorting by tier —');
/*
 * The Tier column puts cards in order by how many tiers they pay at, which is
 * the number the badge shows. A card with no tiers has nothing to be ordered
 * by, so it reads blank and sinks, the same as every other blank here.
 */
const cardGroups = groupRates(ratesForViewer(rates, true));
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

console.log('\n— the rate card, as an affiliate reads it —');
/*
 * Half, and only half. The merchant's rate, what it paid before and how it
 * moved are dropped from the rows themselves, so this checks the page source
 * rather than the columns: a hidden column that still ships the number is not
 * hidden from anybody who can open dev tools.
 */
const ownCard = renderToStaticMarkup(<CpaBrowser rows={ratesForViewer(rates, false)} gross={false} />);
check('there is no Pays now column', !ownCard.includes('Pays now'));
check('no Paid before column', !ownCard.includes('Paid before'));
// The quote at the end is load-bearing: 'Sort by Change' is a prefix of
// 'Sort by Changed', and the Changed column is one this reader keeps.
check('no Change column', !ownCard.includes('title="Sort by Change"'));
check('the potential revenue stays', ownCard.includes('Potential revenue'));
check('and so does the day the rate changed', ownCard.includes('title="Sort by Changed"'));
// 700 is the top tier of the Platinum fixture, so 350 is the half.
check('the half is printed', ownCard.includes(formatMoney(350)));
check('the merchant rate is not printed', !ownCard.includes(formatMoney(700)));
// 90 is a flat card's previous rate and is nobody's half, so finding it
// would mean the merchant's own figure had reached the page.
check('nor the rate it paid before', !ownCard.includes(formatMoney(90)) && card.includes(formatMoney(90)));
check('the cards are still grouped and foldable', ownCard.includes('aria-expanded="true"'));
check('the tiers are still listed', ownCard.includes('Tier 1') && ownCard.includes('Tier 3'));
check('the banding survives the narrower table', ownCard.includes('bg-paper-sunk'));
check('and it is still sortable by tier', ownCard.includes('Sort by Tier'));
check('the Tier heading is a control now', card.includes('Sort by Tier'));

console.log('\n— the campaign settings table —');
/*
 * What the Save button is allowed to send. A duplicate name is the one that
 * matters: the link form looks a destination up by name, so two rows called
 * "Cash Back" would make which URL a link gets depend on the order they happen
 * to be in.
 */
const settingsRow = (key: number, name: string, destination: string) => ({ key, name, destination });

const cleanRows = problemsIn([
  settingsRow(0, 'Best Cards', 'https://example.com?src=1'),
  settingsRow(1, 'Cash Back', ''),
]);
check('a good row and a URL-less row both pass', Object.keys(cleanRows).length === 0);

const dupeRows = problemsIn([settingsRow(0, 'Cash Back', ''), settingsRow(1, 'cash back', '')]);
check('a duplicate name is caught whatever its case', Boolean(dupeRows[1]));
check('and only the second one is blamed', !dupeRows[0]);

check('a URL with no name is caught', Boolean(problemsIn([settingsRow(0, '', 'https://example.com')])[0]));
// Clearing both fields is how a row is deleted, so it must not be an error.
check('a wholly blank row is not an error', Object.keys(problemsIn([settingsRow(0, '', '')])).length === 0);
check('half a URL is caught', Boolean(problemsIn([settingsRow(0, 'Best Cards', 'example.com')])[0]));
check(
  'and so is a javascript: url',
  Boolean(problemsIn([settingsRow(0, 'Best Cards', 'javascript:alert(1)')])[0]),
);
check(
  'surrounding space does not make a name blank',
  Object.keys(problemsIn([settingsRow(0, '  Best Cards  ', '  https://example.com  ')])).length === 0,
);

console.log('\n— accounts —');
/*
 * UsersPanel itself cannot be rendered here — it calls useRouter at the top,
 * which needs a Next request — so the filtering is pulled out as a plain
 * function and checked directly. That is the part with the bugs in it: the
 * table around it is the same table as everywhere else in the app.
 */
function account(i: number, over: Partial<AccountRow> = {}): AccountRow {
  return {
    id: `u${i}`,
    username: `user${i}`,
    role: i === 0 ? 'admin' : 'affiliate',
    usr: i === 0 ? '' : `key${i}`,
    fullName: `Person ${i}`,
    email: `person${i}@example.test`,
    active: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    lastLoginAt: null,
    createdBy: 'seed',
    ...over,
  };
}
const accountRows = [
  account(0, { username: 'arthur', fullName: 'Arthur Reyes' }),
  account(1, { username: 'dana', fullName: 'Dana Okafor', email: 'dana@elsewhere.test' }),
  account(2, { username: 'ali', fullName: 'Ali Haddad', usr: 'c89buy' }),
];
const names = (list: AccountRow[]) => list.map((r) => r.username).join();

check('no filter, everybody', matchAccounts(accountRows, '', 'all').length === 3);
check('a role narrows it', names(matchAccounts(accountRows, '', 'admin')) === 'arthur');
check('and so does the other one', matchAccounts(accountRows, '', 'affiliate').length === 2);
check('search finds a username', matchAccounts(accountRows, 'dana', 'all').length === 1);
check('and a full name', matchAccounts(accountRows, 'haddad', 'all').length === 1);
check(
  'and an email nobody would remember the username for',
  matchAccounts(accountRows, 'elsewhere', 'all').length === 1,
);
check(
  'and a tracking key, which is what an approval carries',
  matchAccounts(accountRows, 'c89buy', 'all').length === 1,
);
check('case does not matter', matchAccounts(accountRows, 'ARTHUR', 'all').length === 1);
check('surrounding space does not either', matchAccounts(accountRows, '  dana  ', 'all').length === 1);
check('the two filters compose', matchAccounts(accountRows, 'reyes', 'admin').length === 1);
check('and can leave nothing', matchAccounts(accountRows, 'dana', 'admin').length === 0);
check('a miss is empty, not everything', matchAccounts(accountRows, 'zzz', 'all').length === 0);

console.log(`\nlist-render: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
