// Cut the six pages of the blank Form W-9 out of the IRS scan and into assets/.
//
// Run this once per form revision, not per build. The application reads the
// six JPEGs; it never reads the source PDF, which is 5MB of 200dpi scan and
// has no business in a deployment bundle.
//
//   npx tsx scripts/prepare-w9-assets.ts "C:/path/to/IRS_Form_W9.pdf"
//
// About the source. It is a print of a document viewer rather than the IRS
// original: every page draws three consecutive page images stacked vertically
// and clips to the one in the middle of the band, and every page carries a
// "View Document 2/6" footer painted on top. Copying the pages wholesale would
// carry that footer into every affiliate's signed W-9, so this takes the image
// each page actually shows and leaves the furniture behind.
//
// Page 1 is written byte for byte. The coordinates in lib/pdf/w9-pdf.ts were
// measured against that exact scan at native resolution, so re-encoding it
// would move every box on the form by an unknown amount. Pages 2 to 6 are
// instructions with nothing stamped on them, so they are downsampled to 150dpi
// to keep a W-9 download around 2MB rather than 5MB.
//
// sharp is used for the downsampling and is deliberately not a dependency of
// this project: it arrives with Next.js, it is needed only by this script, and
// nothing at runtime should be resizing anything.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';

/** 1275px across a US Letter page is 150dpi: readable in print, a third of
 *  the bytes of the 200dpi original. */
const INSTRUCTION_WIDTH = 1275;
const INSTRUCTION_QUALITY = 72;

const source = process.argv[2];
if (!source) {
  console.error('Usage: npx tsx scripts/prepare-w9-assets.ts <path-to-w9.pdf>');
  process.exit(1);
}

/** Everything a page's content stream says, however it is stored. */
function contentOf(pdf: PDFDocument, page: ReturnType<PDFDocument['getPages']>[number]): string {
  const contents = page.node.Contents();
  if (contents instanceof PDFRawStream) {
    return Buffer.from(decodePDFRawStream(contents).decode()).toString('latin1');
  }
  if (contents instanceof PDFArray) {
    let text = '';
    for (const ref of contents.asArray()) {
      const stream = pdf.context.lookup(ref);
      if (stream instanceof PDFRawStream) {
        text += Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
      }
    }
    return text;
  }
  return '';
}

/**
 * The one image this page actually shows.
 *
 * The resource dictionary lists the neighbours too, so picking the first entry
 * gives you page 3's instructions on page 2. What identifies the visible one is
 * its placement: drawn full width at the top of the clip band, `0 3300 cm`.
 */
function visibleImageName(content: string): string | null {
  const match = content.match(/q\s+2550\s+0\s+0\s+-3300\s+0\s+3300\s+cm[\s\S]*?\/(X\d+)\s+Do/);
  return match ? match[1]! : null;
}

function jpegFor(pdf: PDFDocument, page: ReturnType<PDFDocument['getPages']>[number], name: string): Buffer {
  const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  if (!xobjects) throw new Error(`no XObject dictionary on the page holding ${name}`);
  for (const [key, ref] of xobjects.entries()) {
    if (key.asString() !== `/${name}`) continue;
    const stream = pdf.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) throw new Error(`${name} is not a raw stream`);
    const filter = String(stream.dict.get(PDFName.of('Filter')));
    // DCTDecode means the stream *is* a JPEG file, so it can be written out as
    // one without an encoder in the middle.
    if (!filter.includes('DCTDecode')) throw new Error(`${name} is ${filter}, not a JPEG`);
    return Buffer.from(stream.getContents());
  }
  throw new Error(`${name} is not in the resources of the page that draws it`);
}

async function main() {
  const bytes = await readFile(source!);
  const pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages();
  console.log(`${path.basename(source!)}: ${pages.length} pages, ${Math.round(bytes.length / 1024)}KB`);
  if (pages.length !== 6) {
    console.warn(`Expected the six-page W-9. Carrying on with ${pages.length}.`);
  }

  const outDir = path.join(process.cwd(), 'assets');
  await mkdir(outDir, { recursive: true });

  let sharp: typeof import('sharp') | null = null;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('This needs sharp for the downsampling. Try: npm i -D sharp');
    process.exit(1);
  }

  for (const [index, page] of pages.entries()) {
    const name = visibleImageName(contentOf(pdf, page));
    if (!name) {
      console.error(`page ${index + 1}: could not tell which image it shows. Skipped.`);
      continue;
    }
    const raw = jpegFor(pdf, page, name);
    const file = path.join(outDir, `w9-page${index + 1}.jpg`);

    if (index === 0) {
      const existing = await readFile(file).catch(() => null);
      if (existing && Buffer.compare(existing, raw) !== 0) {
        console.warn(
          'page 1 differs from the scan already in assets/. Every coordinate in ' +
            'lib/pdf/w9-pdf.ts was measured against the old one, so check the ' +
            'stamped output before trusting it.',
        );
      }
      await writeFile(file, raw);
      console.log(`page 1: ${name}, ${Math.round(raw.length / 1024)}KB, written as-is`);
      continue;
    }

    const shrunk = await sharp(raw)
      .resize({ width: INSTRUCTION_WIDTH })
      .jpeg({ quality: INSTRUCTION_QUALITY, mozjpeg: true })
      .toBuffer();
    await writeFile(file, shrunk);
    console.log(
      `page ${index + 1}: ${name}, ${Math.round(raw.length / 1024)}KB -> ` +
        `${Math.round(shrunk.length / 1024)}KB at ${INSTRUCTION_WIDTH}px`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
