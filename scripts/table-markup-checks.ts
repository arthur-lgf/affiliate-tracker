// The way table-markup reads a class list, held to the stylesheet Tailwind
// actually writes for it.
//
// The render checks for the card tables never open a browser. They ask
// table-markup what a phone, a laptop and a sheet of paper would show, and it
// answers from the class names alone: which variants apply at a width, and
// which of two wins when both do. The second half is a claim about the order
// Tailwind writes its rules in, plain utilities first, then the breakpoints,
// then print. Nothing in those checks reads a stylesheet, so if a Tailwind
// upgrade, a moved breakpoint or a custom variant ever changed that order,
// every "hidden below sm, back on paper" check would stay green while a browser
// drew something else.
//
// So this compiles the app's own stylesheet, src/app/globals.css, through the
// Tailwind that is installed, once the way `next dev` writes it and once the
// way `next build` does, and plays out the cascade in it: which rules apply at
// a width, and which of them is written last. Then it asks table-markup the
// same question for every class it understands, alone and mixed across the
// variants it knows, and the two have to agree.
//
// A rule for one of those classes that this cannot read, because it sits under
// a condition other than a width or print, is marked !important, or is on a
// selector other than the bare class, fails here rather than being skipped. A
// rule skipped is a rule table-markup might be wrong about.
//
//   npx tsx scripts/table-markup-checks.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import postcss, { type AtRule, type Container, type Document } from 'postcss';
import { DISPLAY, displayAt, LAYERS, parseMarkup, WRAPPING, wrapAt, type MarkupNode, type Width } from './table-markup';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name, extra === undefined ? '' : extra);
  }
}

/* ------------------------------------------------------------- the widths --- */

type Environment = { medium: 'screen' | 'print'; width: number };

const WIDTHS = Object.keys(LAYERS) as Width[];

/*
 * Where each reading is taken. Two for each, and where a reading has sm's 640
 * CSS pixels as an edge, one of the two sits right against it, so a breakpoint
 * that moves by a single pixel is caught there rather than somewhere safely in
 * the middle.
 */
const AT: Record<Width, readonly Environment[]> = {
  phone: [
    { medium: 'screen', width: 320 },
    { medium: 'screen', width: 639 },
  ],
  desktop: [
    { medium: 'screen', width: 640 },
    { medium: 'screen', width: 1440 },
  ],
  'print-narrow': [
    { medium: 'print', width: 420 },
    { medium: 'print', width: 639 },
  ],
  'print-wide': [
    { medium: 'print', width: 640 },
    { medium: 'print', width: 816 },
  ],
};

const said = (at: Environment) => `${at.medium} at ${at.width}px`;

/* --------------------------------------------------- the classes and rules --- */

const PREFIXES = [...new Set(Object.values(LAYERS).flat())];
const UNDERSTOOD = [...DISPLAY, ...Object.keys(WRAPPING)];
const CANDIDATES = PREFIXES.flatMap((prefix) => UNDERSTOOD.map((name) => prefix + name));

/** The variant a class is written under: 'sm:' for 'sm:hidden', '' for 'hidden'. */
function prefixOf(name: string): string {
  const longestFirst = [...PREFIXES].sort((a, b) => b.length - a.length);
  return longestFirst.find((prefix) => name.startsWith(prefix) && UNDERSTOOD.includes(name.slice(prefix.length))) ?? '';
}

/**
 * The stylesheet, compiled from the app's own CSS so that its theme, its
 * breakpoints and any variant it defines are all in it. The classes read here
 * are handed to Tailwind directly, because scripts/ is kept out of what it
 * scans and the app itself uses only some of them.
 */
async function compile(optimize: boolean): Promise<string> {
  /* Run from the repository root, like every other check here. */
  const from = path.join(process.cwd(), 'src', 'app', 'globals.css');
  const source = `${readFileSync(from, 'utf8')}\n@source inline("${CANDIDATES.join(' ')}");\n`;
  const result = await postcss([tailwindcss({ base: process.cwd(), optimize })]).process(source, { from });
  return result.css;
}

