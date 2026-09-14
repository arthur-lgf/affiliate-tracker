// The cards table on a payslip, rendered at every width it is read at.
//
// A payslip is a document. People open it on a phone, and they print it for a
// landlord or an accountant. The page around this table reads the viewer
// before it draws anything, which nothing outside a Next request can do, so
// the table is a component of its own and is drawn here directly.
//
// It is read four ways: on a phone, on anything wider, and on paper both wider
// and narrower than the sm breakpoint. A phone gets the card with its customer
// under it, then the amount, with nothing to scroll sideways to find the money.
// Anything wider, and paper of any size, get the three columns the payslip
// always had, so one printed from a phone reads the same as one printed from a
// desk.
//
// At every one of those widths a card name with no spaces in it breaks rather
// than pushing the amounts out of reach, and on paper the total prints once,
// after the last card, rather than at the foot of every sheet.
//
// The last section holds everything rendered here to the house rules an
// affiliate page lives under: no em or en dash, no percentage, and none of the
// words that describe how their money was cut.
//
//   npx tsx --tsconfig scripts/render.tsconfig.json scripts/payslip-cards-render-checks.tsx
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayslipCards } from '../src/components/PayslipCards';
import { formatMoney } from '../src/lib/analytics';
import { cardCount, payslipLines, type Loaded } from '../src/lib/payslip-view';
import { BLANK } from '../src/lib/report-table';
import type { AffiliateLink, Conversion, Submission } from '../src/lib/types';
import {
  attr,
  cellsAt,
  classesOf,
  columnsAt,
  displayAt,
  findAll,
  PAPER,
  partsAt,
  rowsIn,
  runsAt,
  SCREENS,
  shownAt,
  tableIn,
  textAt,
  wrapAt,
  type MarkupNode,
  type Width,
} from './table-markup';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name, extra === undefined ? '' : extra);
  }
}

/* Every piece of markup rendered below, for the house rules at the end. */
const rendered: string[] = [];
function render(node: ReactNode): string {
  const html = renderToStaticMarkup(node);
  rendered.push(html);
  return html;
}

const same = (a: unknown[], b: unknown[]) => JSON.stringify(a) === JSON.stringify(b);
const readAt = (row: MarkupNode | undefined, width: Width) =>
  row ? cellsAt(row, width).map((cell) => textAt(cell, width)) : [];

const ALL: readonly Width[] = [...SCREENS, ...PAPER];
/** Every reading that gets the payslip's own columns: anything but a phone. */
const COLUMNS: readonly Width[] = ['desktop', ...PAPER];
const SAID: Record<Width, string> = {
  phone: 'a phone',
  desktop: 'anything wider',
  'print-narrow': 'paper narrower than sm',
  'print-wide': 'paper wider than sm',
};

/** A column only a wider screen draws, which paper of any size draws too. */
const columnOnly = (node: MarkupNode | undefined) =>
  node !== undefined && ['hidden', 'sm:table-cell', 'print:table-cell'].every((token) => classesOf(node).includes(token));
/** A line only a phone draws: hidden from sm up, and on paper of any size. */
const phoneOnly = (node: MarkupNode | undefined) =>
  node !== undefined && ['sm:hidden', 'print:hidden'].every((token) => classesOf(node).includes(token));

/* ---------------------------------------------------------------- fixtures --- */

function link(slug: string, campaign: string): AffiliateLink {
  return {
    id: `link-${slug}`,
    slug,
    usr: 'ana',
    assignee: 'Ana',
    assigneeEmail: '',
    destination: 'https://example.test/offer',
    campaign,
    headline: '',
    subheadline: '',
    ctaLabel: '',
    requirePhone: false,
    passUsrParam: '',
    active: true,
    notes: '',
    createdAt: '2026-07-01T00:00:00.000Z',
  } as AffiliateLink;
}

