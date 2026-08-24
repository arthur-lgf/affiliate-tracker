/**
 * The signed agreement, typeset.
 *
 * Unlike the W-9 there is no form to stamp — the source is a Word document, so
 * this sets the text itself from lib/agreement.ts. One copy of the wording,
 * read by the page somebody signs and by this; a second copy would be a second
 * copy that can drift, and what drifts would be the terms of a contract.
 *
 * Deliberately plain. Helvetica, one column, a rule under each heading. A PDF
 * that tries to look like a Word document with a letterhead ends up looking
 * like neither, and nothing about this document is improved by decoration.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  CLAUSES,
  clauseText,
  COMPANY,
  PREAMBLE,
  SUMMARY,
  SUMMARY_INTRO,
} from '../agreement';
import type { AgreementRecord } from '../onboarding-store';
import { isDrawablePng } from './png';

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 64;
const WIDTH = PAGE_W - MARGIN * 2;

const INK = rgb(0.043, 0.133, 0.224);
const DIM = rgb(0.2, 0.28, 0.36);
const RULE = rgb(0.78, 0.82, 0.86);

/**
 * A cursor down the document that starts a new page when it runs out of room.
 *
 * Written as a small class rather than threaded through twenty function calls,
 * because "which page am I on and how far down" is exactly the state that gets
 * out of step when it is passed around by hand.
 */
class Flow {
  pdf: PDFDocument;
  page: PDFPage;
  y: number;
  body: PDFFont;
  bold: PDFFont;
  italic: PDFFont;

  constructor(pdf: PDFDocument, body: PDFFont, bold: PDFFont, italic: PDFFont) {
    this.pdf = pdf;
    this.body = body;
    this.bold = bold;
    this.italic = italic;
    this.page = pdf.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  /** Room for `height` more, or a fresh page. */
  need(height: number) {
    if (this.y - height >= MARGIN) return;
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  gap(height: number) {
    this.y -= height;
  }

  /** Greedy wrap. Long enough for a legal paragraph, simple enough to trust. */
  lines(text: string, font: PDFFont, size: number, width = WIDTH): string[] {
    const out: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      // A single word wider than the column would loop forever; let it overhang.
      line = word;
    }
    if (line) out.push(line);
    return out;
  }

  paragraph(
    text: string,
    { font = this.body, size = 9.5, leading = 12.5, color = DIM, indent = 0, width = WIDTH } = {},
  ) {
    for (const line of this.lines(text, font, size, width - indent)) {
      this.need(leading);
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y - size,
        size,
        font,
        color,
      });
      this.y -= leading;
    }
  }

  heading(text: string) {
    this.need(26);
    this.gap(6);
    this.paragraph(text, { font: this.bold, size: 10, leading: 13, color: INK });
    this.gap(2);
  }

  rule() {
    this.need(8);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.5,
      color: RULE,
    });
    this.y -= 8;
  }

  /** A label and its value, side by side, the way the .docx sets the parties. */
  field(label: string, value: string) {
    const labelWidth = 120;
    const lines = this.lines(value || 'None', this.bold, 10, WIDTH - labelWidth);
    this.need(lines.length * 13 + 4);
    this.page.drawText(label, { x: MARGIN, y: this.y - 10, size: 9, font: this.body, color: DIM });
    lines.forEach((line, index) => {
      this.page.drawText(line, {
        x: MARGIN + labelWidth,
        y: this.y - 10 - index * 13,
        size: 10,
        font: this.bold,
        color: INK,
      });
    });
    this.y -= lines.length * 13 + 4;
  }
}

