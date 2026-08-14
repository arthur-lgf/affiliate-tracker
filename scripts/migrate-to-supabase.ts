// Copy everything out of the current store and into Supabase.
//
//   npx tsx scripts/migrate-to-supabase.ts                  # dry run, local JSON
//   npx tsx scripts/migrate-to-supabase.ts --apply          # write it
//   npx tsx scripts/migrate-to-supabase.ts --from=sheets    # read the Google Sheet
//
// Nothing is written without --apply. The dry run reports exactly what would
// be inserted, which is the only way to find out that a source is empty before
// rather than after.
//
// Re-running is safe. Rows already present are left alone rather than
// overwritten: a migration that clobbers is a migration you cannot run twice,
// and by the second run the database may hold newer data than the source does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalStore } from '../src/lib/store/local';
import { createSheetsStore } from '../src/lib/store/sheets';
import { getSupabaseClient, isSupabaseConfigured } from '../src/lib/store/supabase';
import type { Conversion, Store, Submission, Visit, AffiliateLink } from '../src/lib/types';

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

const BATCH = 500;

async function insertMissing(
  table: string,
  rows: Record<string, unknown>[],
  conflictColumn: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = getSupabaseClient();
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    // ignoreDuplicates keeps this additive: an id already in the table is left
    // exactly as it is.
    const { data, error } = await supabase
      .from(table)
      .upsert(chunk, { onConflict: conflictColumn, ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`${table}: ${error.message}${error.code ? ` (${error.code})` : ''}`);
    written += data?.length ?? 0;
  }
  return written;
}

async function countRows(table: string): Promise<number> {
  const { count, error } = await getSupabaseClient()
    .from(table)
    .select('id', { count: 'exact', head: true });
  if (error) throw new Error(`counting ${table}: ${error.message}`);
  return count ?? 0;
}

function linkRow(link: AffiliateLink) {
  return {
    id: link.id,
    created_at: link.createdAt || new Date().toISOString(),
    slug: link.slug,
    usr: link.usr,
    assignee: link.assignee,
    assignee_email: link.assigneeEmail,
    destination: link.destination,
    campaign: link.campaign,
    headline: link.headline,
    subheadline: link.subheadline,
    cta_label: link.ctaLabel,
    require_phone: link.requirePhone,
    pass_usr_param: link.passUsrParam,
    active: link.active,
    notes: link.notes,
  };
}

function submissionRow(row: Submission) {
  return {
    id: row.id,
    created_at: row.createdAt || new Date().toISOString(),
    slug: row.slug,
    usr: row.usr,
    assignee: row.assignee,
    campaign: row.campaign,
    full_name: row.fullName,
    email: row.email,
    phone: row.phone,
    destination: row.destination,
    referrer: row.referrer,
    user_agent: row.userAgent,
    ip: row.ip,
    status: row.status,
  };
}

function visitRow(row: Visit) {
  return {
    id: row.id,
    created_at: row.createdAt || new Date().toISOString(),
    slug: row.slug,
    usr: row.usr,
    referrer: row.referrer,
    user_agent: row.userAgent,
    ip: row.ip,
  };
}

/**
 * Conversions have no stable id to carry over: both the sheet and the JSON
 * address a row by its position plus a hash of its contents, and position is
 * exactly what a copy does not preserve. So they are matched on what they say
 * instead, and anything already saying the same thing is skipped.
 */
function conversionKey(row: Pick<Conversion, 'approvedOn' | 'slug' | 'usr' | 'amount' | 'notes'>): string {
  return [row.approvedOn, row.slug, row.usr, Number(row.amount).toFixed(2), row.notes].join('|');
}

