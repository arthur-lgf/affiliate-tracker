// Reading a rendered table the way a screen of a given width displays it, for
// the render checks that draw one.
//
// Not a check itself. The tables that stack on a phone keep one row per card in
// the page and change only which parts of it are displayed, through Tailwind
// classes: `hidden sm:table-cell` on a column only a wider screen has, and
// `sm:hidden` on a line only a phone has. So a customer's name is in the markup
// twice by design, and searching the markup for it proves nothing. What matters
// is how many times it is displayed at each width, which is a question about
// the classes and the elements they sit on. The markup is parsed into a tree
// and read back one width at a time.
//
// Only the display classes, and the few that decide how text wraps, are
// understood. Anything else counts as displayed and wrapping normally, which is
// what a browser does with a class it has no rule about.

export type MarkupNode = {
  /** The element's name, or '#text' for a run of text, or '#root' for the whole. */
  tag: string;
  /** The raw attribute string, still escaped. */
  attrs: string;
  children: MarkupNode[];
  /** The decoded text, for a '#text' node only. */
  text: string;
};

/**
 * The four ways a table is read.
 *
 * Print is two of them because a sheet of paper is a width too. Letter or A4 at
 * the browser's default scale is wider than Tailwind's sm breakpoint (640 CSS
 * pixels), so `sm:` applies on paper as it does on a laptop. A5, or either at a
 * scale above about 115%, is narrower, and `sm:` does not. A document that has
 * to print the same way on both has to say so with `print:`.
 */
export type Width = 'phone' | 'desktop' | 'print-narrow' | 'print-wide';

export const SCREENS: readonly Width[] = ['phone', 'desktop'];
export const PAPER: readonly Width[] = ['print-narrow', 'print-wide'];

/*
 * The variant prefixes that apply at each width, in the order Tailwind writes
 * them into the stylesheet: plain utilities, then the breakpoints, then print.
 * The rules all have the same specificity, so for one property the later one
 * wins, and so it does here.
 *
 * Nothing in this file reads a stylesheet, so that order is an assumption, and
 * every check that says a column is hidden on a phone and back on paper rests
 * on it. scripts/table-markup-checks.ts is what holds it to Tailwind: it
 * compiles the app's own stylesheet with the Tailwind that is installed, plays
 * out the cascade actually in it, and fails when this file reads a class list
 * any differently.
 */
export const LAYERS: Record<Width, readonly string[]> = {
  phone: ['', 'max-sm:'],
  desktop: ['', 'sm:'],
  'print-narrow': ['', 'max-sm:', 'print:'],
  'print-wide': ['', 'sm:', 'print:'],
};

/* The display classes understood here, and below them the wrapping ones. Exported for the check that holds both to Tailwind. */
export const DISPLAY = new Set([
  'hidden',
  'block',
  'inline',
  'inline-block',
  'inline-flex',
  'flex',
  'grid',
  'table',
  'table-header-group',
  'table-row-group',
  'table-footer-group',
  'table-row',
  'table-cell',
  'contents',
]);

const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'wbr']);

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** React's static markup as a tree. Well-formed input is assumed, since React wrote it. */
export function parseMarkup(html: string): MarkupNode {
  const root: MarkupNode = { tag: '#root', attrs: '', children: [], text: '' };
  const open: MarkupNode[] = [root];
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    const parent = open[open.length - 1]!;
    if (match[5] !== undefined) {
      parent.children.push({ tag: '#text', attrs: '', children: [], text: decode(match[5]) });
      continue;
    }
    if (!match[2]) continue;
    const tag = match[2].toLowerCase();
    if (match[1]) {
      const at = open.map((node) => node.tag).lastIndexOf(tag);
      if (at > 0) open.length = at;
      continue;
    }
    const node: MarkupNode = { tag, attrs: match[3] ?? '', children: [], text: '' };
    parent.children.push(node);
    if (!match[4] && !VOID.has(tag)) open.push(node);
  }
  return root;
}

/**
 * One attribute's decoded value, or null when the element does not carry it.
 *
 * Matched without regard to case, as HTML matches it: React writes `colSpan`,
 * and a lookup for `colspan` that missed it would count every spanning cell as
 * one column.
 */
export function attr(node: MarkupNode, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i').exec(node.attrs);
  return match ? decode(match[1]!) : null;
}

export function classesOf(node: MarkupNode): string[] {
  return (attr(node, 'class') ?? '').split(/\s+/).filter(Boolean);
}

