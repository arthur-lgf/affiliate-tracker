/**
 * A filled Form W-9, stamped onto the real thing.
 *
 * The source PDF is a scan — six JPEG pages, no text layer, no form fields — so
 * there was nothing to fill in. What there was is a picture of the actual IRS
 * form, and that turns out to be the better artefact: page 1 of the scan goes
 * in as the background and the answers are drawn on top, in the boxes, in a
 * typewriter face. What comes out looks like a W-9 somebody filled in, because
 * it is one.
 *
 * All six pages go in, not just the one with the boxes. Pages 2 to 6 are the
 * IRS instructions, and a W-9 without them is an extract of a form rather than
 * the form: it is what the signer certified they had read, it is what the
 * document says on its face it includes, and somebody filing this away for
 * seven years should be filing the whole thing. They are stamped with nothing
 * and are carried through as scans, at 150dpi rather than the 200dpi of page 1
 * so that a download stays around two megabytes.
 *
 * The coordinates below are measured, not guessed. Every rule and box on the
 * scan was found by scanning the JPEG for dark runs at native resolution
 * (1700x2200 = 200dpi = US Letter) and converting to points, which is why they
 * carry a decimal — 424.6 is where that digit cell actually is, not where it
 * looked like it was.
 *
 * Origin note: everything here is measured from the TOP of the page, because
 * that is how the form reads and how the measurements were taken. pdf-lib
 * measures from the bottom, so `at()` does the subtraction once rather than
 * every call site doing it and one of them getting it wrong.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { digitsOf } from '../mask';
import type { W9Record } from '../onboarding-store';
import { isDrawablePng } from './png';

const PAGE_W = 612;
const PAGE_H = 792;

/** Top-origin y to pdf-lib's bottom-origin y. */
function at(topY: number): number {
  return PAGE_H - topY;
}

const INK = rgb(0.043, 0.133, 0.224);

/* Measured from the scan. See the note above. */
const F = {
  line1: { x: 78, y: 127 },
  line2: { x: 78, y: 151 },
  /** The seven boxes on 3a. Row one sits at y 180, the LLC box one row below. */
  classification: {
    individual: { x: 77, y: 180 },
    c_corp: { x: 184, y: 180 },
    s_corp: { x: 255.4, y: 180 },
    partnership: { x: 326, y: 180 },
    trust_estate: { x: 392.8, y: 180 },
    llc: { x: 77, y: 188 },
    /** "Other" has no box of its own on this scan, only the rule beside it. */
    other: { x: 77, y: 196 },
  } as Record<string, { x: number; y: number }>,
  boxSize: 8.6,
  llcCode: { x: 437, y: 195 },
  otherText: { x: 170, y: 231 },
  exemptPayee: { x: 546, y: 202 },
  fatca: { x: 503, y: 238 },
  foreignPartners: { x: 441.4, y: 261, size: 7 },
  line5: { x: 78, y: 296 },
  line6: { x: 78, y: 320 },
  line7: { x: 78, y: 344 },
  requester: { x: 398, y: 292 },
  /** Nine digit cells, skipping the two the dashes live in. */
  ssnCells: [424.6, 439, 453.4, 482.2, 496.6, 525.4, 539.8, 554.2, 568.6],
  ssnY: 385,
  einCells: [424.6, 439, 467.8, 482.2, 496.6, 511, 525.4, 539.8, 554.2],
  einY: 433,
  // Right of the "Signature of U.S. person" caption, which occupies the left
  // of this band. At x=100 the ink ran straight through the words.
  signature: { x: 165, y: 579, maxW: 195, maxH: 16 },
  date: { x: 420, y: 594 },
};

/** How many pages the blank form runs to. scripts/prepare-w9-assets.ts writes
 *  one JPEG per page; this is the other half of that arrangement. */
const FORM_PAGES = 6;

/**
 * The blank form, read once and held.
 *
 * Two megabytes of JPEG re-read on every download would be two megabytes of
 * disk per request for files that never change. Read from the repo rather than
 * bundled as base64: a megabyte of base64 in a TypeScript file is a megabyte
 * the type checker and the bundler both have to walk on every build.
 */
const scans = new Map<number, Uint8Array>();

async function formImage(page = 1): Promise<Uint8Array> {
  const held = scans.get(page);
  if (held) return held;
  const file = path.join(process.cwd(), 'assets', `w9-page${page}.jpg`);
  const bytes = new Uint8Array(await readFile(file));
  scans.set(page, bytes);
  return bytes;
}

/**
 * The instruction pages, carried through untouched.
 *
 * Page 1 is essential and is allowed to fail loudly: without it there is no
 * form to stamp. These are not. If a deployment ever ships without them, the
 * right outcome is a filled W-9 that is missing its instructions, not an error
 * page where somebody's signed document should have been.
 */
