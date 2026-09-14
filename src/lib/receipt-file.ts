/**
 * Receipt files: what an upload has to be before it is kept, and how a kept
 * one is handed back.
 *
 * A receipt is the only file this app stores and then serves to a browser from
 * its own origin, which makes it the one place a mislabelled upload could turn
 * into something a browser runs. The admin form declares a type, and the
 * browser fills that in from the file's extension, so the declaration says
 * what the file was called rather than what it is. Two defences, one at each
 * end:
 *
 *   - On the way in, the first bytes of the file have to be the signature of
 *     the type it claims. A text file renamed to .png is refused before it is
 *     written, rather than stored and trusted later.
 *   - On the way out, nosniff always, and the stored type is repeated only
 *     when it is one of the four and the bytes still agree. Anything else is
 *     served as plain bytes to download, so a row somebody edited by hand, or
 *     one saved before this check existed, can never render as a page.
 *
 * Pure: strings and bytes in, answers out. No Buffer, so it runs wherever a
 * route might, and scripts/receipt-file-checks.ts needs nothing but this file.
 */

/* ------------------------------------------------------------------ types --- */

/**
 * What a receipt may be. A payment is evidenced by a scan or a PDF; anything
 * else arriving at the upload is somebody testing what the endpoint accepts.
 * SVG is left out on purpose: it is an image that can carry script.
 */
export const PROOF_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;

export type ProofType = (typeof PROOF_TYPES)[number];

export function isProofType(value: unknown): value is ProofType {
  return typeof value === 'string' && (PROOF_TYPES as readonly string[]).includes(value);
}

/*
 * Two and a half megabytes of file, a little over three of base64. Comfortably
 * a phone photo of a transfer screen or a bank PDF, and comfortably under the
 * body limit a serverless platform will accept.
 */
export const MAX_PROOF_BYTES = 2_500_000;

/* ------------------------------------------------------------- signatures --- */

type Signature = { at: number; bytes: readonly number[] };

/**
 * The bytes each type opens with.
 *
 * Whole signatures rather than the shortest prefix that would usually do: the
 * full eight bytes of PNG, and both halves of WebP. RIFF is a container, and a
 * WAV or an AVI opens with the same four bytes a WebP does; only bytes 8 to 11
 * say which it is. PDF is "%PDF-" at the very start. The format tolerates
 * junk before the header, but every bank and every print-to-PDF writes it
 * first, and a file that has to be searched for its header is not one to
 * serve as a PDF.
 */
