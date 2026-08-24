import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFRawStream, decodePDFRawStream, PDFArray } from 'pdf-lib';

const src = await PDFDocument.load(await readFile('C:/Users/salva/Downloads/Launchstone-IRS_Form_W9_2025.pdf'));
for (const [i, page] of src.getPages().entries()) {
  const contents = page.node.Contents();
  let text = '';
  if (contents instanceof PDFRawStream) {
    text = Buffer.from(decodePDFRawStream(contents).decode()).toString('latin1');
  } else if (contents instanceof PDFArray) {
    for (const ref of contents.asArray()) {
      const s = src.context.lookup(ref);
      if (s instanceof PDFRawStream) text += Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
    }
  }
  const all = [...text.matchAll(/\/(X\d+)\s+Do/g)].map((m) => m[1]);
  console.log('page', i + 1, 'ops:', all.join(', ') || 'none', '| stream chars', text.length);
  if (i === 0) console.log(text.slice(0, 220).replace(/\s+/g, ' '));
}