async function appendInstructions(pdf: PDFDocument): Promise<void> {
  for (let number = 2; number <= FORM_PAGES; number++) {
    try {
      const scan = await pdf.embedJpg(await formImage(number));
      const page = pdf.addPage([PAGE_W, PAGE_H]);
      page.drawImage(scan, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    } catch {
      console.warn(`W-9 instruction page ${number} is missing from assets/.`);
      return;
    }
  }
}

/** Draw text, clipped to a width so a long entry cannot run off the form. */
function write(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  topY: number,
  size = 10,
  maxWidth?: number,
) {
  if (!text) return;
  let shown = text;
  if (maxWidth) {
    while (shown.length > 1 && font.widthOfTextAtSize(shown, size) > maxWidth) {
      shown = shown.slice(0, -1);
    }
  }
  page.drawText(shown, { x, y: at(topY), size, font, color: INK });
}

/** The X in a checkbox, centred on the box the scan actually has. */
function tick(page: PDFPage, font: PDFFont, box: { x: number; y: number }, size = 8.6) {
  const glyph = 'X';
  const width = font.widthOfTextAtSize(glyph, size);
  page.drawText(glyph, {
    x: box.x - width / 2,
    // The measured y is the box's top edge; a glyph sits on its baseline, so
    // it drops most of the box height to end up looking centred.
    y: at(box.y + size - 1.4),
    size,
    font,
    color: INK,
  });
}

/**
 * One filled W-9, as PDF bytes.
 *
 * `tin` is passed in rather than read here on purpose. This module never
 * touches the database and never unseals anything — the caller decides that a
 * plaintext taxpayer number is warranted and hands it over, which keeps the
 * decision in one place instead of buried in a rendering function.
 */
export async function renderW9Pdf(form: W9Record, tin: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  const background = await pdf.embedJpg(await formImage());
  page.drawImage(background, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });

  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  write(page, body, form.line1Name, F.line1.x, F.line1.y, 10, 480);
  write(page, body, form.line2Business, F.line2.x, F.line2.y, 10, 480);

  const box = F.classification[form.classification];
  if (box) tick(page, bold, box, F.boxSize);
  if (form.classification === 'llc' && form.llcCode) {
    write(page, body, form.llcCode, F.llcCode.x, F.llcCode.y, 10);
  }
  if (form.classification === 'other' && form.otherText) {
    write(page, body, form.otherText, F.otherText.x, F.otherText.y, 9, 270);
  }

  write(page, body, form.exemptPayeeCode, F.exemptPayee.x, F.exemptPayee.y, 9, 30);
  write(page, body, form.fatcaCode, F.fatca.x, F.fatca.y, 9, 70);

  if (form.foreignPartners) {
    tick(page, bold, { x: F.foreignPartners.x, y: F.foreignPartners.y }, F.foreignPartners.size);
  }

  write(page, body, form.address, F.line5.x, F.line5.y, 10, 300);
  write(page, body, form.cityStateZip, F.line6.x, F.line6.y, 10, 300);
  write(page, body, form.accountNumbers, F.line7.x, F.line7.y, 10, 480);

  // The requester is us, and the form leaves a box for it.
  write(page, body, 'LaunchStone LLC', F.requester.x, F.requester.y, 9, 180);

  /*
   * One digit per cell, centred. This is the part that makes the output read as
   * a real W-9 rather than a form with a number typed near it — the paper form
   * has nine boxes and the eye expects a digit in the middle of each.
   */
  const digits = digitsOf(tin).slice(0, 9).split('');
  const cells = form.tinType === 'ein' ? F.einCells : F.ssnCells;
  const rowY = form.tinType === 'ein' ? F.einY : F.ssnY;
  digits.forEach((digit, index) => {
    const centre = cells[index];
    if (centre === undefined) return;
    const width = mono.widthOfTextAtSize(digit, 11);
    page.drawText(digit, { x: centre - width / 2, y: at(rowY), size: 11, font: mono, color: INK });
  });

  // Checked, not merely try/caught: a malformed PNG can spin pdf-lib's decoder,
  // and a catch block is no defence against a loop.
  if (isDrawablePng(form.signaturePng)) {
    try {
      const png = await pdf.embedPng(form.signaturePng);
      // Fit inside the signature rule without distorting the drawing: whichever
      // of width or height runs out first decides the scale.
      const scale = Math.min(
        F.signature.maxW / png.width,
        F.signature.maxH / png.height,
      );
      page.drawImage(png, {
        x: F.signature.x,
        y: at(F.signature.y + png.height * scale),
        width: png.width * scale,
        height: png.height * scale,
      });
    } catch {
      // A signature that will not decode must not cost the whole document. The
      // rest of the form is still the record of what they filed.
    }
  }

  write(page, body, (form.signedAt || '').slice(0, 10), F.date.x, F.date.y, 10);

  // Last, so that nothing above has to know it is drawing on page 1 of six.
  await appendInstructions(pdf);

  return await pdf.save();
}