type Written = {
  /** The class, unescaped: 'sm:hidden'. */
  name: string;
  /** Its place in the stylesheet. Of two rules that both apply, the higher one wins. */
  order: number;
  /** The @layer it sits in, '' for none. */
  layer: string;
  /** The condition of every @media around it, all of which have to hold. */
  media: string[];
  declarations: { property: string; value: string }[];
};

/** Every rule written for a class table-markup reads, and a line for each that cannot be read. */
function rulesIn(css: string): { rules: Written[]; unreadable: string[] } {
  const wanted = new Set(CANDIDATES);
  const rules: Written[] = [];
  const unreadable: string[] = [];
  let order = 0;
  postcss.parse(css).walkRules((rule) => {
    order++;
    for (const selector of rule.selectors) {
      const names = [...selector.matchAll(/\.((?:\\.|[\w-])+)/g)].map((match) => match[1]!.replace(/\\(.)/g, '$1'));
      const ours = names.filter((name) => wanted.has(name));
      if (ours.length === 0) continue;
      if (ours.length !== 1 || !/^\.(?:\\.|[\w-])+$/.test(selector.trim())) {
        unreadable.push(`${selector}: not the bare class`);
        continue;
      }
      const media: string[] = [];
      const layers: string[] = [];
      let readable = true;
      let parent: Container | Document | undefined = rule.parent;
      for (; parent && parent.type !== 'root' && parent.type !== 'document'; parent = parent.parent) {
        const at = parent as AtRule;
        if (parent.type === 'atrule' && at.name === 'media') media.push(at.params);
        else if (parent.type === 'atrule' && at.name === 'layer') layers.unshift(at.params);
        else {
          unreadable.push(`${selector}: inside ${parent.type === 'atrule' ? `@${at.name} ${at.params}` : parent.type}`);
          readable = false;
        }
      }
      const declarations: Written['declarations'] = [];
      rule.each((node) => {
        if (node.type !== 'decl') return;
        if (node.important) {
          unreadable.push(`${selector}: ${node.prop} is !important`);
          readable = false;
        }
        declarations.push({ property: node.prop, value: node.value });
      });
      if (readable) rules.push({ name: ours[0]!, order, layer: layers.join('.'), media, declarations });
    }
  });
  return { rules, unreadable };
}

/* ------------------------------------------------------------ @media, read --- */

/* A rem in a media query is the browser's own default font size, never the page's. */
const PX_PER_REM = 16;

function lengthOf(text: string): number {
  const match = /^(\d*\.?\d+)(px|rem|em)$/.exec(text);
  if (!match) throw new Error(`a length this check cannot read: ${text}`);
  return Number(match[1]) * (match[2] === 'px' ? 1 : PX_PER_REM);
}

function featureHolds(feature: string, at: Environment): boolean {
  const text = feature.replace(/\s+/g, '');
  const old = /^(min|max)-width:(.+)$/.exec(text);
  if (old) return old[1] === 'min' ? at.width >= lengthOf(old[2]!) : at.width <= lengthOf(old[2]!);
  const range = /^width(>=|<=|>|<|=)(.+)$/.exec(text);
  if (range) {
    const edge = lengthOf(range[2]!);
    if (range[1] === '>=') return at.width >= edge;
    if (range[1] === '<=') return at.width <= edge;
    if (range[1] === '>') return at.width > edge;
    if (range[1] === '<') return at.width < edge;
    return at.width === edge;
  }
  throw new Error(`a media feature this check cannot read: (${feature})`);
}

/**
 * Whether one @media condition holds. Written for the forms Tailwind produces,
 * `(width >= 40rem)` as it compiles and `not all and (min-width:40rem)` once it
 * is optimized, and `print`, and it throws on anything else rather than guess.
 */
