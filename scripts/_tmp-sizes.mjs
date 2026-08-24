import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFRawStream, PDFDict, decodePDFRawStream } from 'pdf-lib';
import sharp from 'sharp';

const src = await PDFDocument.load(await readFile('C:/Users/salva/Downloads/Launchstone-IRS_Form_W9_2025.pdf'));

function drawnName(page) {
  const contents = page.node.Contents();
  const stream = contents instanceof PDFRawStream ? contents : null;
  if (!stream) return null;
  const text = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  const m = text.match(/\/(X\d+)\s+Do/);
  return m ? m[1] : null;
}

for (const [i, page] of src.getPages().entries()) {
  const want = drawnName(page);
  const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  let bytes = null;
  for (const [name, ref] of xobjects.entries()) {
    if (name.asString() !== '/' + want) continue;
    bytes = Buffer.from(src.context.lookup(ref).getContents());
  }
  console.log('page', i + 1, 'draws', want, 'raw', bytes ? Math.round(bytes.length / 1024) + 'KB' : '?');
  if (!bytes || i === 0) continue;
  for (const [w, q] of [[1275, 72], [1275, 62], [1100, 70], [1000, 70]]) {
    const out = await sharp(bytes).resize({ width: w }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
    console.log('   ' + w + 'px q' + q + ': ' + Math.round(out.length / 1024) + 'KB');
  }
}
