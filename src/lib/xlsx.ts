/**
 * The smallest workbook Excel will open, written by hand.
 *
 * A CSV cannot carry a heading, a column width, a currency format or a frozen
 * row, so a "designed" export has to be a real .xlsx. That is a zip of a few
 * XML parts, and writing those parts directly is a couple of hundred lines with
 * no dependency, no install step and nothing to keep patched. A spreadsheet
 * library would be twenty megabytes to do the same job.
 *
 * Deliberately narrow. There is one sheet, one palette and a fixed list of cell
 * styles, because this exists to typeset one table. Anything more general would
 * be a spreadsheet library, badly.
 *
 * The two things worth knowing if this ever needs changing:
 *
 *   1. Excel is strict about element order inside a worksheet. cols, then
 *      sheetData, then autoFilter, then mergeCells, then the page setup. Out of
 *      order, the file opens as "unreadable content" with no clue why.
 *   2. Fills 0 and 1 must be `none` and `gray125` and are never used. Excel
 *      assumes them, and a file that omits them paints every cell with the
 *      wrong colour.
 *
 * scripts/xlsx-checks.ts unzips what comes out and reads it back.
 */

import { deflateRawSync } from 'node:zlib';

/**
 * The cell styles this writer knows.
 *
 * Named for the job rather than the look ('money', not 'right-aligned bold'),
 * so the sheet that uses them says what it means and the palette can move
 * without a caller changing.
 */
export type XlsxStyle =
  | 'title'
  | 'note'
  | 'headText'
  | 'headNum'
  | 'text'
  | 'bold'
  | 'indent'
  | 'money'
  | 'percent'
  | 'date';

export type XlsxCell = {
  value: string | number | null;
  style?: XlsxStyle;
  /** Draw this cell on the shaded band. */
  band?: boolean;
} | null;

export type XlsxSheet = {
  /** The tab name. Excel refuses \ / ? * [ ] : and anything over 31 characters. */
  name: string;
  /** Column widths, in characters, left to right. */
  columns: number[];
  rows: XlsxCell[][];
  /** Row heights in points, keyed by 1-based row number. */
  heights?: Record<number, number>;
  /** How many rows stay put when the sheet is scrolled. */
  freeze?: number;
  /** The range Excel's own filter arrows are drawn over, e.g. "A4:H120". */
  filter?: string;
  merges?: string[];
};

/* ---------------------------------------------------------- the palette -- */

/* Ledger's own ink and paper, so a printed sheet and the page it came from are
   recognisably the same document. See globals.css. */
const INK = 'FF0B2239';
const INK_DIM = 'FF6B7C8F';
const PAPER = 'FF0B2239';
const BAND = 'FFF4F6F8';
const RULE = 'FFEDF1F4';

/**
 * Every style, in the order their xf records are written.
 *
 * Each one becomes two records: the plain cell and the same cell on a band.
 * That keeps the lookup arithmetic in `styleIndex` trivial, at the cost of ten
 * unused records in a file that is already the size of a photograph of a
 * spreadsheet.
 */
const STYLES: { style: XlsxStyle; font: number; numFmt: number; align: string; border: number }[] = [
  { style: 'title', font: 2, numFmt: 0, align: 'vertical="center"', border: 0 },
  { style: 'note', font: 3, numFmt: 0, align: 'vertical="center"', border: 0 },
  { style: 'headText', font: 1, numFmt: 0, align: 'horizontal="left" vertical="center"', border: 0 },
  { style: 'headNum', font: 1, numFmt: 0, align: 'horizontal="right" vertical="center"', border: 0 },
  { style: 'text', font: 0, numFmt: 0, align: '', border: 1 },
  { style: 'bold', font: 4, numFmt: 0, align: '', border: 1 },
  { style: 'indent', font: 0, numFmt: 0, align: 'horizontal="left" indent="1"', border: 1 },
  { style: 'money', font: 0, numFmt: 164, align: 'horizontal="right"', border: 1 },
  { style: 'percent', font: 0, numFmt: 165, align: 'horizontal="right"', border: 1 },
  { style: 'date', font: 0, numFmt: 166, align: 'horizontal="right"', border: 1 },
];

/** Which fill a style paints with. The two header styles carry their own. */
function fillOf(style: XlsxStyle, band: boolean): number {
  if (style === 'headText' || style === 'headNum') return 2;
  return band ? 3 : 0;
}