function mediaHolds(params: string, at: Environment): boolean {
  return params.split(',').some((query) => {
    const parts = query.trim().toLowerCase().split(/\s+and\s+/);
    let negated = false;
    let holds = true;
    const head = /^(?:(not|only)\s+)?(all|screen|print)$/.exec(parts[0]!);
    if (head) {
      negated = head[1] === 'not';
      holds = head[2] === 'all' || head[2] === at.medium;
      parts.shift();
    }
    for (const part of parts) {
      const inner = /^\((.*)\)$/.exec(part);
      if (!inner) throw new Error(`a media query this check cannot read: ${query.trim()}`);
      /* Read every feature, even once the answer is known, so one it cannot read is never skipped. */
      const feature = featureHolds(inner[1]!, at);
      holds = holds && feature;
    }
    return negated ? !holds : holds;
  });
}

/* -------------------------------------------------------- the two readings --- */

/** The value the stylesheet gives one of `properties` on an element carrying `classes`, or undefined. */
function cascade(rules: readonly Written[], classes: readonly string[], at: Environment, properties: readonly string[]) {
  let value: string | undefined;
  for (const rule of rules) {
    if (!classes.includes(rule.name) || !rule.media.every((params) => mediaHolds(params, at))) continue;
    for (const declaration of rule.declarations) {
      if (properties.includes(declaration.property)) value = declaration.value;
    }
  }
  return value;
}

function element(classes: readonly string[]): MarkupNode {
  return parseMarkup(`<div class="${classes.join(' ')}">text</div>`).children[0]!;
}

type Reading = {
  name: string;
  /** The CSS properties that answer it. overflow-x counts with overflow, as table-markup counts it. */
  properties: readonly string[];
  /** A few classes that set it, mixed one per variant in every combination. */
  mix: readonly string[];
  /** Every class table-markup reads it from, each tried on its own under every variant. */
  alone: readonly string[];
  harness: (node: MarkupNode, width: Width) => string;
  /** The stylesheet's value in table-markup's terms. */
  stylesheet: (value: string | undefined) => string;
};

const setting = (property: 'white-space' | 'overflow-wrap' | 'overflow') =>
  Object.keys(WRAPPING).filter((name) => WRAPPING[name]![property] !== undefined);

const READINGS: readonly Reading[] = [
  {
    name: 'display',
    properties: ['display'],
    mix: ['hidden', 'block', 'table-cell', 'table-row-group'],
    alone: [...DISPLAY],
    harness: (node, width) => displayAt(node, width),
    stylesheet: (value) => (value === undefined ? '' : value === 'none' ? 'hidden' : value),
  },
  {
    name: 'white-space',
    properties: ['white-space'],
    mix: ['whitespace-normal', 'whitespace-nowrap', 'truncate'],
    alone: setting('white-space'),
    harness: (node, width) => wrapAt([node], width).whiteSpace,
    stylesheet: (value) => value ?? 'normal',
  },
  {
    name: 'overflow-wrap',
    properties: ['overflow-wrap'],
    mix: ['wrap-normal', 'wrap-break-word', 'wrap-anywhere'],
    alone: setting('overflow-wrap'),
    harness: (node, width) => wrapAt([node], width).overflowWrap,
    stylesheet: (value) => value ?? 'normal',
  },
  {
    /* Mixed only through the shorthand. Setting overflow-x on its own beside a
       hidden overflow makes the browser scroll rather than show, a case
       table-markup does not model and none of the tables uses; each overflow-x
       class is still tried alone. */
    name: 'clipping',
    properties: ['overflow', 'overflow-x'],
    mix: ['overflow-hidden', 'overflow-visible', 'truncate'],
    alone: setting('overflow'),
    harness: (node, width) => String(wrapAt([node], width).clipped),
    stylesheet: (value) => String(value !== undefined && value !== 'visible'),
  },
];

/** Every class list with at most one of `names` under each variant, the empty list included. */
function mixes(prefixes: readonly string[], names: readonly string[]): string[][] {
  if (prefixes.length === 0) return [[]];
  const [first, ...rest] = prefixes;
  return mixes(rest, names).flatMap((tail) => [tail, ...names.map((name) => [first + name, ...tail])]);
}

