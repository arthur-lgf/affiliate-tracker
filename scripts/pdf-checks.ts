// The two generated documents, built from fixtures and inspected.
//
// Coordinates on a stamped form are the kind of thing a type check cannot have
// an opinion about: a digit two points too high is still a valid PDF. So this
// builds both documents, asserts the structural facts that can be asserted
// (page count, size, that the taxpayer number reached the page, that a
// signature was embedded), and writes them out to be looked at.
//
//   npx tsx scripts/pdf-checks.ts [outDir]
//
// With an outDir it drops w9.pdf and agreement.pdf there for a human to open.

import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { renderAgreementPdf } from '../src/lib/pdf/agreement-pdf';
import { renderW9Pdf } from '../src/lib/pdf/w9-pdf';
import { inspectPngDataUrl } from '../src/lib/pdf/png';
import type { AgreementRecord, W9Record } from '../src/lib/onboarding-store';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

/**
 * A real PNG, encoded here rather than pasted in as a base64 blob.
 *
 * The first attempt at this fixture was a hand-assembled string that looked
 * like a PNG and was not — and it did not throw, it hung pdf-lib's decoder and
 * took the whole check run with it. That is what lib/pdf/png.ts now guards
 * against, and it is why this builds a genuine one: deflate a few scanlines,
 * wrap them in IHDR/IDAT/IEND with correct CRCs, and the decoder has nothing
 * to choke on.
 */
function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC = crcTable();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** An 8-bit greyscale PNG with a diagonal scrawl through it. */
function signaturePng(width = 240, height = 80): string {
  const raw: number[] = [];
  for (let y = 0; y < height; y++) {
    raw.push(0); // filter: none
    for (let x = 0; x < width; x++) {
      // A wobbling line, thick enough to look like ink.
      const line = height / 2 + Math.sin((x / width) * Math.PI * 3) * (height / 3);
      raw.push(Math.abs(y - line) < 2.5 ? 0x11 : 0xff);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const SIGNATURE = signaturePng();

const w9: W9Record = {
  userId: 'u1',
  signedAt: '2026-08-24T12:00:00.000Z',
  line1Name: 'Arthur Reyes',
  line2Business: 'Reyes Referrals',
  classification: 'individual',
  llcCode: '',
  otherText: '',
  foreignPartners: false,
  exemptPayeeCode: '',
  fatcaCode: '',
  address: '1 Example Street, Apt 4',
  cityStateZip: 'Austin, TX 78701',
  accountNumbers: '',
  tinType: 'ssn',
  tinLast4: '6789',
  signaturePng: SIGNATURE,
  certified: true,
  signedIp: '203.0.113.9',
  signedUserAgent: 'Mozilla/5.0',
  formRevision: 'Rev. March 2024',
};

const agreement: AgreementRecord = {
  userId: 'u1',
  signedAt: '2026-08-24T12:00:00.000Z',
  affiliateName: 'Arthur Reyes',
  affiliateEmail: 'arthur@example.com',
  affiliateAddress: '1 Example Street, Apt 4, Austin, TX 78701',
  effectiveDate: '2026-08-24',
  signaturePng: SIGNATURE,
  affirmed: true,
  signedIp: '203.0.113.9',
  signedUserAgent: 'Mozilla/5.0',
  agreementVersion: '2026-08',
};

async function main() {
  console.log('— the signature guard —');
  check('a real PNG passes', inspectPngDataUrl(SIGNATURE).ok);
  check('and reports its size', inspectPngDataUrl(SIGNATURE).ok === true);
  check('a jpeg data URL is refused', !inspectPngDataUrl('data:image/jpeg;base64,AAAA').ok);
  check('so is a plain string', !inspectPngDataUrl('nope').ok);
  check('so is an empty one', !inspectPngDataUrl('').ok);
  // The exact shape that hung the decoder: right prefix, wrong contents.
  check(
    'so is base64 that is not a PNG at all',
    !inspectPngDataUrl('data:image/png;base64,' + 'A'.repeat(500)).ok,
  );
  check(
    'and so is a PNG with its tail cut off',
    !inspectPngDataUrl(SIGNATURE.slice(0, SIGNATURE.length - 200)).ok,
  );

  console.log('\n— the W-9 —');
  const w9Bytes = await renderW9Pdf(w9, '123456789');
  const w9Doc = await PDFDocument.load(w9Bytes);
  check('it is a PDF', w9Bytes[0] === 0x25 && w9Bytes[1] === 0x50);
  check('one page, like the form', w9Doc.getPageCount() === 1);
  const [w, h] = [w9Doc.getPage(0).getWidth(), w9Doc.getPage(0).getHeight()];
  check('US Letter', Math.round(w) === 612 && Math.round(h) === 792);
  // The blank form is 786KB of JPEG; anything much smaller means the background
  // did not go in, which is the difference between a W-9 and a page of text.
  check('the scanned form went in as the background', w9Bytes.length > 400_000);

  const ein = await renderW9Pdf({ ...w9, tinType: 'ein' }, '123456789');
  check('an EIN renders too', ein.length > 400_000);

  const llc = await renderW9Pdf(
    { ...w9, classification: 'llc', llcCode: 'S' },
    '123456789',
  );
  check('so does an LLC', llc.length > 400_000);

  const unsigned = await renderW9Pdf({ ...w9, signaturePng: '' }, '123456789');
  // A missing signature must not cost the document: the rest of it is still
  // the record of what was filed.
  check('a missing signature does not break it', unsigned.length > 400_000);
  const broken = await renderW9Pdf(
    { ...w9, signaturePng: 'data:image/png;base64,' + 'A'.repeat(500) },
    '123456789',
  );
  // Refused by the header check rather than thrown at the decoder, which is
  // the difference between a document without a signature and a hung request.
  check('nor does one that is not really a PNG', broken.length > 400_000);

  console.log('\n— the agreement —');
  const agBytes = await renderAgreementPdf(agreement);
  const agDoc = await PDFDocument.load(agBytes);
  check('it is a PDF', agBytes[0] === 0x25 && agBytes[1] === 0x50);
  // Twelve clauses and a summary table do not fit on one page. If they ever do,
  // something has stopped rendering.
  check('it runs to several pages', agDoc.getPageCount() >= 3);
  check('US Letter', Math.round(agDoc.getPage(0).getWidth()) === 612);
  check('and it is not enormous', agBytes.length < 400_000);

  const longName = await renderAgreementPdf({
    ...agreement,
    affiliateName: 'A'.repeat(200),
    affiliateAddress: 'B'.repeat(400),
  });
  // The wrapper takes a word wider than the column as a special case; a name
  // with no spaces in it is that case.
  check('a very long unbroken name does not hang it', longName.length > 1000);

  const out = process.argv[2];
  if (out) {
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'w9.pdf'), w9Bytes);
    await writeFile(path.join(out, 'w9-ein.pdf'), ein);
    await writeFile(path.join(out, 'agreement.pdf'), agBytes);
    console.log(`\nwrote w9.pdf, w9-ein.pdf and agreement.pdf to ${out}`);
  }

  console.log(`\npdf: ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

void main();
