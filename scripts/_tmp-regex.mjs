import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFRawStream, decodePDFRawStream, PDFArray } from 'pdf-lib';

const src = await PDFDocument.load(await readFile('C:/Users/salva/Downloads/Launchstone-IRS_Form_W9_2025.pdf'));
for (const [i, page] of src.getPages().entries()) {
  const contents = page.node.Contents();
  let text = '';
  if (contents instanceof PDFRawStream) text = Buffer.from(decodePDFRawStream(contents).decode()).toString('latin1');
  else if (contents instanceof PDFArray) {
    for (const ref of contents.asArray()) {
      const s = src.context.lookup(ref);
      if (s instanceof PDFRawStream) text += Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
    }
  }
  const m = text.match(/q\s+2550\s+0\s+0\s+-3300\s+0\s+3300\s+cm[\s\S]*?\/(X\d+)\s+Do/);
  console.log('page', i + 1, '->', m ? m[1] : 'NO MATCH');
}
