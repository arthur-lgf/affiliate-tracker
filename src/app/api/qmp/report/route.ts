import { NextResponse } from 'next/server';
import { fetchQmpReport, QmpError, qmpConfig } from '@/lib/qmp';
import { forbidden, unauthorized, viewerFromRequest } from '@/lib/api-auth';

/**
 * Run a saved QMP report and hand back the rows.
 *
 * Admin only, and checked here rather than left to the matcher in
 * middleware.ts. It has to be — this returns revenue across every affiliate,
 * and the credentials behind it are the account's.
 *
 * The QMP key and secret never leave the server. The browser asks this route
 * for a report key and a date range; it never sees a token.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();
  if (viewer.role !== 'admin') return forbidden('Only an admin can run reports.');

  const config = qmpConfig();
  if (!config.ready) {
    return NextResponse.json(
      {
        error: config.configured ? 'No report is configured.' : 'QMP is not configured.',
        hint: config.configured
          ? 'Set REPORT_ID in .env.local to the report to pull, then restart.'
          : 'Set QMP_API_KEY, QMP_API_SECRET and REPORT_ID in .env.local, then restart.',
      },
      { status: 503 },
    );
  }

  // The report is fixed in the environment. Deliberately not taken from the
  // query: which report this pulls is a deployment decision, not a per-request
  // one, and accepting it here would let any signed-in page read any report
  // the credentials can reach.
  const params = new URL(request.url).searchParams;
  const startDate = params.get('startDate') ?? '';
  const endDate = params.get('endDate') ?? '';

  try {
    const result = await fetchQmpReport({ reportKey: config.reportId, startDate, endDate, config });
    return NextResponse.json({
      columns: result.table.columns,
      rows: result.table.rows,
      rowCount: result.table.rowCount,
      shape: result.table.shape,
      url: result.url,
      fetchedAt: result.fetchedAt,
      durationMs: result.durationMs,
      // The whole payload, so the first run against a new report is readable
      // even when the rows are somewhere this does not yet know to look.
      raw: result.raw,
    });
  } catch (error) {
    if (error instanceof QmpError) {
      // 0 means "never left this process" (unconfigured); report it as a
      // server-side problem rather than passing 0 through as an HTTP status.
      const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
      return NextResponse.json({ error: error.message, hint: error.hint }, { status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The report could not be fetched.' },
      { status: 502 },
    );
  }
}
