// Talk to QMP for real, from a terminal.
//
//   npx tsx scripts/qmp-live.ts                          # credentials only
//   npx tsx scripts/qmp-live.ts <reportKey>              # all available dates
//   npx tsx scripts/qmp-live.ts <reportKey> 2026-07-01 2026-07-31
//
// A report key comes from QMP: Reports -> Custom Reports -> open the report ->
// Download Via API. Paste the URL and this takes the key out of it.
//
// Prints no secret and no token. Reads .env.local itself, which a plain tsx
// run does not do for you.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchQmpReport, QmpError, qmpConfig, qmpFetchToken } from '../src/lib/qmp';

function loadEnvLocal() {
  let text: string;
  try {
    text = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    if (process.env[key] !== undefined) continue;
    process.env[key] = match[2]!.trim().replace(/^["']|["']$/g, '');
  }
}

function keyFrom(raw: string): string {
  const match = /\/download\/([^/?#\s]+)/.exec(raw);
  return match ? decodeURIComponent(match[1]!) : raw;
}

async function main() {
  loadEnvLocal();
  const config = qmpConfig();

  console.log('base url:  ' + config.baseUrl);
  console.log('app:       ' + config.app);
  console.log('api key:   ' + (config.configured ? `set (${config.apiKey.length} chars)` : 'MISSING'));
  console.log('secret:    ' + (config.apiSecret ? `set (${config.apiSecret.length} chars)` : 'MISSING'));
  if (!config.configured) {
    console.error('\nSet QMP_API_KEY and QMP_API_SECRET in .env.local.');
    process.exit(1);
  }

  console.log('\n— token —');
  const token = await qmpFetchToken(config);
  console.log('access token: issued, ' + token.token.length + ' chars (not printed)');
  console.log('account:      ' + (token.userName ?? 'unnamed'));
  console.log('good until:   ' + new Date(token.expiresAt).toUTCString());
  console.log('permissions:  ' + JSON.stringify(token.permissions));

  const [rawKey, startDate, endDate] = process.argv.slice(2);
  // Falls back to the configured report, which is the normal case.
  const reportKey = rawKey ? keyFrom(rawKey) : config.reportId;
  if (!reportKey) {
    console.log('\nNo report to download: REPORT_ID is unset and none was passed.');
    console.log('Usage: npx tsx scripts/qmp-live.ts [reportId] [startDate] [endDate]');
    return;
  }

  console.log('\n— report ' + reportKey + ' —');
  const result = await fetchQmpReport({ reportKey, startDate, endDate, config });
  console.log('url:      ' + result.url);
  console.log('took:     ' + result.durationMs + 'ms');
  console.log('shape:    ' + result.table.shape);
  console.log('rows:     ' + result.table.rowCount);
  console.log('columns:  ' + (result.table.columns.join(', ') || 'none'));

  if (result.table.rowCount > 0) {
    console.log('\nfirst row:');
    console.log(JSON.stringify(result.table.rows[0], null, 2));
  } else {
    // The shape is undocumented, so an empty table is a thing to look at
    // rather than a thing to trust.
    console.log('\nno rows were recognised. raw payload, first 1500 characters:');
    console.log(JSON.stringify(result.raw).slice(0, 1500));
  }
}

main().catch((error) => {
  if (error instanceof QmpError) {
    console.error('\nQMP error (' + error.status + '): ' + error.message);
    console.error(error.hint);
  } else {
    console.error('\n' + (error instanceof Error ? error.message : String(error)));
  }
  process.exit(1);
});
