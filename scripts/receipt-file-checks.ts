// What a receipt upload has to be before it is stored, and how it is handed
// back.
//
// A receipt is the one file this app keeps and serves back to a browser from
// its own origin, so two things are pinned hard. The upload: the bytes have to
// open the way the declared type says, because a text file labelled image/png
// would otherwise sit in the database waiting to be sniffed into something a
// browser runs. And the delivery: nosniff always, the declared type only when
// it is one of the four and the bytes agree, and a filename that can never
// break the header it rides in.
//
//   npx tsx scripts/receipt-file-checks.ts

import {
  checkReceiptUpload,
  cleanFileName,
  contentDisposition,
  decodedSize,
  headBytes,
  isBase64,
  isProofType,
  matchesType,
  MAX_PROOF_BYTES,
  PROOF_TYPES,
  receiptHeaders,
  receiptPayload,
  sniffProofType,
} from '../src/lib/receipt-file';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name, extra === undefined ? '' : extra);
  }
}

const DASHES = /[\u2013\u2014]/;

// Every sentence this module can put in front of somebody, gathered so the
// wording rules are checked once across all of them at the end.
const said: string[] = [];
function heard(text: string | undefined): string {
  if (text) said.push(text);
  return text ?? '';
}

/* Real first bytes of each kind of file, padded out with some body. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 86, 80, 56, 32]);
const PDF = new TextEncoder().encode('%PDF-1.7\n%\u00e2\u00e3\n1 0 obj');
const TEXT = new TextEncoder().encode('hello, this is not a picture of anything');
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
function dataUrl(type: string, bytes: Uint8Array): string {
  return `data:${type};base64,${b64(bytes)}`;
}

console.log('\u2014 the four kinds of receipt \u2014');
check('four types', PROOF_TYPES.length === 4, PROOF_TYPES);
for (const type of ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']) {
  check(`${type} is a receipt type`, isProofType(type));
}
for (const type of ['image/gif', 'image/svg+xml', 'text/html', 'application/octet-stream', '', 'IMAGE/PNG']) {
  check(`${type || '(empty)'} is not`, !isProofType(type));
}
check('a non-string is not', !isProofType(42) && !isProofType(null) && !isProofType(undefined));
check('about two and a half megabytes', MAX_PROOF_BYTES === 2_500_000);

console.log('\n\u2014 what the first bytes say \u2014');
check('a PNG sniffs as PNG', sniffProofType(PNG) === 'image/png');
check('a JPEG sniffs as JPEG', sniffProofType(JPEG) === 'image/jpeg');
check('a WebP sniffs as WebP', sniffProofType(WEBP) === 'image/webp');
check('a PDF sniffs as PDF', sniffProofType(PDF) === 'application/pdf');
check('plain text sniffs as nothing', sniffProofType(TEXT) === '');
check('HTML sniffs as nothing', sniffProofType(HTML) === '');
check('no bytes sniffs as nothing', sniffProofType(new Uint8Array()) === '');
/*
 * RIFF is a container. A WAV or an AVI opens with the same four bytes as a
 * WebP; only bytes 8 to 11 tell them apart, so those have to be read too.
 */
const WAV = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
check('a WAV is not a WebP, though both are RIFF', sniffProofType(WAV) === '' && !matchesType(WAV, 'image/webp'));
check('RIFF cut short is not a WebP', !matchesType(WEBP.slice(0, 11), 'image/webp'));
check('half a PNG signature is not a PNG', !matchesType(PNG.slice(0, 4), 'image/png'));
check('two bytes of JPEG are not a JPEG', !matchesType(JPEG.slice(0, 2), 'image/jpeg'));
check('%PDF without its dash is not a PDF', !matchesType(new TextEncoder().encode('%PDF1.7'), 'application/pdf'));
check('a PDF has to open with it, not merely contain it', !matchesType(new TextEncoder().encode(' %PDF-1.7'), 'application/pdf'));