const SIGNATURES: Record<ProofType, readonly Signature[]> = {
  'image/png': [{ at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  'image/jpeg': [{ at: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/webp': [
    { at: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { at: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
  'application/pdf': [{ at: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }],
};

/** How many leading bytes the longest signature needs to see. */
export const HEAD_BYTES = 12;

/** Whether these bytes open the way the declared type says. Never true for a type that is not a receipt type. */
export function matchesType(bytes: ArrayLike<number>, type: string): boolean {
  if (!isProofType(type)) return false;
  return SIGNATURES[type].every(
    ({ at, bytes: expected }) =>
      bytes.length >= at + expected.length && expected.every((byte, i) => bytes[at + i] === byte),
  );
}

/** Which receipt type these bytes actually are, or '' when they are none of them. */
export function sniffProofType(bytes: ArrayLike<number>): ProofType | '' {
  return PROOF_TYPES.find((type) => matchesType(bytes, type)) ?? '';
}

/* ---------------------------------------------------------------- base64 --- */

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Strict base64, the way FileReader writes it: the standard alphabet, whole
 * groups of four, padding only at the end.
 *
 * Checked in full rather than left to the decoder, because decoders are
 * lenient. Buffer skips characters it does not recognise, so a payload with
 * junk in it would be stored, and read back later as a different file from
 * the one whose first bytes were checked.
 */
export function isBase64(text: string): boolean {
  return text.length > 0 && text.length % 4 === 0 && BASE64.test(text);
}

/** The exact number of bytes a base64 string decodes to. */
export function decodedSize(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor(base64.length / 4) * 3 - padding;
}

/**
 * The first bytes of a base64 string, decoded without decoding the rest.
 *
 * A receipt is a few megabytes of base64 and the signature is twelve bytes, so
 * only the first sixteen characters are decoded. Empty when those do not
 * decode.
 */
export function headBytes(base64: string, count = HEAD_BYTES): Uint8Array {
  const chunk = base64.slice(0, Math.ceil(count / 3) * 4);
  let binary = '';
  try {
    binary = atob(chunk);
  } catch {
    return new Uint8Array(0);
  }
  const out = new Uint8Array(Math.min(binary.length, count));
  for (let i = 0; i < out.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** The base64 half of a data URL, or '' when there is no comma to split on. */
export function receiptPayload(data: string): string {
  const comma = data.indexOf(',');
  return comma === -1 ? '' : data.slice(comma + 1);
}

/* ------------------------------------------------------------------ names --- */

const CONTROL = /[\x00-\x1f\x7f]/g;

/**
 * The name a receipt is kept under.
 *
 * Only the last part of a path: some browsers have sent the whole path from
 * the admin's disk, and that is nobody else's business. Control characters are
 * removed, since a carriage return in a name is how a filename gets out of the
 * header it is sent back in. Capped at the 200 characters the store keeps.
 */
export function cleanFileName(name: unknown): string {
  if (typeof name !== 'string') return 'receipt';
  const last = name.split(/[\\/]/).pop() ?? '';
  const cleaned = last.replace(CONTROL, '').trim().slice(0, 200);
  return cleaned || 'receipt';
}

/** encodeURIComponent, plus the four characters RFC 5987 wants escaped that it leaves alone. */
function encodeRfc5987(text: string): string {
  return encodeURIComponent(text).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * A Content-Disposition value that carries any name safely.
 *
 * Two forms, as the RFC intends: a quoted ASCII name every client understands,
 * and an encoded UTF-8 one that modern clients prefer, so "reçu.pdf" saves as
 * itself. The quoted form has to be plain printable ASCII with no quote or
 * backslash, because a header value that is not a byte string makes Headers
 * throw, and a receipt that throws on the way out is a receipt nobody can open.
 * A name with a broken surrogate in it cannot be URI-encoded at all, so it
 * falls back to its ASCII form rather than failing.
 */
export function contentDisposition(name: string, inline: boolean): string {
  const clean = cleanFileName(name);
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  let encoded: string;
  try {
    encoded = encodeRfc5987(clean);
  } catch {
    encoded = encodeRfc5987(ascii);
  }
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/* ----------------------------------------------------------------- upload --- */

export type ReceiptUpload = { name: string; type: ProofType; data: string };

export type UploadCheck =
  | { ok: true; receipt: ReceiptUpload; bytes: number }
  | { ok: false; error: string; hint: string };

function refuse(error: string, hint: string): UploadCheck {
  return { ok: false, error, hint };
}

const AGAIN = 'Try attaching it again.';

/**
 * Everything a receipt upload has to be before it is stored, in the order
 * that costs least to ask: the type, the envelope, the size, the encoding,
 * and last the bytes themselves.
 *
 * A file whose bytes are some other receipt type is refused rather than
 * quietly relabelled. The admin chose it believing it was one thing, and a
 * receipt is evidence; storing something other than what they meant to attach
 * helps nobody.
 */
export function checkReceiptUpload(input: { name?: unknown; type?: unknown; data?: unknown }): UploadCheck {
  const { type, data } = input;
  if (!isProofType(type)) {
    return refuse('That file type cannot be attached.', 'A photo or a screenshot (PNG, JPEG or WebP), or a PDF.');
  }

  const prefix = `data:${type};base64,`;
  if (typeof data !== 'string' || !data.startsWith(prefix)) {
    return refuse('That receipt did not arrive in one piece.', AGAIN);
  }
  const payload = data.slice(prefix.length);
  if (!payload) return refuse('That receipt did not arrive in one piece.', AGAIN);

  // Counted from the length before the payload is scanned, so an oversized
  // upload is turned away without reading all of it.
  const bytes = decodedSize(payload);
  if (bytes > MAX_PROOF_BYTES) {
    return refuse(
      'That receipt is too large.',
      'Up to about 2.5 MB. A screenshot or a PDF of the transfer is plenty.',
    );
  }

  if (!isBase64(payload)) return refuse('That receipt did not arrive in one piece.', AGAIN);

  if (!matchesType(headBytes(payload), type)) {
    return refuse(
      'That file does not look like the type it claims to be.',
      'Attach the original PNG, JPEG, WebP or PDF, not a renamed copy.',
    );
  }

  return { ok: true, receipt: { name: cleanFileName(input.name), type, data }, bytes };
}

/* --------------------------------------------------------------- delivery --- */

export type ReceiptHeaders = {
  'content-type': string;
  'content-disposition': string;
  'content-length': string;
  'cache-control': string;
  'x-content-type-options': 'nosniff';
};

/**
 * The headers a stored receipt is sent back with.
 *
 * Inline when it is trustworthy: the point of opening a receipt is to look at
 * it, and a PDF or a photo of a transfer is something people check at a glance
 * rather than collect. The filename is still given, so saving it keeps its
 * own name.
 *
 * When the stored type is not a receipt type, or the bytes no longer open the
 * way it says, the file is sent as application/octet-stream and downloaded.
 * nosniff on every response, so a browser never second-guesses either answer.
 */
export function receiptHeaders(input: { name: string; type: string; bytes: ArrayLike<number> }): ReceiptHeaders {
  const trusted = isProofType(input.type) && matchesType(input.bytes, input.type);
  return {
    'content-type': trusted ? input.type : 'application/octet-stream',
    'content-disposition': contentDisposition(input.name, trusted),
    'content-length': String(input.bytes.length),
    // Somebody's bank details are not something to leave in a shared cache,
    // and the file can be replaced the moment a better scan turns up.
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  };
}
