import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
const dir = 'C:/Users/salva/AppData/Local/Temp/claude/c--Users-salva-Documents-LGF-Projects/9f840379-31e2-4061-98ec-c3302f338a70/scratchpad/pdfout/';
for (const name of ['agreement.pdf', 'w9.pdf']) {
  const bytes = await readFile(dir + name);
  const pdf = await PDFDocument.load(bytes);
  console.log(name, '->', pdf.getPageCount(), 'pages,', Math.round(bytes.length / 1024) + 'KB');
}
