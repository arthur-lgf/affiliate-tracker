import { NextResponse } from 'next/server';
import { unauthorized, viewerFromRequest } from '@/lib/api-auth';
import { ratesAboveFloor, ratesForViewer } from '@/lib/cpa';
import { cpaCsv, cpaWorkbook, exportName, type CpaExportMeta } from '@/lib/cpa-export';
import { filterGroups, groupRates, readFilter, readSort, sortGroups } from '@/lib/cpa-groups';
import { buildCpaPdf } from '@/lib/pdf/cpa-pdf';
import { getStore, statusForError } from '@/lib/store';
import type { CpaReport } from '@/lib/types';

/**
 * The rate card as a file: printed, in a spreadsheet, or as data.
 *
 * Readable by everyone signed in, exactly like the page it comes from. What
 * differs between two readers is what is in the file, and that is decided here
 * rather than by whoever asked for it: `gross` comes off the session, so an
 * affiliate cannot ask for an admin's copy by editing the query string. The
 * merchant's rates are dropped in `ratesForViewer` before anything is drawn, so
 * there is no column of numbers to accidentally leave in.
 *
 * The filter arrives in the query string because that is where the table on
 * screen keeps it, and a download button that quietly exported the whole rate
 * card would be the wrong file with the right name on it.
 */

export const dynamic = 'force-dynamic';

const TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
} as const;

type Format = keyof typeof TYPES;

function isFormat(value: string): value is Format {
  return value in TYPES;
}

export async function GET(request: Request) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();

  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? 'pdf';
  if (!isFormat(format)) {
    return NextResponse.json(
      { error: `There is no ${format} version of the rate card.`, hint: 'Ask for pdf, xlsx or csv.' },
      { status: 400 },
    );
  }

  // The one decision that matters, and it is made from the session rather than
  // from anything the request said about itself.
  const gross = viewer.role === 'admin';

  let report: CpaReport | null = null;
  let floor: number | null = null;
  try {
    const store = getStore();
    const [read, settings] = await Promise.all([store.readCpaReport(), store.readSettings()]);
    report = read;
    floor = settings.cpaFloor;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not read the rate card.' },
      { status: statusForError(error) },
    );
  }

  /*
   * The admin's standing floor first, then whatever this reader asked for. A
   * download that carried the cards the page is holding back would be a file
   * that disagrees with the screen it was taken from.
   */
  const listed = ratesAboveFloor(report?.rows ?? [], floor);
  const everything = groupRates(ratesForViewer(listed, gross));
  const filter = readFilter(url.searchParams);
  const sort = readSort(url.searchParams, gross);
  const groups = sortGroups(filterGroups(everything, filter, gross), sort, gross);

  const meta: CpaExportMeta = {
    reportDate: report?.reportDate ?? '',
    exportedOn: new Date().toISOString(),
    exportedBy: viewer.username,
    gross,
    filter,
    sort,
    total: everything.length,
  };

  const body =
    format === 'csv'
      ? Buffer.from(cpaCsv(groups, meta), 'utf8')
      : format === 'xlsx'
        ? cpaWorkbook(groups, meta)
        : Buffer.from(await buildCpaPdf(groups, meta));

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'content-type': TYPES[format],
      // Named for the day it was taken. Two of these in a downloads folder are
      // two different rate cards, and the browser will otherwise call them both
      // "export".
      'content-disposition': `attachment; filename="${exportName(format, meta.exportedOn)}"`,
      'content-length': String(body.length),
      // Rates change and a filter is per request. A cached copy of either would
      // be a stale price list served from somebody's browser.
      'cache-control': 'no-store',
    },
  });
}
