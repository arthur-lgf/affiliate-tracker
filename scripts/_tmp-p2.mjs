import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFRawStream, decodePDFRawStream, PDFArray } from 'pdf-lib';

const src = await PDFDocument.load(await readFile('C:/Users/salva/Downloads/Launchstone-IRS_Form_W9_2025.pdf'));
const page = src.getPages()[1];
const contents = page.node.Contents();
let text = '';
if (contents instanceof PDFRawStream) text = Buffer.from(decodePDFRawStream(contents).decode()).toString('latin1');
else if (contents instanceof PDFArray) {
  for (const ref of contents.asArray()) {
    const s = src.context.lookup(ref);
    if (s instanceof PDFRawStream) text += Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
  }
}
console.log(text.replace(/\s+/g, ' '));
