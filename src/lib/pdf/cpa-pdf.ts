/**
 * The rate card, typeset for printing.
 *
 * The spreadsheet is for working in and the CSV is for feeding a tool. This one
 * is for the third thing people do with a rate card, which is take it into a
 * room: print it, attach it to an email, read it on a phone. So it is laid out
 * as a document rather than as a grid, and it keeps the one shape the page on
 * screen has, which is that a card is the unit and its tiers hang under it.
 *
 * Landscape, because eight columns of money on a portrait page is eight narrow
 * columns. Helvetica and two greys, because a rate card that tries to look like
 * a brochure ends up looking like neither.
 *
 * What it will not do is leak. The rows arrive already cut to what the reader
 * may see (`ratesForViewer`), so an affiliate's copy has no merchant column to
 * draw and no header for one: there is nothing here that decides who sees what.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatDay, formatMoney, formatPercent } from '../analytics';
import { describeScope, exportLines, scopeNote, type CpaExportMeta } from '../cpa-export';
import type { CpaGroup } from '../cpa-groups';

const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 40;
const BOTTOM = 52;

/* Ledger's own ink. See globals.css. */
const INK = rgb(0.043, 0.133, 0.224);
const SOFT = rgb(0.2, 0.278, 0.357);
const DIM = rgb(0.42, 0.486, 0.561);
const RULE = rgb(0.929, 0.945, 0.957);
const BAND = rgb(0.957, 0.965, 0.973);
const GOLD = rgb(0.941, 0.706, 0.161);
const ALARM = rgb(0.702, 0.149, 0.118);
const PAPER = rgb(1, 1, 1);

const ROW = 15;
const HEAD = 18;
const BODY = 8.5;

type Column = {
  key: string;
  label: string;
  width: number;
  right: boolean;
  /** The text for a card's own row. Blank on a tiered card, which has no rate. */
  card: (group: CpaGroup) => string;
  /** The text for one tier's row. */
  tier: (line: ReturnType<typeof exportLines>[number]) => string;
  /** Drawn in red, for a rate that has gone down. */
  alarm?: (line: ReturnType<typeof exportLines>[number]) => boolean;
};

const money = (value: number | null) => (value === null ? '-' : formatMoney(value));
const day = (value: string) => (value ? formatDay(value) : '-');
const percent = (value: number | null) =>
  value === null ? '-' : `${value > 0 ? '+' : ''}${formatPercent(value, 2)}`;

/**
 * The columns, at widths that add up to the page.
 *
 * An affiliate's four columns are given the room the merchant's four would have
 * taken rather than left as a narrow table down the left margin: this is their
 * whole rate card, not a redacted copy of somebody else's.
 */
function columnsFor(gross: boolean): Column[] {
  const only = (group: CpaGroup) => (group.tiered ? null : group.rates[0] ?? null);

  const opening: Column[] = [
    {
      key: 'issuer',
      label: 'Issuer',
      width: gross ? 100 : 150,
      right: false,
      card: (group) => group.issuer || '-',
      tier: () => '',
    },
    {
      key: 'card',
      label: 'Card',
      width: gross ? 190 : 300,
      right: false,
      card: (group) => group.card,
      tier: () => '',
    },
    {
      key: 'tier',
      label: 'Tier',
      width: gross ? 45 : 70,
      right: false,
      card: (group) => (group.tiered ? `${group.rates.length}` : '-'),
      tier: (line) => line.tier || '-',
    },
  ];

  const closing: Column[] = [
    {
      key: 'changedOn',
      label: 'Changed',
      width: gross ? 76 : 82,
      right: true,
      card: (group) => day(only(group)?.changedOn ?? ''),
      tier: (line) => day(line.changedOn),
    },
  ];

  if (!gross) {
    return [
      ...opening,
      {
        key: 'affiliate',
        label: 'Potential revenue',
        width: 110,
        right: true,
        card: (group) => money(only(group)?.revenue ?? null),
        tier: (line) => money(line.revenue),
      },
      ...closing,
    ];
  }

  return [
    ...opening,
    {
      key: 'current',
      label: 'Pays now',
      width: 72,
      right: true,
      card: (group) => money(only(group)?.current ?? null),
      tier: (line) => money(line.current),
    },
    {
      key: 'affiliate',
      label: 'Potential revenue',
      width: 92,
      right: true,
      card: (group) => money(only(group)?.revenue ?? null),
      tier: (line) => money(line.revenue),
    },
    {
      key: 'previous',
      label: 'Paid before',
      width: 72,
      right: true,
      card: (group) => money(only(group)?.previous ?? null),
      tier: (line) => money(line.previous),
    },
    {
      key: 'change',
      label: 'Change',
      width: 55,
      right: true,
      card: (group) => percent(only(group)?.change ?? null),
      tier: (line) => percent(line.change),
      alarm: (line) => line.change !== null && line.change < 0,
    },
    ...closing,
  ];
}