async function main() {
  loadEnvLocal();

  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const fromArg = args.find((a) => a.startsWith('--from='));
  const from = fromArg ? fromArg.slice('--from='.length) : 'local';

  if (from !== 'local' && from !== 'sheets') {
    console.error(`Unknown source "${from}". Use --from=local or --from=sheets.`);
    process.exit(1);
  }

  if (!isSupabaseConfigured()) {
    console.error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
    process.exit(1);
  }

  // Built directly, never through getStore(): that now prefers Supabase, and
  // would have this copy the database onto itself.
  const source: Store = from === 'sheets' ? createSheetsStore() : createLocalStore();
  console.log(`source:      ${from}`);
  console.log(`destination: ${process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`mode:        ${apply ? 'APPLY (writes)' : 'dry run (writes nothing)'}`);
  console.log('');

  const [links, submissions, visits, conversions] = await Promise.all([
    source.listLinks(),
    source.listSubmissions(),
    source.listVisits(),
    source.listConversions(),
  ]);

  console.log('read from source:');
  console.log(`  links        ${links.length}`);
  console.log(`  submissions  ${submissions.length}`);
  console.log(`  visits       ${visits.length}`);
  console.log(`  conversions  ${conversions.length}`);
  console.log('');

  // Conversions are matched on content, so the existing set has to be read
  // before anything is written.
  const existingConversions = new Set<string>();
  if (conversions.length > 0) {
    const { data, error } = await getSupabaseClient()
      .from('conversions')
      .select('approved_on, slug, usr, amount, notes');
    if (error) throw new Error(`reading conversions: ${error.message}`);
    for (const row of data ?? []) {
      existingConversions.add(
        conversionKey({
          approvedOn: String(row.approved_on),
          slug: String(row.slug),
          usr: String(row.usr ?? ''),
          amount: Number(row.amount),
          notes: String(row.notes ?? ''),
        }),
      );
    }
  }

  const newConversions = conversions.filter((row) => !existingConversions.has(conversionKey(row)));

  if (!apply) {
    console.log('would insert (rows already present are skipped):');
    console.log(`  links        up to ${links.length}`);
    console.log(`  submissions  up to ${submissions.length}`);
    console.log(`  visits       up to ${visits.length}`);
    console.log(`  conversions  ${newConversions.length} of ${conversions.length}`);
    console.log('');
    console.log('Nothing was written. Re-run with --apply to migrate.');
    return;
  }

  const wroteLinks = await insertMissing('links', links.map(linkRow), 'id');
  const wroteSubmissions = await insertMissing('submissions', submissions.map(submissionRow), 'id');
  const wroteVisits = await insertMissing('visits', visits.map(visitRow), 'id');

  let wroteConversions = 0;
  if (newConversions.length > 0) {
    const supabase = getSupabaseClient();
    for (let i = 0; i < newConversions.length; i += BATCH) {
      const chunk = newConversions.slice(i, i + BATCH).map((row) => ({
        created_at: row.createdAt || new Date().toISOString(),
        approved_on: row.approvedOn,
        slug: row.slug,
        usr: row.usr,
        amount: row.amount,
        notes: row.notes,
      }));
      const { data, error } = await supabase.from('conversions').insert(chunk).select('id');
      if (error) throw new Error(`conversions: ${error.message}`);
      wroteConversions += data?.length ?? 0;
    }
  }

  console.log('inserted:');
  console.log(`  links        ${wroteLinks}`);
  console.log(`  submissions  ${wroteSubmissions}`);
  console.log(`  visits       ${wroteVisits}`);
  console.log(`  conversions  ${wroteConversions}`);
  console.log('');

  // Counted from the database rather than assumed from what was sent.
  const [nl, ns, nv, nc] = await Promise.all([
    countRows('links'),
    countRows('submissions'),
    countRows('visits'),
    countRows('conversions'),
  ]);
  console.log('now in supabase:');
  console.log(`  links        ${nl}  (source had ${links.length})`);
  console.log(`  submissions  ${ns}  (source had ${submissions.length})`);
  console.log(`  visits       ${nv}  (source had ${visits.length})`);
  console.log(`  conversions  ${nc}  (source had ${conversions.length})`);

  const short = [
    nl < links.length && 'links',
    ns < submissions.length && 'submissions',
    nv < visits.length && 'visits',
    nc < conversions.length && 'conversions',
  ].filter(Boolean);
  if (short.length > 0) {
    console.error(`\nFewer rows than the source in: ${short.join(', ')}. Do not switch over yet.`);
    process.exit(1);
  }
  console.log('\nEvery source row is accounted for.');
}

main().catch((error) => {
  console.error('\n' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