function conversion(id: string, slug: string, approvedOn: string, amount: number, notes = ''): Conversion {
  return { id, createdAt: `${approvedOn}T10:00:00.000Z`, approvedOn, slug, usr: 'ana', amount, notes };
}

const LOAD: Pick<Loaded, 'links' | 'conversions' | 'submissions'> = {
  links: [
    link('platinum', 'Platinum Card'),
    link('reserve', 'Chase Sapphire Reserve Business Platinum Travel Rewards Card'),
  ],
  submissions: [
    { id: 'abc1', fullName: 'Dana Okafor', email: 'dana@example.test' } as Submission,
    { id: 'abc2', fullName: 'Maximiliana Oyelaran-Whitfield', email: 'max@example.test' } as Submission,
  ],
  conversions: [
    conversion('101', 'platinum', '2026-08-01', 70, 'lead:abc1'),
    conversion('102', 'reserve', '2026-08-10', 12345.67, 'lead:abc2'),
  ],
};

/* The third line's approval is gone, which is what a cancelled request allows. */
const lines = payslipLines(
  [
    { conversionId: '101', amount: 70 },
    { conversionId: '102', amount: 12345.67 },
    { conversionId: null, amount: 5 },
  ],
  LOAD,
);
const TOTAL = 12420.67;

console.log('- the lines drawn -');
check('three lines', lines.length === 3, lines.length);
check('named from their approvals', lines[0]?.card === 'Platinum Card' && lines[0]?.customer === 'Dana Okafor', lines[0]);
check('a long name stays long', lines[1]?.card === 'Chase Sapphire Reserve Business Platinum Travel Rewards Card', lines[1]);
check('and a line whose approval is gone reads blank', lines[2]?.card === BLANK && lines[2]?.customer === BLANK, lines[2]);

const html = render(<PayslipCards lines={lines} total={TOTAL} />);
const table = tableIn(html, 'Cards on this request');
const head = table ? rowsIn(table, 'thead')[0] : undefined;
const body = table ? rowsIn(table, 'tbody') : [];
const foot = table ? rowsIn(table, 'tfoot')[0] : undefined;
/** The runs of text drawn inside `cell` at `width`, each with every element around it from the table in. */
const runsIn = (cell: MarkupNode | undefined, width: Width) =>
  table && cell ? runsAt(table, width).filter((run) => run.path.includes(cell)) : [];

console.log('\n- the width it asks for -');
check('the table scrolls in its own window', table !== null);
check('and is the only table', (html.match(/<table/g) || []).length === 1);
const tableClasses = table ? classesOf(table) : [];
check(
  'it does not ask a phone for a width the phone does not have',
  !tableClasses.some((token) => token.startsWith('min-w-')),
  tableClasses,
);
check('it keeps its width from sm up', tableClasses.includes('sm:min-w-[480px]'), tableClasses);
/*
 * But a sheet narrower than sm is not held to it. A window that scrolls on a
 * screen is cut off on paper, and what would be cut off is the amounts.
 */
check(
  'and does not force it onto a sheet narrower than sm',
  !tableClasses.some((token) => token.startsWith('print:min-w-')),
  tableClasses,
);

console.log('\n- the headings -');
check('a phone heads two columns: the card and the amount', same(readAt(head, 'phone'), ['Card', 'Amount']), readAt(head, 'phone'));
for (const width of COLUMNS) {
  check(
    `${SAID[width]} heads the three the payslip always had`,
    same(readAt(head, width), ['Card', 'Customer', 'Amount']),
    readAt(head, width),
  );
}
{
  const hidden = head ? head.children.filter((cell) => !shownAt(cell, 'phone')) : [];
  check(
    'the Customer heading is hidden below sm, and printed on paper of any size',
    hidden.length === 1 && columnOnly(hidden[0]),
    hidden.map(classesOf),
  );
}

