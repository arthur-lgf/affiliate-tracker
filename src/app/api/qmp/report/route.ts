import { NextResponse } from 'next/server';
import { fetchQmpReport, QmpError, qmpConfig } from '@/lib/qmp';
import { joinReport } from '@/lib/qmp-view';
import { getStore } from '@/lib/store';
import { forbidden, unauthorized, viewerFromRequest } from '@/lib/api-auth';

/**
 * Run a saved QMP report and hand back the rows, read against live data.
 *
 * Admin only, and checked here rather than left to the matcher in
 * middleware.ts. It has to be — this returns revenue across every affiliate,
 * and the credentials behind it are the account's.
 *
 * The QMP key and secret never leave the server. The browser asks this route
 * for a report key and a date range; it never sees a token.
 *
 * The join happens here rather than in the browser for the same reason: the
 * page would otherwise need every link and every lead in order to resolve two
 * columns, which means shipping the whole client list to resolve a handful of
 * names. The server has both already.
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

    // Live data, read fresh on every run. A stale copy here would show a row
    // against a person whose link was deleted an hour ago.
    const [links, submissions] = await Promise.all([
      getStore().listLinks(),
      getStore().listSubmissions(),
    ]);
    const joined = joinReport({ rows: result.table.rows, links, submissions });

    return NextResponse.json({
      columns: result.table.columns,
      rows: joined.rows,
      // What QMP returned, before the var2 filter. Kept separate from
      // rows.length so the page can say what it is not showing.
      rowCount: joined.rows.length,
      reportRowCount: result.table.rowCount,
      resolved: joined.resolved,
      hidden: joined.hidden,
      hiddenKeys: joined.hiddenKeys,
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
