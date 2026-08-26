// Reading what was actually drawn on a PDF page, for the checks that draw one.
//
// Not a check itself. pdf-lib compresses the content stream, so a PDF cannot be
// searched by looking at its bytes: "the affiliate's copy does not contain the
// merchant's rate" is a claim that has to be made about the decompressed page,
// or it passes for the wrong reason on any file at all.

import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

/**
 * Every page's content stream, decompressed and joined.
 *
 * The drawing operators are left in: what the checks ask is whether a string
 * was drawn at all, and the operator around it does not get in the way of that.
 * What does get in the way is that pdf-lib writes every string as hex rather
 * than in brackets, so a page that plainly says "Platinum Card" contains no
 * such run of bytes. The hex is decoded on the way out, which is the whole
 * reason this helper exists rather than a one-line inflate at the call site.
 */
export async function pdfContent(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  const parts: string[] = [];

  for (const page of pdf.getPages()) {
    const contents = page.node.get(PDFName.of('Contents'));
    const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];

    for (const ref of refs) {
      const stream = pdf.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;
      const raw = Buffer.from(stream.contents);
      try {
        parts.push(inflateSync(raw).toString('latin1'));
      } catch {
        // Not compressed after all, which is legal and which pdf-lib does for
        // a short enough stream.
        parts.push(raw.toString('latin1'));
      }
    }
  }

  return decodeHex(parts.join('\n'));
}

/**
 * `<48656C6C6F>` back into `Hello`.
 *
 * Only even-length runs of hex between single angle brackets, so a dictionary
 * (which opens `<<`) is left alone.
 */
function decodeHex(content: string): string {
  return content.replace(/<([0-9A-Fa-f]+)>/g, (whole, digits: string) =>
    digits.length % 2 === 0 ? Buffer.from(digits, 'hex').toString('latin1') : whole,
  );
}
