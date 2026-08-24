import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const src = await PDFDocument.load(await readFile('C:/Users/salva/Downloads/Launchstone-IRS_Form_W9_2025.pdf'));

const rest = await PDFDocument.create();
const copied = await rest.copyPages(src, [1, 2, 3, 4, 5]);
for (const p of copied) rest.addPage(p);
const restBytes = await rest.save();
console.log('pages 2-6 as their own pdf:', restBytes.length, 'bytes');
await writeFile('scripts/_tmp-w9-rest.pdf', restBytes);

const one = await PDFDocument.create();
const [first] = await one.copyPages(src, [0]);
one.addPage(first);
const oneBytes = await one.save();
console.log('page 1 alone:', oneBytes.length, 'bytes');

const out = await PDFDocument.create();
const all = await out.copyPages(src, [0, 1, 2, 3, 4, 5]);
for (const p of all) out.addPage(p);
console.log('all six re-saved:', (await out.save()).length, 'bytes');
