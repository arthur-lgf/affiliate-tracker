// The Supabase adapter, against a stand-in PostgREST.
//
// Two of these matter more than the rest:
//
//   - Paging. PostgREST answers with at most 1000 rows. An adapter that asks
//     once and stops would under-report every figure on the dashboard the day
//     the 1001st visit is logged, silently and forever.
//   - numeric arrives as a STRING. Money read straight through would become
//     "600.00" and every sum would turn into string concatenation.
//
//   npx tsx scripts/supabase-store-checks.ts
import { createServer, type Server } from 'node:http';
import { createSupabaseStore, resetSupabaseClient, submissionToRow } from '../src/lib/store/supabase';
import { StoreConflictError, StoreConfigError, StoreNotFoundError } from '../src/lib/store/errors';
import type { Submission } from '../src/lib/types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

type Table = Record<string, unknown>[];
const db: Record<string, Table> = { links: [], submissions: [], visits: [], conversions: [] };
/** Set to make the next request fail with this PostgREST error. */
let nextError: { status: number; body: unknown } | null = null;
const requests: { method: string; url: string; range: string | null; table: string; body: string }[] = [];

/**
 * The fields the adapter actually sent on its most recent request of this
 * kind. What reaches PostgREST is the thing that matters: a column named in a
 * write that the database does not have yet fails the whole write.
 */
function lastBody(method: string, table: string): Record<string, unknown> {
  const hit = [...requests].reverse().find((r) => r.method === method && r.table === table);
  return hit?.body ? (JSON.parse(hit.body) as Record<string, unknown>) : {};
}

/** Same keys, same values. Key order is how the adapter happened to build it, not a promise. */
function sameFields(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  const keys = (row: Record<string, unknown>) => Object.keys(row).sort();
  return (
    JSON.stringify(keys(actual)) === JSON.stringify(keys(expected)) &&
    keys(expected).every((key) => actual[key] === expected[key])
  );
}

function start(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const table = url.pathname.replace('/rest/v1/', '');
      const entry = {
        method: req.method ?? '',
        url: req.url ?? '',
        range: new URL(req.url ?? '/', 'http://localhost').searchParams.get('offset'),
        table,
        body: '',
      };
      requests.push(entry);

      // .single() and .maybeSingle() ask for a bare object with this Accept
      // header, and PostgREST answers with one row rather than an array, or
      // PGRST116 when there is nothing to return.
      const wantsOne = String(req.headers.accept ?? '').includes('vnd.pgrst.object+json');

      const send = (status: number, body: unknown) => {
        let payload = body;
        if (wantsOne && Array.isArray(body)) {
          if (body.length === 0) {
            res.writeHead(406, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ code: 'PGRST116', message: 'Results contain 0 rows' }));
            return;
          }
          payload = body[0];
        }
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (nextError) {
        const err = nextError;
        nextError = null;
        return send(err.status, err.body);
      }

      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        entry.body = body;
        const rows = db[table] ?? [];

        if (req.method === 'GET') {
          // A single-row read by id (.eq('id', …)) has to find that row, not
          // whichever happens to be first in the table.
          const idFilter = url.searchParams.get('id')?.replace('eq.', '');
          const pool = idFilter === undefined ? rows : rows.filter((r) => String(r.id) === idFilter);
          // postgrest-js turns .range(from, to) into offset + limit params.
          const offset = Number(url.searchParams.get('offset') ?? '0');
          const limit = Number(url.searchParams.get('limit') ?? String(pool.length));
          return send(200, pool.slice(offset, offset + limit));
        }

        if (req.method === 'POST') {
          const parsed = JSON.parse(body || '[]');
          const incoming = Array.isArray(parsed) ? parsed : [parsed];
          const inserted = incoming.map((row: Record<string, unknown>) => {
            const withId = { id: row.id ?? String(rows.length + 1), ...row };
            rows.push(withId);
            return withId;
          });
          return send(201, inserted);
        }

        if (req.method === 'PATCH') {
          const idFilter = url.searchParams.get('id')?.replace('eq.', '');
          const patch = JSON.parse(body || '{}');
          const hit = rows.find((r) => String(r.id) === idFilter);
          if (!hit) return send(200, []);
          Object.assign(hit, patch);
          return send(200, [hit]);
        }

        if (req.method === 'DELETE') {
          const idFilter = url.searchParams.get('id')?.replace('eq.', '');
          const index = rows.findIndex((r) => String(r.id) === idFilter);
          if (index === -1) return send(200, []);
          const [removed] = rows.splice(index, 1);
          return send(200, [removed]);
        }

        send(405, { message: 'not allowed' });
      });
    });
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://localhost:${port}` });
    });
  });
}

