// Reading a zip back out, for the checks that write one.
//
// Not a check itself. lib/xlsx.ts writes the archive by hand, so the only way
// to know it wrote a real one is to take it apart again with something that
// shares no code with it: the CRC is recomputed here from scratch, and a
// workbook whose lengths or checksums are a byte out fails to load rather than
// producing a file Excel will open and quietly repair.

import { inflateRawSync } from 'node:zlib';

const table = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  table[i] = value >>> 0;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Every entry in the archive, by name.
 *
 * Walked from the front through the local headers rather than through the
 * central directory, because that is the harder read: it only works if every
 * compressed length is right, and a wrong one takes the walk into the middle of
 * the next entry instead of onto its header.
 */
export function readZip(bytes: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let at = 0;

  while (at + 30 <= bytes.length && bytes.readUInt32LE(at) === 0x04034b50) {
    const method = bytes.readUInt16LE(at + 8);
    const crc = bytes.readUInt32LE(at + 14);
    const packed = bytes.readUInt32LE(at + 18);
    const plain = bytes.readUInt32LE(at + 22);
    const nameLength = bytes.readUInt16LE(at + 26);
    const extraLength = bytes.readUInt16LE(at + 28);

    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const from = at + 30 + nameLength + extraLength;
    const body = bytes.subarray(from, from + packed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);

    if (data.length !== plain) throw new Error(`${name}: length says ${plain}, unpacked ${data.length}`);
    if (crc32(data) !== crc) throw new Error(`${name}: checksum does not match`);

    files.set(name, data.toString('utf8'));
    at = from + packed;
  }

  if (files.size === 0) throw new Error('No entries: this is not a zip');
  return files;
}
