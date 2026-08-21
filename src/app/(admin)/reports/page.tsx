import type { Metadata } from 'next';
import { ReportRunner } from '@/components/ReportRunner';
import { qmpConfig } from '@/lib/qmp';
import { requireAdmin } from '@/lib/viewer';

/**
 * QMP reports, pulled over the API.
 *
 * Admin only. The report covers every affiliate's revenue at once and there is
 * no sensible way to cut it down to one person's, since the rows come back
 * keyed by QuinStreet's own placement id rather than by our tracking key.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Reports' };

export default async function ReportsPage() {
  await requireAdmin();
  const config = qmpConfig();

  return (
    <>
      <div className="rise">
        <h1 className="font-display leading-[1.05] text-[26px]">QMP reports</h1>
        <p className="mt-3 max-w-[680px] text-[13px] leading-relaxed text-ink-soft">
          Pull a saved report straight out of QuinStreet Media Platform instead of exporting it by
          hand. The key and secret stay on the server; your browser only ever asks this app.
        </p>
      </div>

      {config.ready ? (
        <ReportRunner reportId={config.reportId} app={config.app} baseUrl={config.baseUrl} />
      ) : (
        <section className="rise panel mt-6 p-6 sm:p-8">
          <h2 className="font-display text-[16px]">
            {config.configured ? 'No report chosen yet' : 'Not connected yet'}
          </h2>
          <p className="plain mt-3">
            {config.configured
              ? 'The credentials work. Name the report to pull in .env.local, then restart the server.'
              : 'Add the QMP API key, secret and report id to .env.local, then restart the server. The key and secret are issued in QMP under the API keys section.'}
          </p>
          <pre className="panel-sunk mt-5 overflow-x-auto p-4 text-[11px]">
            {config.configured
              ? 'REPORT_ID=93440'
              : 'QMP_API_KEY=your-api-key\nQMP_API_SECRET=your-secret\nREPORT_ID=93440'}
          </pre>
          <p className="plain-note mt-4">
            The report id is the last part of the Download Via API URL in QMP: open the report,
            choose Download Via API, and take the number after <code>/download/</code>. Pasting the
            whole URL works too. Never put any of this in <code>.env.example</code>, which is
            committed.
          </p>
        </section>
      )}
    </>
  );
}