console.log('\n\u2014 declared against actual \u2014');
check('PNG bytes match image/png', matchesType(PNG, 'image/png'));
check('PNG bytes do not match image/jpeg', !matchesType(PNG, 'image/jpeg'));
check('JPEG bytes do not match application/pdf', !matchesType(JPEG, 'application/pdf'));
check('text bytes match no receipt type', PROOF_TYPES.every((type) => !matchesType(TEXT, type)));
check('an unknown declared type never matches', !matchesType(PNG, 'image/gif') && !matchesType(HTML, 'text/html'));
check('a plain array of numbers works too', matchesType([0xff, 0xd8, 0xff, 0xdb], 'image/jpeg'));

console.log('\n\u2014 base64, read without trusting it \u2014');
check('well formed', isBase64(b64(PNG)) && isBase64('QQ==') && isBase64('QUI=') && isBase64('QUJD'));
check('empty is not a file', !isBase64(''));
check('wrong length', !isBase64('QUJ'));
check('stray characters', !isBase64('QU J=') && !isBase64('QUJ$') && !isBase64('QUJD\n'));
check('url-safe alphabet is not what a data URL carries', !isBase64('QU-_'));
check('padding only at the end', !isBase64('Q=JD') && !isBase64('QQ==QUJD'));
check('three padding characters', !isBase64('Q==='));
check('exact size, no padding', decodedSize('QUJD') === 3);
check('exact size, one pad', decodedSize('QUI=') === 2);
check('exact size, two pads', decodedSize('QQ==') === 1);
check('exact size of a real file', decodedSize(b64(PDF)) === PDF.length, decodedSize(b64(PDF)));
{
  const head = headBytes(b64(WEBP));
  check('the head is the first twelve bytes', head.length === 12 && head.every((byte, i) => byte === WEBP[i]), head);
  const short = headBytes('QUI=');
  check('a short file gives what it has', short.length === 2 && short[0] === 65 && short[1] === 66, short);
  check('an unreadable head gives nothing', headBytes('%%%%').length === 0);
}
check('payload of a data URL', receiptPayload('data:image/png;base64,QUJD') === 'QUJD');
check('payload with no comma is nothing', receiptPayload('QUJD') === '');
check('payload of nothing is nothing', receiptPayload('') === '');

console.log('\n\u2014 an upload that should be kept \u2014');
for (const [type, bytes] of [
  ['image/png', PNG],
  ['image/jpeg', JPEG],
  ['image/webp', WEBP],
  ['application/pdf', PDF],
] as const) {
  const result = checkReceiptUpload({ name: 'transfer', type, data: dataUrl(type, bytes) });
  check(`a real ${type} is accepted`, result.ok, result);
  if (result.ok) {
    check(`and kept with its declared type (${type})`, result.receipt.type === type);
    check(`and its data untouched (${type})`, result.receipt.data === dataUrl(type, bytes));
    check(`and its size counted in bytes (${type})`, result.bytes === bytes.length, result.bytes);
  }
}

console.log('\n\u2014 an upload that should not \u2014');
function refused(name: string, input: Parameters<typeof checkReceiptUpload>[0], error: string) {
  const result = checkReceiptUpload(input);
  check(name, !result.ok, result);
  if (!result.ok) {
    check(`${name}: says why`, result.error === error, result.error);
    check(`${name}: and what to do`, heard(result.hint).length > 0);
    heard(result.error);
  }
}
const WRONG_TYPE = 'That file type cannot be attached.';
const BROKEN = 'That receipt did not arrive in one piece.';
const TOO_LARGE = 'That receipt is too large.';
const MISMATCH = 'That file does not look like the type it claims to be.';