export async function renderAgreementPdf(record: AgreementRecord): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const flow = new Flow(pdf, body, bold, italic);

  // ---- Title -------------------------------------------------------------
  flow.paragraph('AFFILIATE AGREEMENT', { font: bold, size: 15, leading: 19, color: INK });
  flow.paragraph(`Between ${COMPANY.name} and ${record.affiliateName}`, {
    size: 10,
    leading: 14,
  });
  flow.rule();

  // ---- The parties -------------------------------------------------------
  flow.field('Effective Date', record.effectiveDate);
  flow.field('Company', COMPANY.name);
  flow.field('Affiliate', record.affiliateName);
  flow.field('Affiliate Email', record.affiliateEmail);
  flow.field('Affiliate Address', record.affiliateAddress);
  flow.rule();

  // ---- Summary table -----------------------------------------------------
  flow.heading('AGREEMENT SUMMARY');
  flow.paragraph(SUMMARY_INTRO);
  flow.gap(4);
  for (const row of SUMMARY) {
    flow.need(20);
    flow.paragraph(row.term, { font: bold, size: 9.5, leading: 12, color: INK });
    flow.paragraph(row.details, { indent: 12 });
    flow.gap(4);
  }

  flow.gap(4);
  flow.paragraph(PREAMBLE);

  // ---- The clauses -------------------------------------------------------
  for (const clause of CLAUSES) {
    flow.heading(`${clause.n}. ${clause.title}`);
    for (const para of clause.paras) {
      flow.paragraph(clauseText(para));
      flow.gap(3);
    }
  }

  // ---- Signatures --------------------------------------------------------
  flow.need(190);
  flow.gap(14);
  flow.rule();
  flow.heading('SIGNATURES');

  // Company side. Left as ruled blanks where nothing is configured, rather
  // than printed as empty strings that read like an oversight.
  flow.paragraph('Company', { font: bold, size: 9.5, leading: 13, color: INK });
  flow.paragraph(COMPANY.name, { size: 10, leading: 14, color: INK });
  // Always a ruled blank: the company countersigns its copy, not this one.
  flow.field('Signature', '________________________________');
  flow.field('Name', COMPANY.signatoryName || '________________________________');
  flow.field('Title', COMPANY.signatoryTitle || '________________________________');
  flow.field('Date', '________________________________');

  flow.gap(10);
  flow.paragraph('Affiliate', { font: bold, size: 9.5, leading: 13, color: INK });

  // See the note in w9-pdf.ts: a malformed PNG can hang the decoder, so the
  // header is checked before pdf-lib ever sees it.
  if (isDrawablePng(record.signaturePng)) {
    try {
      const png = await pdf.embedPng(record.signaturePng);
      const maxW = 200;
      const maxH = 46;
      const scale = Math.min(maxW / png.width, maxH / png.height);
      flow.need(png.height * scale + 12);
      flow.page.drawImage(png, {
        x: MARGIN + 120,
        y: flow.y - png.height * scale,
        width: png.width * scale,
        height: png.height * scale,
      });
      flow.page.drawText('Signature', {
        x: MARGIN,
        y: flow.y - png.height * scale + 4,
        size: 9,
        font: body,
        color: DIM,
      });
      flow.y -= png.height * scale + 6;
      flow.page.drawLine({
        start: { x: MARGIN + 120, y: flow.y + 2 },
        end: { x: MARGIN + 120 + maxW, y: flow.y + 2 },
        thickness: 0.5,
        color: RULE,
      });
      flow.y -= 8;
    } catch {
      flow.field('Signature', '________________________________');
    }
  } else {
    flow.field('Signature', '________________________________');
  }

  flow.field('Name', record.affiliateName);
  flow.field('Date', (record.signedAt || '').slice(0, 10));

  // ---- The audit line ----------------------------------------------------
  /*
   * What makes an electronic signature stand up under ESIGN and UETA is being
   * able to show who signed, when, and that they meant to. Printing it on the
   * document means the evidence travels with the copy rather than living only
   * in a database somebody would have to be asked to query.
   */
  flow.gap(10);
  flow.rule();
  flow.paragraph(
    `Signed electronically on ${record.signedAt} from ${record.signedIp || 'an unrecorded address'}. ` +
      `The signer affirmed intent to sign. Agreement version ${record.agreementVersion}. ` +
      `Browser: ${record.signedUserAgent || 'not recorded'}.`,
    { size: 7.5, leading: 10 },
  );

  return await pdf.save();
}