function styleIndex(style: XlsxStyle | undefined, band: boolean | undefined): number {
  if (!style) return 0;
  const at = STYLES.findIndex((entry) => entry.style === style);
  if (at === -1) return 0;
  return 1 + at * 2 + (band ? 1 : 0);
}

/* ------------------------------------------------------------- helpers --- */

/** "A", "B" … "AA". Zero-based, because every caller counts columns from 0. */
export function columnName(index: number): string {
  let name = '';
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

/**
 * An ISO day as Excel's own day number, or null for anything unparseable.
 *
 * Written as a number with a date format rather than as text, so a column of
 * dates sorts and filters as dates once the file is open. The epoch is
 * 1899-12-30 rather than 1900-01-01: Excel believes 1900 was a leap year, and
 * this offset is how every other writer reproduces the bug.
 */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

export function excelDay(iso: string): number | null {
  const parsed = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed)) return null;
  return Math.round((parsed - EXCEL_EPOCH) / 86_400_000);
}

/**
 * Text that will not break the XML.
 *
 * Control characters are dropped rather than escaped: they are legal in a
 * string that came out of a spreadsheet and illegal in XML 1.0, and a single
 * stray one makes the whole workbook unopenable.
 */
function xml(value: string): string {
  return value
    // Control characters are legal in a spreadsheet cell and illegal in
    // XML, so they go rather than get escaped.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A tab name Excel will accept: no reserved characters, no more than 31. */
function sheetName(raw: string): string {
  const cleaned = raw.replace(/[\\/?*[\]:]/g, ' ').trim();
  return (cleaned || 'Sheet1').slice(0, 31);
}

/* --------------------------------------------------------- the parts ----- */

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function contentTypes(): string {
  return (
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>'
  );
}

function rootRels(): string {
  return (
    `${HEAD}<Relationships xmlns="${PKG_REL}">` +
    `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
    '</Relationships>'
  );
}

function workbookRels(): string {
  return (
    `${HEAD}<Relationships xmlns="${PKG_REL}">` +
    `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>` +
    '</Relationships>'
  );
}

function workbook(sheet: XlsxSheet): string {
  const name = sheetName(sheet.name);
  /*
   * The hidden defined name is what makes the filter arrows survive a save in
   * Excel. Without it the arrows are drawn but the range is forgotten the first
   * time somebody saves the file, and the second reader gets a plain table.
   */
  const filter = sheet.filter
    ? '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' +
      `'${xml(name.replace(/'/g, "''"))}'!${absolute(sheet.filter)}</definedName></definedNames>`
    : '';

  return (
    `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}">` +
    `<sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets>` +
    filter +
    '</workbook>'
  );
}

/** "A4:H120" as "$A$4:$H$120", which is the only form a defined name takes. */
function absolute(range: string): string {
  return range.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
}

function styles(): string {
  const fonts = [
    `<font><sz val="11"/><color rgb="${INK}"/><name val="Calibri"/></font>`,
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
    `<font><b/><sz val="16"/><color rgb="${INK}"/><name val="Calibri"/></font>`,
    `<font><sz val="10"/><color rgb="${INK_DIM}"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="11"/><color rgb="${INK}"/><name val="Calibri"/></font>`,
  ];

  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    `<fill><patternFill patternType="solid"><fgColor rgb="${PAPER}"/><bgColor indexed="64"/></patternFill></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="${BAND}"/><bgColor indexed="64"/></patternFill></fill>`,
  ];

  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    `<border><left/><right/><top/><bottom style="thin"><color rgb="${RULE}"/></bottom><diagonal/></border>`,
  ];

  const xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  for (const entry of STYLES) {
    for (const band of [false, true]) {
      const alignment = entry.align ? `<alignment ${entry.align}/>` : '';
      xfs.push(
        `<xf numFmtId="${entry.numFmt}" fontId="${entry.font}" fillId="${fillOf(entry.style, band)}"` +
          ` borderId="${entry.border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"` +
          `${entry.numFmt ? ' applyNumberFormat="1"' : ''}${alignment ? ' applyAlignment="1"' : ''}>` +
          `${alignment}</xf>`,
      );
    }
  }

  return (
    `${HEAD}<styleSheet xmlns="${MAIN}">` +
    '<numFmts count="3">' +
    '<numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>' +
    '<numFmt numFmtId="165" formatCode="0.00%"/>' +
    '<numFmt numFmtId="166" formatCode="d mmm yyyy"/>' +
    '</numFmts>' +
    `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
    `<fills count="${fills.length}">${fills.join('')}</fills>` +
    `<borders count="${borders.length}">${borders.join('')}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  );
}