refused('a GIF', { name: 'a.gif', type: 'image/gif', data: 'data:image/gif;base64,R0lGODlh' }, WRONG_TYPE);
refused('an SVG', { name: 'a.svg', type: 'image/svg+xml', data: 'data:image/svg+xml;base64,PHN2Zz4=' }, WRONG_TYPE);
refused('HTML', { name: 'a.html', type: 'text/html', data: dataUrl('text/html', HTML) }, WRONG_TYPE);
refused('no type at all', { name: 'x', data: dataUrl('image/png', PNG) }, WRONG_TYPE);
refused('a type that is not a string', { name: 'x', type: ['image/png'], data: dataUrl('image/png', PNG) }, WRONG_TYPE);
refused('no data', { name: 'x', type: 'image/png' }, BROKEN);
refused('data that is not a string', { name: 'x', type: 'image/png', data: 12 }, BROKEN);
refused('a data URL for a different type', { name: 'x', type: 'image/png', data: dataUrl('image/jpeg', PNG) }, BROKEN);
refused('not base64 encoded', { name: 'x', type: 'image/png', data: 'data:image/png,%89PNG' }, BROKEN);
refused('an empty file', { name: 'x', type: 'image/png', data: 'data:image/png;base64,' }, BROKEN);
refused('base64 with junk in it', { name: 'x', type: 'image/png', data: `data:image/png;base64,${b64(PNG)}$$$$` }, BROKEN);
refused('base64 cut off mid-group', { name: 'x', type: 'image/png', data: `data:image/png;base64,${b64(PNG)}A` }, BROKEN);
/*
 * Plain text labelled as a picture is the case the blueprint names, and the
 * reason this module exists: it has to be refused before it is stored.
 */
refused('text labelled image/png', { name: 'x.png', type: 'image/png', data: dataUrl('image/png', TEXT) }, MISMATCH);
refused('HTML labelled application/pdf', { name: 'x.pdf', type: 'application/pdf', data: dataUrl('application/pdf', HTML) }, MISMATCH);
refused('a PNG labelled image/jpeg', { name: 'x.jpg', type: 'image/jpeg', data: dataUrl('image/jpeg', PNG) }, MISMATCH);
refused('a WAV labelled image/webp', { name: 'x.webp', type: 'image/webp', data: dataUrl('image/webp', WAV) }, MISMATCH);
{
  // One byte over, as a real PDF, so the only thing wrong with it is its size.
  const big = new Uint8Array(MAX_PROOF_BYTES + 1);
  big.set(PDF);
  refused('one byte over the limit', { name: 'big.pdf', type: 'application/pdf', data: dataUrl('application/pdf', big) }, TOO_LARGE);
  const exact = new Uint8Array(MAX_PROOF_BYTES);
  exact.set(PDF);
  const atLimit = checkReceiptUpload({ name: 'ok.pdf', type: 'application/pdf', data: dataUrl('application/pdf', exact) });
  check('exactly at the limit is accepted', atLimit.ok, atLimit.ok ? '' : atLimit.error);
}

console.log('\n\u2014 the name it is kept under \u2014');
check('an ordinary name is kept', cleanFileName('transfer.pdf') === 'transfer.pdf');
check('surrounding space is trimmed', cleanFileName('  transfer.pdf  ') === 'transfer.pdf');
check('a path is cut to its last part', cleanFileName('C:\\Users\\sam\\transfer.pdf') === 'transfer.pdf');
check('a unix path too', cleanFileName('/home/sam/transfer.pdf') === 'transfer.pdf');
check('control characters are removed', cleanFileName('trans\r\nfer\u0000.pdf') === 'transfer.pdf', cleanFileName('trans\r\nfer\u0000.pdf'));
check('no name becomes receipt', cleanFileName('') === 'receipt' && cleanFileName('   ') === 'receipt');
check('a non-string becomes receipt', cleanFileName(undefined) === 'receipt' && cleanFileName(7) === 'receipt');
check('a name that is only a path becomes receipt', cleanFileName('C:\\folder\\') === 'receipt');
check('a very long name is capped', cleanFileName('a'.repeat(500) + '.pdf').length === 200);
check('an accented name survives', cleanFileName('reçu de virement.pdf') === 'reçu de virement.pdf');
{
  const upload = checkReceiptUpload({ name: '..\\..\\evil\r\n.png', type: 'image/png', data: dataUrl('image/png', PNG) });
  check('an accepted upload carries the cleaned name', upload.ok && upload.receipt.name === 'evil.png', upload);
}