/**
 * Text the standard fonts can actually encode.
 *
 * pdf-lib throws rather than substitutes when a glyph is missing from WinAnsi,
 * so one card called "Platinum Card℠" would turn the whole download into a 500.
 * The curly quotes and the dashes are folded on the way past for the house rule
 * about dashes in anything a person reads.
 */
function safe(text: string): string {
  const folded = text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/…/g, '...')
    .replace(/℠/g, '(SM)')
    .replace(/ /g, ' ');
  let out = '';
  for (const character of folded) out += character.charCodeAt(0) > 255 ? '?' : character;
  return out;
}

/** As much of the text as fits, with a full stop trail when it does not. */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  const clean = safe(text);
  if (font.widthOfTextAtSize(clean, size) <= width) return clean;
  let cut = clean;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > width) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}...`;
}

export async function buildCpaPdf(groups: CpaGroup[], meta: CpaExportMeta): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const columns = columnsFor(meta.gross);
  const lines = exportLines(groups, meta.sort);
  const byCard = new Map<string, typeof lines>();
  for (const line of lines) {
    const key = `${line.issuer}|${line.card}`;
    const found = byCard.get(key);
    if (found) found.push(line);
    else byCard.set(key, [line]);
  }

  const pages: PDFPage[] = [];
  let page = start();
  let y = header(page);

  function start(): PDFPage {
    const made = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(made);
    return made;
  }

  /** The heading block, and where the table may begin under it. */
  function header(target: PDFPage): number {
    const first = pages.length === 1;
    const top = PAGE_H - MARGIN;

    if (first) {
      // The mark in the corner. Gold is a rule and never type.
      target.drawRectangle({ x: MARGIN, y: top - 6, width: 34, height: 3, color: GOLD });
      target.drawText(safe('Commission per approvals'), {
        x: MARGIN,
        y: top - 32,
        size: 17,
        font: bold,
        color: INK,
      });

      const asAt = meta.reportDate
        ? `Rates as at ${formatDay(meta.reportDate)}`
        : 'Rates as uploaded';
      target.drawText(fit(`${asAt} · ${describeScope(groups, meta)}`, body, 9, PAGE_W - MARGIN * 2), {
        x: MARGIN,
        y: top - 48,
        size: 9,
        font: body,
        color: SOFT,
      });
      target.drawText(fit(scopeNote(meta), body, 9, PAGE_W - MARGIN * 2), {
        x: MARGIN,
        y: top - 62,
        size: 9,
        font: body,
        color: DIM,
      });
      return top - 82;
    }

    // Later pages carry the name and nothing else. The heading is context for
    // the first page; repeating all of it would cost four rows a page.
    target.drawText(safe('Commission per approvals'), {
      x: MARGIN,
      y: top - 10,
      size: 9,
      font: bold,
      color: DIM,
    });
    return top - 28;
  }

  /** The column names, on their band. Returns where the first row sits. */
  function columnNames(target: PDFPage, at: number): number {
    target.drawRectangle({
      x: MARGIN,
      y: at - HEAD,
      width: PAGE_W - MARGIN * 2,
      height: HEAD,
      color: INK,
    });
    let x = MARGIN + 8;
    for (const column of columns) {
      const label = fit(column.label, bold, 7.5, column.width - 10);
      const width = bold.widthOfTextAtSize(label, 7.5);
      target.drawText(label, {
        x: column.right ? x + column.width - 16 - width : x,
        y: at - HEAD + 6,
        size: 7.5,
        font: bold,
        color: PAPER,
      });
      x += column.width;
    }
    return at - HEAD;
  }

  /** One line of cells, at `top`, reading the value out of `of`. */
  function draw(target: PDFPage, top: number, of: (column: Column) => { text: string; font: PDFFont; color: ReturnType<typeof rgb> }, indent: number) {
    let x = MARGIN + 8;
    for (const column of columns) {
      const { text, font, color } = of(column);
      if (text) {
        const room = column.width - 10 - (column.right ? 0 : indent);
        const shown = fit(text, font, BODY, room);
        const width = font.widthOfTextAtSize(shown, BODY);
        target.drawText(shown, {
          x: column.right ? x + column.width - 16 - width : x + indent,
          y: top - ROW + 5,
          size: BODY,
          font,
          color,
        });
      }
      x += column.width;
    }
  }

  y = columnNames(page, y);

  for (const [index, group] of groups.entries()) {
    const tiers = group.tiered ? (byCard.get(group.key) ?? []) : [];
    const height = ROW * (1 + tiers.length);

    /*
     * A card is never split across pages. Its name is on the first of its rows,
     * so a break in the middle of one leaves a column of tiers at the top of
     * the next page belonging to nothing in particular.
     */
    if (y - height < BOTTOM) {
      page = start();
      y = columnNames(page, header(page));
    }

    if (index % 2 === 1) {
      page.drawRectangle({
        x: MARGIN,
        y: y - height,
        width: PAGE_W - MARGIN * 2,
        height,
        color: BAND,
      });
    }

    draw(
      page,
      y,
      (column) => ({
        text: column.card(group),
        font: column.key === 'card' ? bold : body,
        color: column.key === 'issuer' ? DIM : INK,
      }),
      0,
    );
    y -= ROW;

    for (const line of tiers) {
      draw(
        page,
        y,
        (column) => ({
          text: column.tier(line),
          font: body,
          color: column.alarm?.(line) ? ALARM : SOFT,
        }),
        // The tier label alone is indented. Every other column on a tier row is
        // either blank or a figure read down a right edge.
        10,
      );
      y -= ROW;
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_W - MARGIN, y },
        thickness: 0.4,
        color: RULE,
      });
    }

    if (tiers.length === 0) {
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_W - MARGIN, y },
        thickness: 0.4,
        color: RULE,
      });
    }
  }

  if (groups.length === 0) {
    page.drawText(safe('No cards match this filter.'), {
      x: MARGIN,
      y: y - 24,
      size: 10,
      font: body,
      color: DIM,
    });
  }

  /*
   * The footers last, because "page 2 of 5" cannot be written until the fifth
   * page exists. The caveat travels with every page for the same reason it sits
   * at the top of the screen: a figure here is what a card pays now, and a page
   * of a rate card is read on its own often enough to matter.
   */
  const caveat =
    'These are the rates as they stand today. An amount can still be revised once an approval has gone through.';
  pages.forEach((sheet, index) => {
    sheet.drawLine({
      start: { x: MARGIN, y: BOTTOM - 14 },
      end: { x: PAGE_W - MARGIN, y: BOTTOM - 14 },
      thickness: 0.5,
      color: RULE,
    });
    sheet.drawText(fit(caveat, body, 7.5, PAGE_W - MARGIN * 2 - 90), {
      x: MARGIN,
      y: BOTTOM - 26,
      size: 7.5,
      font: body,
      color: DIM,
    });
    const stamp = safe(`Page ${index + 1} of ${pages.length}`);
    sheet.drawText(stamp, {
      x: PAGE_W - MARGIN - body.widthOfTextAtSize(stamp, 7.5),
      y: BOTTOM - 26,
      size: 7.5,
      font: body,
      color: DIM,
    });
  });

  pdf.setTitle('Commission per approvals');
  pdf.setSubject(scopeNote(meta));
  pdf.setCreator('Ledger');
  return pdf.save();
}