console.log('\n- the rows -');
check('one row per card, and no second list for the phone', body.length === lines.length, body.length);
body.forEach((tr, index) => {
  const line = lines[index]!;
  const name = `line ${index + 1}`;
  for (const width of ALL) {
    check(
      `${name}: lines up under the headings on ${SAID[width]}`,
      head !== undefined && columnsAt(tr, width) === columnsAt(head, width),
      [columnsAt(tr, width), head && columnsAt(head, width)],
    );
  }

  const [stacked, amount] = cellsAt(tr, 'phone');
  check(
    `${name}: on a phone the card comes first, then its customer`,
    stacked !== undefined && same(partsAt(stacked, 'phone'), [line.card, line.customer]),
    stacked && partsAt(stacked, 'phone'),
  );
  check(
    `${name}: then the amount`,
    cellsAt(tr, 'phone').length === 2 && amount !== undefined && textAt(amount, 'phone') === formatMoney(line.amount),
    amount && textAt(amount, 'phone'),
  );
  for (const width of COLUMNS) {
    check(
      `${name}: ${SAID[width]} reads card, customer and amount in their own columns`,
      same(readAt(tr, width), [line.card, line.customer, formatMoney(line.amount)]),
      readAt(tr, width),
    );
    check(
      `${name}: with only the card in the card's cell on ${SAID[width]}`,
      stacked !== undefined && same(partsAt(stacked, width), [line.card]),
      stacked && partsAt(stacked, width),
    );
  }

  const columnsOnlyWide = tr.children.filter((cell) => !shownAt(cell, 'phone'));
  check(
    `${name}: the customer column is hidden below sm, and printed on paper of any size`,
    columnsOnlyWide.length === 1 && columnOnly(columnsOnlyWide[0]),
    columnsOnlyWide.map(classesOf),
  );
  const linesOnlyPhone = stacked ? findAll(stacked, (node) => !shownAt(node, 'desktop')) : [];
  check(
    `${name}: the customer under the card is hidden from sm up, and on paper`,
    linesOnlyPhone.length === 1 && phoneOnly(linesOnlyPhone[0]),
    linesOnlyPhone.map(classesOf),
  );
  /*
   * Read one width at a time, since a class can cut a name short at one width
   * and not at another. A card name with no spaces in it, such as a slug with
   * no campaign behind it, has to break where it has to at every width: on a
   * phone so the amount stays on the screen, from sm up so it does not run
   * over the customer beside it, and on paper so the amounts stay on the sheet.
   */
  for (const width of ALL) {
    const [card] = runsIn(stacked, width);
    const wrap = card && wrapAt(card.path, width);
    check(
      `${name}: the card name wraps on ${SAID[width]}, and is never cut short`,
      card?.text === line.card && wrap?.whiteSpace === 'normal' && !wrap.clipped,
      [card?.text, wrap],
    );
    check(
      `${name}: and a name with no spaces in it breaks where it has to on ${SAID[width]}`,
      wrap?.overflowWrap === 'anywhere',
      wrap,
    );
    const figures = runsIn(amount, width);
    check(
      `${name}: the amount never wraps on ${SAID[width]}`,
      figures.length === 1 && wrapAt(figures[0]!.path, width).whiteSpace === 'nowrap',
      figures.map((run) => wrapAt(run.path, width)),
    );
  }
  check(`${name}: and the amount is set in figures`, amount !== undefined && classesOf(amount).includes('tnum'), amount && classesOf(amount));
});