function worksheet(sheet: XlsxSheet): string {
  const width = Math.max(sheet.columns.length, ...sheet.rows.map((row) => row.length), 1);
  const last = `${columnName(width - 1)}${Math.max(sheet.rows.length, 1)}`;

  const cols = sheet.columns.length
    ? '<cols>' +
      sheet.columns
        .map(
          (chars, index) =>
            `<col min="${index + 1}" max="${index + 1}" width="${chars}" customWidth="1"/>`,
        )
        .join('') +
      '</cols>'
    : '';

  const body = sheet.rows
    .map((cells, index) => {
      const number = index + 1;
      const height = sheet.heights?.[number];
      const attrs = height ? ` ht="${height}" customHeight="1"` : '';
      const written = cells
        .map((cell, column) => {
          if (!cell || cell.value === null || cell.value === '') return '';
          const at = `${columnName(column)}${number}`;
          const style = styleIndex(cell.style, cell.band);
          const s = style ? ` s="${style}"` : '';
          if (typeof cell.value === 'number') {
            return `<c r="${at}"${s}><v>${cell.value}</v></c>`;
          }
          // Inline rather than through a shared string table: the table is an
          // optimisation for a sheet that repeats itself, and it is one more
          // part to keep consistent for a file this size.
          return `<c r="${at}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${number}" spans="1:${width}"${attrs}>${written}</row>`;
    })
    .join('');

  return (
    `${HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${REL}">` +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    `<dimension ref="A1:${last}"/>` +
    '<sheetViews><sheetView workbookViewId="0" showGridLines="0">' +
    (sheet.freeze
      ? `<pane ySplit="${sheet.freeze}" topLeftCell="A${sheet.freeze + 1}" activePane="bottomLeft" state="frozen"/>` +
        `<selection pane="bottomLeft" activeCell="A${sheet.freeze + 1}" sqref="A${sheet.freeze + 1}"/>`
      : '') +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${body}</sheetData>` +
    (sheet.filter ? `<autoFilter ref="${sheet.filter}"/>` : '') +
    (sheet.merges?.length
      ? `<mergeCells count="${sheet.merges.length}">` +
        sheet.merges.map((range) => `<mergeCell ref="${range}"/>`).join('') +
        '</mergeCells>'
      : '') +
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
    '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
    '</worksheet>'
  );
}

/* ------------------------------------------------------------- the zip --- */

let table: Uint32Array | null = null;

function crc32(bytes: Buffer): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let value = i;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[i] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A zip, with everything modern left out.
 *
 * No zip64, no data descriptors, no encryption, and a fixed 1980 timestamp so
 * the same table exports byte for byte the same file twice. That last one is
 * what lets a check assert on the bytes at all.
 */
function zip(entries: { name: string; text: string }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.text, 'utf8');
    const packed = deflateRawSync(raw, { level: 9 });
    const stored = packed.length >= raw.length;
    const body = stored ? raw : packed;
    const method = stored ? 0 : 8;
    const crc = crc32(raw);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // names are UTF-8
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x0021, 12); // 1 January 1980
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, body);

    const listed = Buffer.alloc(46);
    listed.writeUInt32LE(0x02014b50, 0);
    listed.writeUInt16LE(20, 4);
    listed.writeUInt16LE(20, 6);
    listed.writeUInt16LE(0x0800, 8);
    listed.writeUInt16LE(method, 10);
    listed.writeUInt16LE(0, 12);
    listed.writeUInt16LE(0x0021, 14);
    listed.writeUInt32LE(crc, 16);
    listed.writeUInt32LE(body.length, 20);
    listed.writeUInt32LE(raw.length, 24);
    listed.writeUInt16LE(name.length, 28);
    listed.writeUInt32LE(offset, 42);
    central.push(listed, name);

    offset += header.length + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...local, directory, end]);
}

/** One sheet, as a file. */
export function buildWorkbook(sheet: XlsxSheet): Buffer {
  return zip([
    { name: '[Content_Types].xml', text: contentTypes() },
    { name: '_rels/.rels', text: rootRels() },
    { name: 'xl/workbook.xml', text: workbook(sheet) },
    { name: 'xl/_rels/workbook.xml.rels', text: workbookRels() },
    { name: 'xl/styles.xml', text: styles() },
    { name: 'xl/worksheets/sheet1.xml', text: worksheet(sheet) },
  ]);
}