console.log('\n\u2014 the header the name rides in \u2014');
{
  const plain = contentDisposition('transfer.pdf', true);
  check('inline with the name', plain.startsWith('inline; filename="transfer.pdf"'), plain);
  check('and the encoded form beside it', plain.includes("filename*=UTF-8''transfer.pdf"), plain);
  check('attachment when asked', contentDisposition('transfer.pdf', false).startsWith('attachment; '));

  const quoted = contentDisposition('my "best" \\ receipt.pdf', true);
  const quotedName = /filename="([^"]*)"/.exec(quoted)?.[1] ?? null;
  check('quotes and backslashes cannot close the quoted name', quotedName !== null && !/["\\]/.test(quotedName), quoted);

  const accented = contentDisposition('reçu.pdf', true);
  check('a non-ASCII name is plain ASCII in the fallback', /filename="[\x20-\x7e]*"/.test(accented), accented);
  check('and exact in the encoded form', accented.includes("filename*=UTF-8''re%C3%A7u.pdf"), accented);

  const tricky = contentDisposition("it's (a) *receipt*.pdf", true);
  check("RFC 5987 characters are escaped", tricky.includes("filename*=UTF-8''it%27s%20%28a%29%20%2Areceipt%2A.pdf"), tricky);

  const newline = contentDisposition('a\r\nSet-Cookie: x=1.pdf', true);
  check('no newline can reach the header', !/[\r\n]/.test(newline), newline);

  // A lone surrogate makes encodeURIComponent throw. A receipt must still open.
  let lone = '';
  let threw = false;
  try {
    lone = contentDisposition('bad\ud800name.pdf', true);
  } catch {
    threw = true;
  }
  check('a broken name does not throw', !threw);
  check('and still gives a header', lone.startsWith('inline; filename="'), lone);

  // What Headers will accept: every character a single byte. Anything else throws at runtime.
  for (const value of [plain, quoted, accented, tricky, newline, lone]) {
    let ok = true;
    try {
      new Headers({ 'content-disposition': value });
    } catch {
      ok = false;
    }
    check(`Headers accepts ${JSON.stringify(value).slice(0, 40)}`, ok);
  }
}

console.log('\n\u2014 handing it back \u2014');
{
  const good = receiptHeaders({ name: 'transfer.png', type: 'image/png', bytes: PNG });
  check('nosniff', good['x-content-type-options'] === 'nosniff', good);
  check('the declared type, when the bytes agree', good['content-type'] === 'image/png', good);
  check('opened in place', good['content-disposition'].startsWith('inline; '), good);
  check('its length', good['content-length'] === String(PNG.length), good);
  check('never cached anywhere shared', good['cache-control'] === 'private, no-store', good);

  /*
   * A row somebody edited by hand, or one stored before the upload check
   * existed. Served as bytes to download, never as the type it claims, so a
   * stored text/html can never render inside this app's origin.
   */
  const html = receiptHeaders({ name: 'x.html', type: 'text/html', bytes: HTML });
  check('an unknown stored type is served as plain bytes', html['content-type'] === 'application/octet-stream', html);
  check('and downloaded, not opened', html['content-disposition'].startsWith('attachment; '), html);
  check('still nosniff', html['x-content-type-options'] === 'nosniff');

  const liar = receiptHeaders({ name: 'x.png', type: 'image/png', bytes: TEXT });
  check('a type the bytes disagree with is served as plain bytes', liar['content-type'] === 'application/octet-stream', liar);
  check('and downloaded', liar['content-disposition'].startsWith('attachment; '), liar);

  const empty = receiptHeaders({ name: '', type: 'application/pdf', bytes: PDF });
  check('no name is still a name', empty['content-disposition'].includes('filename="receipt"'), empty);
}

console.log('\n\u2014 house rules on every sentence \u2014');
check('there were sentences to check', said.length >= 8, said.length);
for (const text of said) {
  check(`no dash: ${text}`, !DASHES.test(text));
  check(`ends as a sentence: ${text}`, /[.?]$/.test(text));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
