import { NextResponse } from 'next/server';
import { parseCpaExport, sortRates } from '@/lib/cpa';
import { getStore, statusForError } from '@/lib/store';
import { requireApiAdmin } from '@/lib/api-auth';
import type { CpaReport } from '@/lib/types';

/**
 * Replace the CPA rate card from an uploaded export.
 *
 * The file is read in the browser and posted as text rather than as multipart
 * form data. It is a spreadsheet export of a few hundred rows, so the whole
 * thing fits in a JSON body comfortably, and text means no multipart parser and
 * no temporary file on a host that may not have a filesystem.
 *
 * Admin only, and the reason is money rather than tidiness: these are the rates
 * every person on the team quotes from. Anyone who can replace them can change
 * what the whole team believes a card is worth.
 */

export const dynamic = 'force-dynamic';

/**
 * Roughly a megabyte of text. The real export is about 35 KB, so this is wide
 * enough for a much bigger rate card and narrow enough that a wrong file — a
 * video, a database dump — is refused before it is parsed rather than after.
 */
const MAX_CHARS = 1_000_000;

export async function POST(request: Request) {
  const gate = await requireApiAdmin(request, 'Only an admin can replace the CPA report.');
  if ('response' in gate) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const { text, name } = (body ?? {}) as Record<string, unknown>;
  if (typeof text !== 'string' || text.trim() === '') {
    return NextResponse.json({ error: 'No file contents were sent.' }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      {
        error: 'That file is too large to be a CPA report.',
        hint: `The limit is ${(MAX_CHARS / 1000).toLocaleString()} thousand characters; this one is ${text.length.toLocaleString()}.`,
      },
      { status: 413 },
    );
  }

  const parsed = parseCpaExport(text);
  if (parsed.rows.length === 0) {
    // A wrong file is a mistake by the person at the keyboard, not a failure of
    // the server, so it comes back as something to read rather than a 500.
    return NextResponse.json(
      {
        error: 'No rates could be read out of that file.',
        hint:
          parsed.issues[0]?.detail ??
          'Export the CPA report from QMP and upload it without editing the header row.',
      },
      { status: 400 },
    );
  }

  const report: CpaReport = {
    reportDate: parsed.reportDate,
    updatedAt: new Date().toISOString(),
    updatedBy: gate.viewer.username,
    source: typeof name === 'string' ? name.slice(0, 200) : '',
    rows: sortRates(parsed.rows),
  };

  try {
    await getStore().writeCpaReport(report);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not save the report.' },
      { status: statusForError(error) },
    );
  }

  return NextResponse.json({
    ok: true,
    rows: report.rows.length,
    // Parent rows of tiered cards, which carry no rate. Reported so the count
    // on screen and the row count in the file can be reconciled.
    scaffold: parsed.scaffold,
    issues: parsed.issues.slice(0, 10),
    reportDate: report.reportDate,
    updatedAt: report.updatedAt,
    updatedBy: report.updatedBy,
  });
}