/* ------------------------------------------------------------------ checks --- */

async function main() {
  for (const [optimize, how] of [
    [false, 'as `next dev` writes it'],
    [true, 'as `next build` writes it'],
  ] as const) {
    console.log(`\n- the stylesheet, ${how} -`);
    const css = await compile(optimize);
    const { rules, unreadable } = rulesIn(css);
    check(`${how}: it compiled, with rules for the classes read here`, css.length > 0 && rules.length > 0, rules.length);

    const missing = CANDIDATES.filter((name) => !rules.some((rule) => rule.name === name));
    check(`${how}: every class table-markup reads, under every variant, has a rule`, missing.length === 0, missing);

    for (const rule of rules) {
      for (const params of rule.media) {
        try {
          mediaHolds(params, AT.phone[0]!);
        } catch (error) {
          unreadable.push(`${rule.name}: ${(error as Error).message}`);
        }
      }
    }
    check(`${how}: and every one of those rules is one this check can read`, unreadable.length === 0, [...new Set(unreadable)].slice(0, 5));
    if (unreadable.some((line) => line.includes('cannot read'))) {
      /* Past this point every media query gets evaluated, and one that cannot be read would only throw. */
      continue;
    }

    const layers = [...new Set(rules.map((rule) => rule.layer))];
    check(`${how}: all in one @layer, so their order alone settles which wins`, layers.length === 1, layers);

    const byPrefix = (prefix: string) => rules.filter((rule) => prefixOf(rule.name) === prefix);
    const variant = (prefix: string) => prefix || 'the plain utility';

    /* The order table-markup reads the layers in is the order they are written in. */
    for (const width of WIDTHS) {
      const order = LAYERS[width];
      for (let i = 1; i < order.length; i++) {
        const before = byPrefix(order[i - 1]!).map((rule) => rule.order);
        const after = byPrefix(order[i]!).map((rule) => rule.order);
        check(
          `${how}: for ${width}, every rule for ${variant(order[i - 1]!)} is written before every one for ${variant(order[i]!)}`,
          before.length > 0 && after.length > 0 && Math.max(...before) < Math.min(...after),
          { lastBefore: Math.max(...before), firstAfter: Math.min(...after) },
        );
      }
    }

    /* And the variants table-markup applies at a width are exactly the ones whose conditions hold there. */
    for (const width of WIDTHS) {
      for (const at of AT[width]) {
        const applying = PREFIXES.filter((prefix) =>
          byPrefix(prefix).every((rule) => rule.media.every((params) => mediaHolds(params, at))),
        );
        check(
          `${how}: ${said(at)} is read as ${width}, and exactly its variants apply there`,
          JSON.stringify([...applying].sort()) === JSON.stringify([...LAYERS[width]].sort()),
          { applying, expected: LAYERS[width] },
        );
      }
    }

    /* The cascade itself, class list by class list. */
    for (const reading of READINGS) {
      const lists = [
        ...mixes(PREFIXES, reading.mix),
        ...PREFIXES.flatMap((prefix) => reading.alone.map((name) => [prefix + name])),
      ];
      for (const width of WIDTHS) {
        const disagreements: string[] = [];
        for (const classes of lists) {
          const node = element(classes);
          const harness = reading.harness(node, width);
          for (const at of AT[width]) {
            const stylesheet = reading.stylesheet(cascade(rules, classes, at, reading.properties));
            if (harness !== stylesheet) {
              disagreements.push(`"${classes.join(' ')}" on ${said(at)}: table-markup says ${harness || '(none)'}, the stylesheet ${stylesheet || '(none)'}`);
            }
          }
        }
        check(
          `${how}: ${reading.name} read as ${width} agrees with the stylesheet for all ${lists.length} class lists`,
          disagreements.length === 0,
          { disagreements: disagreements.length, first: disagreements.slice(0, 3) },
        );
      }
    }
  }

  console.log(`\ntable-markup: ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

void main();
