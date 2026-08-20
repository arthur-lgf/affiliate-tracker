import { NextResponse } from 'next/server';
import { fetchQmpReport, QmpError, qmpConfig } from '@/lib/qmp';
import { leadsToRegister, planSync } from '@/lib/qmp-sync';
import { clientIndex, nameIndex, UNKNOWN_CLIENT } from '@/lib/analytics';
import { getStore, statusForError } from '@/lib/store';
import { forbidden, unauthorized, viewerFromRequest } from '@/lib/api-auth';

/**
 * Copy a QMP report's approvals into Ledger.
 *
 * Two things about the shape of this, both deliberate:
 *
 * The rows are fetched here rather than accepted from the browser. The client
 * has already seen them, so posting them back would be convenient, but it
 * would mean a page could write any approval and any amount it liked into the
 * money record. The server asks QMP itself.
 *
 * Nothing is written unless `apply` is true. The default is a plan: what would
 * be created, what was already imported, and what could not be resolved. A
 * sync that writes on the first click is a sync nobody reads the output of.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();
  // This one writes approvals for every affiliate at once, so it is the most
  // consequential button in the app and the least ambiguous admin gate.
  if (viewer.role !== 'admin') return forbidden('Only an admin can sync approvals.');

  const config = qmpConfig();
  if (!config.ready) {
    return NextResponse.json(
      {
        error: config.configured ? 'No report is configured.' : 'QMP is not configured.',
        hint: 'Set QMP_API_KEY, QMP_API_SECRET and REPORT_ID in .env.local.',
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const { startDate, endDate, apply } = (body ?? {}) as Record<string, unknown>;

  let report;
  try {
    report = await fetchQmpReport({
      reportKey: config.reportId,
      startDate: typeof startDate === 'string' ? startDate : '',
      endDate: typeof endDate === 'string' ? endDate : '',
      config,
    });
  } catch (error) {
    if (error instanceof QmpError) {
      const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
      return NextResponse.json({ error: error.message, hint: error.hint }, { status });
    }
    throw error;
  }

  const store = getStore();
  let links;
  let existing;
  let submissions;
  try {
    [links, existing, submissions] = await Promise.all([
      store.listLinks(),
      store.listConversions(),
      // Two jobs: a name beside each planned row, and the leads an approval
      // proves signed up. Nothing about which approvals get written depends on
      // either.
      store.listSubmissions(),
    ]);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not read the current data.' },
      { status: statusForError(error) },
    );
  }

  const plan = planSync({
    rows: report.table.rows,
    reportKey: config.reportId,
    links,
    existing,
    defaultSlug: (process.env.QMP_DEFAULT_SLUG || '').trim(),
  });

  /*
   * The leads that approvals have already vouched for, counting the ones this
   * run would write as well as everything imported before it. Computed against
   * the whole picture rather than the new rows, so a run with nothing left to
   * import still catches up the leads it never marked.
   */
  const leadIds = leadsToRegister([...existing, ...plan.create], submissions);

  const summary = {
    reportRows: report.table.rowCount,
    rowsWithApprovals: plan.rowsWithApprovals,
    totalApprovals: plan.totalApprovals,
    totalEarnings: plan.totalEarnings,
    toCreate: plan.create.length,
    // Money about to be written, which is the number worth reading twice.
    amountToCreate: Math.round(plan.create.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
    alreadyImported: plan.skipped,
    issues: plan.issues,
    unusable: plan.unusable,
    shape: report.table.shape,
    /** Leads sitting at pending under an approval. */
    leadsToMark: leadIds.length,
  };

  if (apply !== true) {
    const clients = clientIndex(submissions);
    // Whose row it is, in the name their links carry rather than the tracking
    // key those links are matched on. The same index the result table above
    // reads, so one person cannot be two different things on one screen.
    const names = nameIndex(links);
    return NextResponse.json({
      applied: false,
      ...summary,
      // A sample rather than the whole plan: enough to see it is right. Both
      // names are for display only — the tracking key is what actually gets
      // written — and a dash where var3 names nobody is a normal state rather
      // than a reason to hold the row back. A key with no name behind it falls
      // back to the key: better a code you can look up than a blank.
      preview: plan.create.slice(0, 25).map((row) => ({
        ...row,
        person: names.get(row.usr) ?? row.usr,
        client: clients.get(row.leadRef) ?? UNKNOWN_CLIENT,
      })),
    });
  }

  // Written one at a time on purpose. The Sheets adapter appends, and firing
  // these concurrently is how two rows end up on the same line.
  let created = 0;
  const failures: string[] = [];
  let leadsMarked = 0;
  for (const row of plan.create) {
    try {
      await store.addConversion({
        slug: row.slug,
        usr: row.usr,
        approvedOn: row.approvedOn,
        amount: row.amount,
        notes: row.notes,
      });
      created += 1;
    } catch (error) {
      failures.push(
        `${row.approvedOn} ${row.slug}: ${error instanceof Error ? error.message : 'failed'}`,
      );
      // Stop at the first failure. Ploughing on would leave the run half
      // applied in a way nobody can reason about, and the markers make a
      // second run safe.
      break;
    }
  }

  /*
   * The leads, after the money. In that order because the approval is the
   * record that matters: if marking a lead fails, the payout is still written
   * and correct, and the next sync will try the lead again. The reverse would
   * leave a lead marked registered against an approval that never landed.
   *
   * A failure here is collected rather than thrown for the same reason. It is
   * a status on a row nobody is paid from.
   */
  for (const id of leadIds) {
    try {
      await store.updateSubmission(id, { status: 'registered' });
      leadsMarked += 1;
    } catch (error) {
      failures.push(
        `lead ${id}: ${error instanceof Error ? error.message : 'could not be marked approved'}`,
      );
    }
  }

  return NextResponse.json({
    applied: true,
    ...summary,
    created,
    failures,
    leadsMarked,
  });
}
