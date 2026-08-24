/**
 * Is this actually a PNG, and a sane one?
 *
 * Asked before pdf-lib is handed a signature, because pdf-lib's decoder does
 * not merely fail on malformed input — it can spin. A try/catch is no defence
 * against a loop, and a loop inside a serverless function is a request that
 * hangs until the platform kills it, on a route an affiliate can call.
 *
 * That is not hypothetical: the first fixture written for the PDF checks was a
 * hand-assembled base64 string that looked like a PNG and was not, and it hung
 * the check run rather than throwing.
 *
 * So the header is read here first — eight signature bytes, then IHDR for the
 * dimensions — and anything that does not look like a small, ordinary image is
 * refused before it reaches the decoder.
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Generous enough for a signature drawn on a 3x retina pad, mean enough to
 *  refuse a decompression bomb. */
const MAX_DIMENSION = 4000;

/** ~600KB of base64 is around 450KB of PNG. A signature is tens of kilobytes. */
const MAX_BYTES = 600_000;

export type PngCheck =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: string };

export function inspectPngDataUrl(dataUrl: string): PngCheck {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl?.startsWith(prefix)) return { ok: false, reason: 'not a PNG data URL' };

  const base64 = dataUrl.slice(prefix.length);
  if (base64.length > MAX_BYTES) return { ok: false, reason: 'too large' };

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    return { ok: false, reason: 'not base64' };
  }

  // 8 magic + 4 length + 4 'IHDR' + 8 dimensions = 24 bytes before anything
  // can be known about it.
  if (bytes.length < 24) return { ok: false, reason: 'too short to be an image' };
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) return { ok: false, reason: 'not a PNG' };
  }
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') {
    return { ok: false, reason: 'no image header' };
  }

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) return { ok: false, reason: 'empty image' };
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return { ok: false, reason: 'unreasonably large' };
  }

  // A PNG ends with IEND. Truncated data is the shape most likely to send a
  // decoder looking for a chunk that never arrives.
  if (bytes.toString('latin1', bytes.length - 8, bytes.length - 4) !== 'IEND') {
    return { ok: false, reason: 'truncated' };
  }

  return { ok: true, width, height };
}

/** The common case: safe to hand to pdf-lib, or not. */
export function isDrawablePng(dataUrl: string): boolean {
  return inspectPngDataUrl(dataUrl).ok;
}