/** Every element under `node`, depth first, that passes `test`. */
export function findAll(node: MarkupNode, test: (node: MarkupNode) => boolean): MarkupNode[] {
  const found: MarkupNode[] = [];
  const walk = (current: MarkupNode) => {
    for (const child of current.children) {
      if (child.tag === '#text') continue;
      if (test(child)) found.push(child);
      walk(child);
    }
  };
  walk(node);
  return found;
}

/**
 * The display class that wins on this element at `width`: 'hidden',
 * 'table-cell' and so on, or '' when none applies and the element keeps the
 * display it was born with.
 */
export function displayAt(node: MarkupNode, width: Width): string {
  const tokens = classesOf(node);
  let display = '';
  for (const prefix of LAYERS[width]) {
    for (const token of tokens) {
      if (!token.startsWith(prefix)) continue;
      const rest = token.slice(prefix.length);
      if (DISPLAY.has(rest)) display = rest;
    }
  }
  return display;
}

/*
 * How a run of text wraps at a width, for the checks that say a card name
 * wraps on a phone and an amount never does.
 *
 * Looking for the word `truncate` in a class list is not enough, for the same
 * reason that searching the markup for a customer's name is not: a class of
 * `max-sm:truncate` cuts the name short on exactly the width the check is
 * about, and a search for the bare word never sees it. So wrapping is resolved
 * one width at a time, through the same layers as display.
 *
 * white-space and overflow-wrap are inherited, so the element nearest the text
 * that sets one is the one that counts. Hiding overflow is not inherited, and
 * does not need to be: an element that hides what overflows it cuts off
 * everything inside it.
 */
export type Wrapping = {
  /** 'normal' unless something around the text says otherwise. 'nowrap' holds it to one line. */
  whiteSpace: string;
  /**
   * 'normal', 'break-word' or 'anywhere'. Only 'anywhere' lets a word with no
   * spaces in it narrow the column it sits in; 'break-word' breaks it only once
   * the column has already been sized around the whole word.
   */
  overflowWrap: string;
  /** Whether an element around the text hides or scrolls what overflows it, which is half of what `truncate` does. */
  clipped: boolean;
};

type WrapProperty = 'white-space' | 'overflow-wrap' | 'overflow';

export const WRAPPING: Record<string, Partial<Record<WrapProperty, string>>> = {
  'whitespace-normal': { 'white-space': 'normal' },
  'whitespace-nowrap': { 'white-space': 'nowrap' },
  'whitespace-pre': { 'white-space': 'pre' },
  'whitespace-pre-line': { 'white-space': 'pre-line' },
  'whitespace-pre-wrap': { 'white-space': 'pre-wrap' },
  'whitespace-break-spaces': { 'white-space': 'break-spaces' },
  'wrap-normal': { 'overflow-wrap': 'normal' },
  'break-normal': { 'overflow-wrap': 'normal' },
  'wrap-break-word': { 'overflow-wrap': 'break-word' },
  'break-words': { 'overflow-wrap': 'break-word' },
  'wrap-anywhere': { 'overflow-wrap': 'anywhere' },
  truncate: { 'white-space': 'nowrap', overflow: 'hidden' },
  'overflow-hidden': { overflow: 'hidden' },
  'overflow-x-hidden': { overflow: 'hidden' },
  'overflow-clip': { overflow: 'clip' },
  'overflow-x-clip': { overflow: 'clip' },
  'overflow-auto': { overflow: 'auto' },
  'overflow-x-auto': { overflow: 'auto' },
  'overflow-scroll': { overflow: 'scroll' },
  'overflow-x-scroll': { overflow: 'scroll' },
  'overflow-visible': { overflow: 'visible' },
  'overflow-x-visible': { overflow: 'visible' },
};

/** What one class sets, an arbitrary property such as `[overflow-wrap:anywhere]` included. */
function wrappingOf(name: string): Partial<Record<WrapProperty, string>> | undefined {
  const arbitrary = /^\[(white-space|overflow-wrap|overflow-x|overflow):([^\]]+)\]$/.exec(name);
  if (arbitrary) {
    const property = (arbitrary[1] === 'overflow-x' ? 'overflow' : arbitrary[1]) as WrapProperty;
    return { [property]: arbitrary[2]! };
  }
  return WRAPPING[name];
}

