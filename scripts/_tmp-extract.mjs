import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFRawStream, PDFDict } from 'pdf-lib';
import sharp from 'sharp';

const src = await PDFDocument.load(await readFile('C:/Users/salva/Downloads/Launchstone-IRS_Form_W9_2025.pdf'));
for (const [i, page] of src.getPages().entries()) {
  const resources = page.node.Resources();
  const xobjects = resources?.lookup(PDFName.of('XObject'), PDFDict);
  if (!xobjects) { console.log('page', i + 1, 'no xobjects'); continue; }
  for (const [name, ref] of xobjects.entries()) {
    const stream = src.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) { console.log('  not raw:', name.asString()); continue; }
    const dict = stream.dict;
    const filter = dict.get(PDFName.of('Filter'));
    const w = dict.get(PDFName.of('Width'));
    const h = dict.get(PDFName.of('Height'));
    const cs = dict.get(PDFName.of('ColorSpace'));
    const bytes = stream.getContents();
    console.log('page', i + 1, name.asString(), String(filter), w + 'x' + h, 'cs', String(cs), 'bytes', bytes.length);
    if (String(filter).includes('DCTDecode')) {
      const meta = await sharp(Buffer.from(bytes)).metadata();
      console.log('   jpeg meta:', meta.width + 'x' + meta.height, meta.space, 'channels', meta.channels);
    }
  }
}
