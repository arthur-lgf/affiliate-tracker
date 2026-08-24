import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const bytes = await readFile('C:/Users/salva/Downloads/Launchstone-IRS_Form_W9_2025.pdf');
console.log('source bytes:', bytes.length);
const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
console.log('pages:', pdf.getPageCount());
pdf.getPages().forEach((p, i) => {
  const { width, height } = p.getSize();
  console.log('  page', i + 1, Math.round(width) + 'x' + Math.round(height), 'rotation', p.getRotation().angle);
});
const asset = await readFile('assets/w9-page1.jpg');
console.log('assets/w9-page1.jpg bytes:', asset.length);