/** The value this element's own classes give `property` at `width`, or '' when none does. */
function ownAt(node: MarkupNode, width: Width, property: WrapProperty): string {
  const tokens = classesOf(node);
  let value = '';
  for (const prefix of LAYERS[width]) {
    for (const token of tokens) {
      if (!token.startsWith(prefix)) continue;
      const set = wrappingOf(token.slice(prefix.length))?.[property];
      if (set !== undefined) value = set;
    }
  }
  return value;
}

/**
 * How the text at the end of `path` wraps at `width`. The path runs from the
 * outermost element that could affect it inwards, the way runsAt hands it back.
 */
export function wrapAt(path: readonly MarkupNode[], width: Width): Wrapping {
  const wrapping: Wrapping = { whiteSpace: 'normal', overflowWrap: 'normal', clipped: false };
  for (const node of path) {
    wrapping.whiteSpace = ownAt(node, width, 'white-space') || wrapping.whiteSpace;
    wrapping.overflowWrap = ownAt(node, width, 'overflow-wrap') || wrapping.overflowWrap;
    const overflow = ownAt(node, width, 'overflow');
    if (overflow && overflow !== 'visible') wrapping.clipped = true;
  }
  return wrapping;
}

/** One run of text drawn at a width, and the elements it sits in, outermost first. */
export type TextRun = { text: string; path: MarkupNode[] };

/**
 * Every run of text drawn under `root` at `width`, in order, each with the
 * elements from `root` in to it. `root` is the first of them, so a class on the
 * table counts as much as one on the cell.
 */
export function runsAt(root: MarkupNode, width: Width): TextRun[] {
  const runs: TextRun[] = [];
  const walk = (node: MarkupNode, path: MarkupNode[]) => {
    if (node.tag === '#text') {
      const text = node.text.replace(/\s+/g, ' ').trim();
      if (text) runs.push({ text, path });
      return;
    }
    if (!shownAt(node, width)) return;
    const inner = node.tag === '#root' ? path : [...path, node];
    node.children.forEach((child) => walk(child, inner));
  };
  walk(root, []);
  return runs;
}

/** Whether this element itself is drawn at `width`. Its ancestors are the caller's to ask about. */
export function shownAt(node: MarkupNode, width: Width): boolean {
  return node.tag === '#text' || displayAt(node, width) !== 'hidden';
}

/** The words displayed inside `node` at `width`, with one space between separate runs of text. */
export function textAt(node: MarkupNode, width: Width): string {
  const parts: string[] = [];
  const walk = (current: MarkupNode) => {
    if (current.tag === '#text') {
      parts.push(current.text);
      return;
    }
    if (!shownAt(current, width)) return;
    current.children.forEach(walk);
  };
  walk(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * What a cell displays at `width`, one entry per child it draws: a run of
 * text, or an element's whole text. Blank entries are dropped. A stacked cell
 * reads as its lines, and a cell whose phone-only lines are hidden reads as one.
 */
export function partsAt(node: MarkupNode, width: Width): string[] {
  return node.children
    .filter((child) => shownAt(child, width))
    .map((child) => (child.tag === '#text' ? child.text.replace(/\s+/g, ' ').trim() : textAt(child, width)))
    .filter(Boolean);
}

/** The first table inside the scrolling region named `label`, or null. */
export function tableIn(html: string, label: string): MarkupNode | null {
  const region = findAll(
    parseMarkup(html),
    (node) => attr(node, 'role') === 'region' && attr(node, 'aria-label') === label,
  )[0];
  return region ? findAll(region, (node) => node.tag === 'table')[0] ?? null : null;
}

/** The rows of one part of a table. */
export function rowsIn(table: MarkupNode, part: 'thead' | 'tbody' | 'tfoot'): MarkupNode[] {
  return table.children
    .filter((child) => child.tag === part)
    .flatMap((section) => section.children.filter((child) => child.tag === 'tr'));
}

/** The cells of a row that are drawn at `width`. */
export function cellsAt(row: MarkupNode, width: Width): MarkupNode[] {
  return row.children.filter((child) => (child.tag === 'td' || child.tag === 'th') && shownAt(child, width));
}

/** How many columns a row takes up at `width`: its drawn cells, each counted by its span. */
export function columnsAt(row: MarkupNode, width: Width): number {
  return cellsAt(row, width).reduce((sum, cell) => sum + Number(attr(cell, 'colspan') ?? '1'), 0);
}