async function main() {
  const { server, url } = await start();
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  resetSupabaseClient();
  const store = createSupabaseStore();

  check('the adapter reports its kind', store.kind === 'supabase');

  console.log('— paging past the 1000 row cap —');
  db.visits = Array.from({ length: 2350 }, (_, i) => ({
    id: `v${String(i).padStart(5, '0')}`,
    created_at: '2026-08-01T00:00:00.000Z',
    slug: 'bestcards',
    usr: 'mark',
    referrer: '',
    user_agent: '',
    ip: '',
  }));
  requests.length = 0;
  const visits = await store.listVisits();
  check('every row is returned, not the first 1000', visits.length === 2350);
  check('it took three requests', requests.filter((r) => r.method === 'GET').length === 3);
  check('the first page starts at 0', requests[0]?.range === '0');
  check('the second starts at 1000', requests[1]?.range === '1000');
  check('the third starts at 2000', requests[2]?.range === '2000');
  check('the first row survives', visits[0]!.id === 'v00000');
  check('the last row survives', visits[2349]!.id === 'v02349');
  check('no duplicates across page boundaries', new Set(visits.map((v) => v.id)).size === 2350);

  // Exactly on the boundary: a full last page must still trigger one more
  // request, or the adapter would stop one row short of knowing it is done.
  db.visits = Array.from({ length: 2000 }, (_, i) => ({ id: `b${i}`, created_at: '', slug: '', usr: '' }));
  requests.length = 0;
  const exact = await store.listVisits();
  check('an exact multiple of the page size is complete', exact.length === 2000);
  check('and cost one extra empty request', requests.filter((r) => r.method === 'GET').length === 3);

  console.log('\n— money —');
  db.conversions = [
    { id: 1, created_at: '', approved_on: '2026-08-10', slug: 'bestcards', usr: 'mark', amount: '600.00', notes: 'a' },
    { id: 2, created_at: '', approved_on: '2026-08-11', slug: 'bestcards', usr: 'mark', amount: '720.50', notes: 'b' },
    { id: 3, created_at: '', approved_on: '2026-08-12', slug: 'bestcards', usr: '', amount: '0.00', notes: '' },
  ];
  const conversions = await store.listConversions();
  check('a numeric string becomes a number', typeof conversions[0]!.amount === 'number');
  check('and keeps its value', conversions[0]!.amount === 600);
  check('including the cents', conversions[1]!.amount === 720.5);
  check('zero stays zero', conversions[2]!.amount === 0);
  // The bug this prevents: string amounts concatenate instead of adding.
  const total = conversions.reduce((sum, row) => sum + row.amount, 0);
  check('they add up rather than concatenate', total === 1320.5);
  check('the id is a string, as the interface says', typeof conversions[0]!.id === 'string');

  console.log('\n— reading and writing —');
  db.links = [
    {
      id: 'l1', created_at: '2026-08-01T00:00:00.000Z', slug: 'bestcards', usr: 'mark',
      assignee: 'Mark', assignee_email: '', destination: 'https://x.test?src=1', campaign: 'Best',
      headline: '', subheadline: '', cta_label: '', require_phone: false,
      pass_usr_param: 'subid', active: true, notes: '',
    },
  ];
  const links = await store.listLinks();
  check('snake_case maps to camelCase', links[0]!.assigneeEmail === '');
  check('pass_usr_param maps across', links[0]!.passUsrParam === 'subid');
  check('booleans survive', links[0]!.requirePhone === false && links[0]!.active === true);
  check('created_at maps to createdAt', links[0]!.createdAt === '2026-08-01T00:00:00.000Z');

  const created = await store.createLink({
    slug: 'travel', usr: 'dana', assignee: 'Dana', assigneeEmail: 'd@x.test',
    destination: 'https://x.test?src=2', campaign: 'Travel', headline: '', subheadline: '',
    ctaLabel: '', requirePhone: true, passUsrParam: 'subid', active: true, notes: 'n',
  });
  check('a created link comes back mapped', created.slug === 'travel' && created.usr === 'dana');
  check('and was given an id', created.id.length > 0);
  check('and a created_at', created.createdAt.length > 0);

  const lead = await store.addSubmission({
    id: 'pm2icr9y0icm', slug: 'bestcards', usr: 'mark', assignee: 'Mark', campaign: 'Best',
    fullName: 'Priya', email: 'p@x.test', phone: '555', destination: 'https://x.test?var3=pm2icr9y0icm',
    referrer: '', userAgent: '', ip: '',
  });
  // The reference travels in the URL, so the row must keep the id it was given.
  check('a supplied lead id is kept, not replaced', lead.id === 'pm2icr9y0icm');
  check('the lead starts pending', lead.status === 'pending');
  check('and with no card, until a sync sees one', lead.card === '');
  // Left to the column default rather than sent as '': lead capture is the one
  // write a visitor makes, and naming a column the database does not have yet
  // would fail it on any deploy that lands before the migration does.
  check(
    'the insert never names card',
    !Object.prototype.hasOwnProperty.call(lastBody('POST', 'submissions'), 'card'),
  );

  const auto = await store.addSubmission({
    slug: 'bestcards', usr: '', assignee: '', campaign: '', fullName: '', email: 'x@x.test',
    phone: '', destination: '', referrer: '', userAgent: '', ip: '',
  });
  check('an absent lead id is generated', auto.id.length >= 12 && auto.id !== 'pm2icr9y0icm');

  const updated = await store.updateSubmission('pm2icr9y0icm', { status: 'registered' });
  check('a status update comes back applied', updated.status === 'registered');

  console.log('\n— the card a lead applied for —');
  const applied = await store.updateSubmission('pm2icr9y0icm', {
    status: 'applied',
    card: 'Chase Sapphire Preferred',
  });
  check(
    'status and card come back as written',
    applied.status === 'applied' && applied.card === 'Chase Sapphire Preferred',
  );
  check(
    'and both were sent',
    sameFields(lastBody('PATCH', 'submissions'), { status: 'applied', card: 'Chase Sapphire Preferred' }),
  );

  // The admin toggle sends a status and nothing else. Sending the card with it
  // would blank the one the sync recorded, and on a database without the
  // column yet would fail the toggle outright.
  const toggled = await store.updateSubmission('pm2icr9y0icm', { status: 'registered' });
  check(
    'a status-only patch sends only the status',
    sameFields(lastBody('PATCH', 'submissions'), { status: 'registered' }),
  );
  check('and leaves the card alone', toggled.card === 'Chase Sapphire Preferred');

  const recarded = await store.updateSubmission('pm2icr9y0icm', {
    card: 'Chase Sapphire Preferred, Chase Freedom',
  });
  check(
    'a card-only patch sends only the card',
    sameFields(lastBody('PATCH', 'submissions'), { card: 'Chase Sapphire Preferred, Chase Freedom' }),
  );
  check('and leaves the status alone', recarded.status === 'registered');

  requests.length = 0;
  const untouched = await store.updateSubmission('pm2icr9y0icm', {});
  check('an empty patch sends no update at all', !requests.some((r) => r.method === 'PATCH'));
  check(
    'and hands back the row as it stands',
    untouched.id === 'pm2icr9y0icm' &&
      untouched.status === 'registered' &&
      untouched.card === 'Chase Sapphire Preferred, Chase Freedom',
  );
  let missing: unknown = null;
  try {
    await store.updateSubmission('nope', {});
  } catch (error) {
    missing = error;
  }
  check('an empty patch on a lead that is not there is a not-found', missing instanceof StoreNotFoundError);

  console.log('\n— rows from before the card column —');
  db.submissions = [
    // What every row looks like until the migration adds the column.
    { id: 'old', created_at: '2026-08-01T00:00:00.000Z', slug: 'bestcards', usr: 'mark', status: 'registered' },
    { id: 'nul', created_at: '2026-08-02T00:00:00.000Z', slug: 'bestcards', usr: 'mark', status: 'applied', card: null },
    {
      id: 'new', created_at: '2026-08-03T00:00:00.000Z', slug: 'bestcards', usr: 'mark',
      status: 'applied', card: 'Chase Freedom Unlimited',
    },
  ];
  const [old, nul, fresh] = await store.listSubmissions();
  check('a database without the card column reads as no card', old!.card === '');
  check('and keeps its status', old!.status === 'registered');
  check('a null card reads as no card', nul!.card === '');
  check('applied reads back as applied', nul!.status === 'applied');
  check('a recorded card reads back as written', fresh!.card === 'Chase Freedom Unlimited');

  console.log('\n— a lead copied in by the migration script —');
  /*
   * scripts/migrate-to-supabase.ts copies every lead out of the Sheet or the
   * JSON file with this mapping. A field it leaves out is lost in the move and
   * nothing says so, because the column default fills the gap. So a lead copied
   * across has to read back as exactly the lead it was, card and status too.
   */
  const source: Submission = {
    id: 'rc7czk6xa61y',
    createdAt: '2026-09-01T12:00:00.000Z',
    slug: 'bestcards',
    usr: 'mark',
    assignee: 'Mark',
    campaign: 'Best',
    fullName: 'Priya Nair',
    email: 'priya@x.test',
    phone: '555 0100',
    destination: 'https://x.test/?var2=mark&var3=rc7czk6xa61y',
    referrer: 'https://ref.test/',
    userAgent: 'Mozilla/5.0',
    ip: '203.0.113.9',
    status: 'applied',
    card: 'Chase Sapphire Preferred, Chase Freedom',
  };
  db.submissions = [{ ...submissionToRow(source) }];
  const [copied] = await store.listSubmissions();
  check('a copied lead reads back exactly as it was', Boolean(copied) && sameFields(copied!, source));
  check('its card comes across', copied?.card === 'Chase Sapphire Preferred, Chase Freedom');
  check('and its status', copied?.status === 'applied');

  console.log('\n— failures that must not look like success —');
  let threw: unknown = null;
  try {
    await store.deleteLink('does-not-exist');
  } catch (error) {
    threw = error;
  }
  check('deleting nothing is a not-found', threw instanceof StoreNotFoundError);

  threw = null;
  try {
    await store.updateSubmission('nope', { status: 'registered' });
  } catch (error) {
    threw = error;
  }
  check('updating nothing is a not-found', threw instanceof StoreNotFoundError);

  threw = null;
  nextError = { status: 409, body: { code: '23505', message: 'duplicate key value' } };
  try {
    await store.createLink({
      slug: 'bestcards', usr: 'mark', assignee: '', assigneeEmail: '', destination: 'https://x.test',
      campaign: '', headline: '', subheadline: '', ctaLabel: '', requirePhone: false,
      passUsrParam: '', active: true, notes: '',
    });
  } catch (error) {
    threw = error;
  }
  check('a unique violation is a conflict', threw instanceof StoreConflictError);
  check('and says what collided', /already exists/.test((threw as Error).message));

  threw = null;
  nextError = { status: 404, body: { code: '42P01', message: 'relation "links" does not exist' } };
  try {
    await store.listLinks();
  } catch (error) {
    threw = error;
  }
  check('a missing table is a configuration error', threw instanceof StoreConfigError);
  check('and names the fix', /db push/.test((threw as Error).message));

  threw = null;
  nextError = { status: 401, body: { code: '42501', message: 'permission denied for table links' } };
  try {
    await store.listLinks();
  } catch (error) {
    threw = error;
  }
  check('permission denied is a configuration error', threw instanceof StoreConfigError);
  check('and points at the wrong key', /service role key/.test((threw as Error).message));

  /*
   * A write naming a column the table does not have. The sync names card on
   * every lead it moves, so on a database the card migration has not reached,
   * every one of those writes gets this. It is the migrations being behind the
   * code, a setup problem with one fix rather than anything wrong with the
   * lead, so it is a configuration error that names the column and the fix,
   * in words rather than PostgREST's.
   */
  threw = null;
  nextError = {
    status: 400,
    body: { code: 'PGRST204', message: "Could not find the 'card' column of 'submissions' in the schema cache" },
  };
  try {
    await store.updateSubmission('rc7czk6xa61y', { status: 'registered', card: 'Chase Freedom Unlimited' });
  } catch (error) {
    threw = error;
  }
  const behind = threw instanceof Error ? threw.message : '';
  check('a column the database does not have yet is a configuration error', threw instanceof StoreConfigError);
  check('which names the column and its table', /"card"/.test(behind) && /submissions/.test(behind));
  check('and the fix', /npx supabase db push/.test(behind));
  check("in words rather than PostgREST's", !/schema cache|PGRST204/.test(behind));

  threw = null;
  nextError = { status: 400, body: { code: 'PGRST204', message: 'worded some other way' } };
  try {
    await store.updateSubmission('rc7czk6xa61y', { status: 'registered', card: 'Chase Freedom Unlimited' });
  } catch (error) {
    threw = error;
  }
  check(
    'worded some other way, it still says the migrations are behind',
    threw instanceof StoreConfigError && /npx supabase db push/.test((threw as Error).message),
  );

  // Drop keep-alive sockets before closing, then let the process end on its
  // own. Calling process.exit() here trips a libuv assertion on Windows while
  // connections are still open, which reads like a failure next to a clean run.
  server.closeAllConnections?.();
  server.close();
  console.log(`\nsupabase-store: ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