console.log('\n- the total -');
for (const width of ALL) {
  check(
    `the total lines up under the amounts on ${SAID[width]}`,
    foot !== undefined && head !== undefined && columnsAt(foot, width) === columnsAt(head, width),
    [foot && columnsAt(foot, width), head && columnsAt(head, width)],
  );
}
{
  const [words, figure] = foot ? cellsAt(foot, 'phone') : [];
  check(
    'a phone reads the words with the card count under them, then the figure',
    words !== undefined &&
      same(partsAt(words, 'phone'), ['Total requested', cardCount(lines.length)]) &&
      figure !== undefined &&
      textAt(figure, 'phone') === formatMoney(TOTAL),
    [words && partsAt(words, 'phone'), figure && textAt(figure, 'phone')],
  );
  for (const width of COLUMNS) {
    check(
      `${SAID[width]} reads the words, the card count and the figure in their own columns`,
      same(readAt(foot, width), ['Total requested', cardCount(lines.length), formatMoney(TOTAL)]),
      readAt(foot, width),
    );
  }
  const countColumn = foot ? foot.children.filter((cell) => !shownAt(cell, 'phone')) : [];
  check(
    'the card count column is hidden below sm, and printed on paper of any size',
    countColumn.length === 1 && columnOnly(countColumn[0]),
    countColumn.map(classesOf),
  );
  const countLine = words ? findAll(words, (node) => !shownAt(node, 'desktop')) : [];
  check(
    'and the count under the words is hidden from sm up, and on paper',
    countLine.length === 1 && phoneOnly(countLine[0]),
    countLine.map(classesOf),
  );
  check(
    'no cell drawn on a phone spans a column the phone does not have',
    foot !== undefined && cellsAt(foot, 'phone').every((cell) => (attr(cell, 'colspan') ?? '1') === '1'),
  );
  for (const width of ALL) {
    const figures = runsIn(figure, width);
    check(
      `the figure never wraps on ${SAID[width]}`,
      figures.length === 1 && wrapAt(figures[0]!.path, width).whiteSpace === 'nowrap',
      figures.map((run) => wrapAt(run.path, width)),
    );
  }
  check('and is still set against the highlighter', figure !== undefined && classesOf(figure).includes('mark'), figure && classesOf(figure));
}
/*
 * A table that runs onto a second sheet repeats its footer group at the foot of
 * every sheet, the way it repeats its headings at the top. The headings are
 * welcome there and the total is not: on A5 it printed under five of the six
 * cards, a figure the lines above it did not add up to, and then again on the
 * next sheet. So on paper the footer is an ordinary row group, which prints
 * once, after the last card. A screen has no sheets, and keeps its footer.
 */
{
  const group = table ? table.children.find((child) => child.tag === 'tfoot') : undefined;
  for (const width of PAPER) {
    check(
      `on ${SAID[width]} the total prints once, after the last card, and not at the foot of every sheet`,
      group !== undefined && displayAt(group, width) === 'table-row-group',
      group && classesOf(group),
    );
  }
  for (const width of SCREENS) {
    check(
      `on ${SAID[width]} the footer is left as the table's footer`,
      group !== undefined && displayAt(group, width) === '',
      group && classesOf(group),
    );
  }
}

const one = render(<PayslipCards lines={lines.slice(0, 1)} total={70} />);
check('one card is singular', one.includes('1 card') && !one.includes('1 cards'));
const handed = render(<PayslipCards lines={lines} total={12000} />);
check(
  'the total printed is the one it was handed, not a sum taken here',
  handed.includes(`>${formatMoney(12000)}<`) && !handed.includes(formatMoney(TOTAL)),
);

console.log('\n- the payslip page draws it -');
/* Run from the repository root, like every other check here. */
const page = readFileSync(path.join(process.cwd(), 'src', 'app', '(admin)', 'payslips', '[requestId]', 'page.tsx'), 'utf8');
check('the page renders this table', /<PayslipCards\s+lines=\{lines\}\s+total=\{record\.totalAmount\}\s*\/>/.test(page));
check('and keeps no table of its own that could drift from it', !page.includes('<table'));

console.log('\n- the house rules, across everything rendered -');
const everything = rendered.join('\n');
check('markup was rendered', rendered.length === 3 && everything.length > 2000, rendered.length);
check('no em dash or en dash', !/[–—]/.test(everything));
check('no middle dot', !everything.includes('·'));
check('no percentage', !everything.includes('%'));
check(
  'none of the words that describe the cut',
  !/share|commission|gross|split/i.test(everything),
  /share|commission|gross|split/i.exec(everything)?.[0],
);

console.log(`\npayslip-cards-render: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
