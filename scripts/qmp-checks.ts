// QMP report handling: config parsing, date rules, payload shapes, CSV.
//
// No network. The point is that a surprising report payload degrades to "no
// rows found, here is the raw JSON" rather than a crash or a silently empty
// table, because the response shape is not documented anywhere.
//
//   npx tsx scripts/qmp-checks.ts
import { QmpError, describeQmpError, normalizeDate, normalizeReport, qmpConfig, toCsv } from '../src/lib/qmp';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

function withEnv(env: Record<string, string | undefined>, run: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const CLEAR = {
  QMP_API_KEY: undefined,
  QMP_API_SECRET: undefined,
  CLIENT_ID: undefined,
  CLIENT_SECRET: undefined,
  QMP_BASE_URL: undefined,
  QMP_APP: undefined,
  QMP_REPORTS: undefined,
};

console.log('— configuration —');
withEnv({ ...CLEAR }, () => {
  const config = qmpConfig();
  check('no credentials means not configured', !config.configured);
  check('the reporting host is the default', config.baseUrl === 'https://reporting.qmp.ai');
  check('the app defaults to pub', config.app === 'pub');
});

withEnv({ ...CLEAR, QMP_API_KEY: 'key', QMP_API_SECRET: 'secret' }, () => {
  check('prefixed names configure it', qmpConfig().configured);
});

// CLIENT_ID / CLIENT_SECRET used to be accepted as a fallback. They are not
// any more, and that is the point of these two: those names belong to nobody in
// particular, so reading them meant that deploying into an environment where
// something else defined them would send that other integration's secret to
// QuinStreet on the first visit to /reports.
withEnv({ ...CLEAR, CLIENT_ID: 'key', CLIENT_SECRET: 'secret' }, () => {
  const config = qmpConfig();
  check('a bare CLIENT_ID does not configure QMP', !config.configured);
  check("and another integration's secret is never picked up", config.apiKey === '');
});

withEnv({ ...CLEAR, QMP_API_KEY: 'a', QMP_API_SECRET: 'b', CLIENT_ID: 'old', CLIENT_SECRET: 'old' }, () => {
  check('only the prefixed name is read', qmpConfig().apiKey === 'a');
});

withEnv({ ...CLEAR, QMP_API_KEY: 'k', QMP_API_SECRET: 's', QMP_BASE_URL: 'https://example.test/' }, () => {
  // A trailing slash here would produce '...//api/pub/download/x'.
  check('a trailing slash on the base url is dropped', qmpConfig().baseUrl === 'https://example.test');
});

console.log('\n— the fixed report —');
withEnv({ ...CLEAR, QMP_API_KEY: 'k', QMP_API_SECRET: 's', REPORT_ID: '93440' }, () => {
  const config = qmpConfig();
  check('REPORT_ID is read', config.reportId === '93440');
  check('credentials plus a report is ready', config.ready);
});

withEnv({ ...CLEAR, QMP_API_KEY: 'k', QMP_API_SECRET: 's' }, () => {
  const config = qmpConfig();
  check('credentials with no report is configured', config.configured);
  check('but not ready', !config.ready);
});

withEnv({ ...CLEAR, REPORT_ID: '93440' }, () => {
  check('a report with no credentials is not ready', !qmpConfig().ready);
});

withEnv({ ...CLEAR, QMP_API_KEY: 'k', QMP_API_SECRET: 's', QMP_REPORT_ID: '111', REPORT_ID: '222' }, () => {
  check('the prefixed report id wins', qmpConfig().reportId === '111');
});

// Pasting the whole Download Via API URL is the obvious thing to do.
withEnv(
  { ...CLEAR, REPORT_ID: 'https://reporting.qmp.ai/api/pub/download/93440?startDate=2026-01-01' },
  () => {
    check('a full URL is reduced to the id', qmpConfig().reportId === '93440');
  },
);
withEnv({ ...CLEAR, REPORT_ID: '  93440  ' }, () => {
  check('whitespace is trimmed', qmpConfig().reportId === '93440');
});

console.log('\n— dates —');
check('a real date passes through', normalizeDate('2026-08-13') === '2026-08-13');
check('empty means unset', normalizeDate('') === '');
check('null means unset', normalizeDate(null) === '');
check('whitespace is trimmed to unset', normalizeDate('   ') === '');
for (const bad of ['13-08-2026', '2026/08/13', 'yesterday', '2026-8-3', "2026-08-13'; DROP"]) {
  let threw = false;
  try {
    normalizeDate(bad);
  } catch (error) {
    threw = error instanceof QmpError;
  }
  check(`"${bad}" is refused`, threw);
}

console.log('\n— the shape QMP actually sends —');
// Captured from report 93440. Records are keyed by column position, and the
// names live in a sibling `columns` array.
const live = {
  requestId: 'ABC-123',
  lastRefreshedOn: '2026-08-13 13:47:54',
  data: {
    numberOfRecords: '2',
    columns: [
      'date', 'source_name', 'advertiser', 'card_name', 'device_type', 'var2', 'var3',
      'sub_id', 'session_ref_url', 'state', 'searches', 'clicks', 'applications',
      'approvals', 'avg_epc', 'total_earnings', 'impressions',
    ],
    records: [
      {
        '0': '2026-08-10', '1': '714025 Lets Get Funded - CC', '2': 'Bank of America',
        '3': 'Bank of America(R) Business Advantage', '4': 'Desktop', '5': 'Unknown',
        '6': 'Unknown', '7': 'JavaScriptTransition_JSWidget', '8': 'Unknown', '9': 'Wisconsin',
        '10': null, '11': null, '12': 1, '13': null, '14': null, '15': null, '16': null,
      },
      {
        '0': '2026-08-10', '1': '714025 Lets Get Funded - CC', '2': 'American Express',
        '3': 'Blue Business Cash Card', '4': 'Desktop', '5': 'Unknown', '6': 'Unknown',
        '7': 'JavaScriptTransition_JSWidget', '8': 'Unknown', '9': 'Texas',
        '10': null, '11': 2, '12': 1, '13': 1, '14': null, '15': 240, '16': null,
      },
    ],
  },
};

const liveTable = normalizeReport(live);
check('the live payload is recognised', liveTable.rowCount === 2);
check('and the shape is named', liveTable.shape === 'data.columns+records');
check('columns come back with real names', liveTable.columns[0] === 'date');
check('not positional indexes', !liveTable.columns.includes('0'));
check('all 17 columns survive', liveTable.columns.length === 17);
check('a value lands under its column', liveTable.rows[0]!.date === '2026-08-10');
check('the last column too', liveTable.rows[1]!.impressions === null);
check('approvals are readable by name', liveTable.rows[1]!.approvals === 1);
check('earnings are readable by name', liveTable.rows[1]!.total_earnings === 240);
check('nulls stay null rather than becoming undefined', liveTable.rows[0]!.approvals === null);

// The same pair, but with records as plain arrays.
const asArrays = { data: { columns: ['date', 'approvals'], records: [['2026-08-10', 3]] } };
check('array records work too', normalizeReport(asArrays).rows[0]!.approvals === 3);
check('and get named columns', normalizeReport(asArrays).columns.join() === 'date,approvals');

// columns without records, or records without columns, must not be claimed.
check('columns alone is not a table', normalizeReport({ data: { columns: ['a'] } }).rowCount === 0);
check(
  'non-string columns are ignored',
  normalizeReport({ data: { columns: [1, 2], records: [{ 0: 'x' }] } }).shape !== 'data.columns+records',
);

console.log('\n— report payload shapes —');
const rows = [
  { advertiser: 'Chase', approvals: 3, revenue: 250 },
  { advertiser: 'Citi', approvals: 1, revenue: 90 },
];

check('a bare array of rows', normalizeReport(rows).rowCount === 2);
check('columns come off the rows', normalizeReport(rows).columns.join(',') === 'advertiser,approvals,revenue');
check('{ data: rows }', normalizeReport({ data: rows }).rowCount === 2);
check('{ rows: rows }', normalizeReport({ rows }).rowCount === 2);
check('{ results: rows }', normalizeReport({ results: rows }).rowCount === 2);
check('{ records: rows }', normalizeReport({ records: rows }).rowCount === 2);
check('{ data: { rows } }', normalizeReport({ data: { rows } }).rowCount === 2);
check('the shape is reported', normalizeReport({ data: rows }).shape === 'data');
check('a nested shape is reported', normalizeReport({ data: { rows } }).shape === 'data.rows');

// The column union matters: a report can omit a null column on some rows, and
// reading only the first row would drop it from the table entirely.
const ragged = [{ a: 1 }, { a: 2, b: 3 }];
check('columns are the union across rows', normalizeReport(ragged).columns.join(',') === 'a,b');

check('null is empty, not a crash', normalizeReport(null).rowCount === 0);
check('undefined is empty', normalizeReport(undefined).rowCount === 0);
check('a string is empty', normalizeReport('nope').rowCount === 0);
check('an empty object is empty', normalizeReport({}).rowCount === 0);
check('an empty array is empty', normalizeReport([]).rowCount === 0);
check('an array of scalars is not rows', normalizeReport([1, 2, 3]).rowCount === 0);
check('an unknown shape says so', normalizeReport({ mystery: { deeper: rows } }).shape === 'unrecognised');
check('an empty rows array still reads as rows', normalizeReport({ data: [] }).shape === 'data');

console.log('\n— error bodies —');
// Both shapes are real, captured from live 404 and 400 responses.
check(
  'the QMP app shape reads errorMessage',
  describeQmpError('{"errorCode":404,"errorMessage":"Report details not found","requestId":"6B7ADC13"}') ===
    'Report details not found (QMP request 6B7ADC13)',
);
check(
  'the Spring problem shape reads detail',
  describeQmpError(
    '{"type":"about:blank","title":"Bad Request","status":400,"detail":"Failed to convert \'extractId\' with value: \'abc\'"}',
  ) === "Failed to convert 'extractId' with value: 'abc'",
);
check(
  'title is the last resort',
  describeQmpError('{"type":"about:blank","title":"Bad Request","status":400}') === 'Bad Request',
);
check('a non-JSON body is passed through', describeQmpError('<html>502 Bad Gateway</html>') === '<html>502 Bad Gateway</html>');
check('an empty body stays empty', describeQmpError('') === '');
check('JSON with nothing readable falls back to the body', describeQmpError('{"unrelated":1}') === '{"unrelated":1}');
check(
  'a blank errorMessage does not win',
  describeQmpError('{"errorMessage":"   ","detail":"the real one"}') === 'the real one',
);

console.log('\n— csv —');
const csv = toCsv(['advertiser', 'revenue'], rows);
check('a header row is written', csv.split('\r\n')[0] === 'advertiser,revenue');
check('values follow', csv.split('\r\n')[1] === 'Chase,250');
check(
  'a comma is quoted',
  toCsv(['a'], [{ a: 'Chase, N.A.' }]).split('\r\n')[1] === '"Chase, N.A."',
);
check(
  'a quote is doubled',
  toCsv(['a'], [{ a: 'say "hi"' }]).split('\r\n')[1] === '"say ""hi"""',
);
check('a newline is quoted', toCsv(['a'], [{ a: 'one\ntwo' }]).split('\r\n')[1] === '"one\ntwo"');
check('null is blank', toCsv(['a'], [{ a: null }]).split('\r\n')[1] === '');
check('a missing key is blank', toCsv(['a', 'b'], [{ a: 1 }]).split('\r\n')[1] === '1,');
check('an object cell is JSON', toCsv(['a'], [{ a: { x: 1 } }]).split('\r\n')[1] === '"{""x"":1}"');
check('zero survives as zero', toCsv(['a'], [{ a: 0 }]).split('\r\n')[1] === '0');

console.log(`\nqmp: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
