/**
 * QuinStreet Media Platform (QMP) reporting API.
 *
 * Two calls, in this order:
 *
 *   1. POST {base}/oauth/generatetoken?grant_type=client_credentials
 *      HTTP Basic, api key as the user and the secret as the password.
 *      Returns { access_token, token_type: "Bearer", expires_in, permissions }.
 *
 *   2. GET  {base}/api/{app}/download/{reportKey}?startDate=&endDate=
 *      Authorization: Bearer <access_token>. Returns the report as JSON.
 *
 * Both were read off QMP's own "Download Via API" screen, which generates a
 * Python snippet describing exactly this. `app` is "pub" for a Publisher
 * Services login and "client" otherwise; the token response says which one the
 * credentials are for.
 *
 * There is no endpoint that lists saved reports — every path that would do it
 * 404s. A report key comes from the QMP UI: Reports -> Custom Reports -> open
 * the report -> Download Via API, and it is the last segment of the URL shown
 * there. That is why this module takes keys rather than discovering them.
 */

export type QmpConfig = {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  app: string;
  /**
   * The saved report to pull, from REPORT_ID. Fixed in the environment rather
   * than typed in: there is one report this is pointed at, and letting the
   * page choose only invites pulling the wrong one.
   */
  reportId: string;
  /** Credentials present. */
  configured: boolean;
  /** Credentials and a report id: everything needed to actually fetch. */
  ready: boolean;
};

/** A QMP call that failed in a way worth showing rather than swallowing. */
export class QmpError extends Error {
  readonly status: number;
  readonly hint: string;

  constructor(message: string, status: number, hint: string) {
    super(message);
    this.name = 'QmpError';
    this.status = status;
    this.hint = hint;
  }
}

/**
 * The statuses QMP documents on its own API screen. Worth mapping: a bare 403
 * is indistinguishable between "no token" and "token expired", and the fix
 * differs.
 */
function hintFor(status: number): string {
  if (status === 400) return 'QMP rejected the request as malformed. Check the report key and the dates.';
  if (status === 401 || status === 403) {
    return 'QMP refused the credentials. Check the API key and secret, and that the key is still active in QMP.';
  }
  if (status === 404) return 'QMP has no report with that key for this account.';
  if (status === 429) return 'QMP is rate limiting. Wait a moment and try again.';
  if (status >= 500) return 'QMP had a server error. This is their side, not yours.';
  return 'QMP returned an unexpected status.';
}

/**
 * Credentials.
 *
 * QMP_API_KEY / QMP_API_SECRET only. The bare CLIENT_ID / CLIENT_SECRET names
 * used to be accepted as a fallback, because that is what the account was first
 * set up with — but those names belong to nobody in particular. Deploy this
 * into an environment where something else already defines them (an OAuth app,
 * an SSO provider, a partner API) and the first visit to /reports would send
 * that unrelated integration's credentials, base64-encoded, to QuinStreet.
 * Sending someone else's secret to a third party is not a fallback worth
 * keeping, so the prefixed names are now the only ones read.
 */
export function qmpConfig(): QmpConfig {
  const apiKey = (process.env.QMP_API_KEY || '').trim();
  const apiSecret = (process.env.QMP_API_SECRET || '').trim();
  const baseUrl = (process.env.QMP_BASE_URL || 'https://reporting.qmp.ai').trim().replace(/\/+$/, '');
  const app = (process.env.QMP_APP || 'pub').trim();

  // A whole Download Via API URL is accepted here too, so the value can be
  // pasted straight out of QMP without trimming it down to the id by hand.
  const rawReport = (process.env.QMP_REPORT_ID || process.env.REPORT_ID || '').trim();
  const fromUrl = /\/download\/([^/?#\s]+)/.exec(rawReport);
  const reportId = fromUrl ? decodeURIComponent(fromUrl[1]!) : rawReport;

  const configured = apiKey.length > 0 && apiSecret.length > 0;
  return { apiKey, apiSecret, baseUrl, app, reportId, configured, ready: configured && reportId.length > 0 };
}

/**
 * Tokens last about 48 hours, so one is cached and reused. Keyed on the
 * credentials so changing the key in the environment cannot serve a token
 * minted for the old one.
 */
let cached: { id: string; token: string; expiresAt: number } | null = null;

function credentialId(config: QmpConfig): string {
  return `${config.baseUrl}|${config.apiKey}|${config.apiSecret.length}`;
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new QmpError(`QMP did not respond within ${Math.round(ms / 1000)}s.`, 504, 'Try again; if it persists, QMP is slow or unreachable.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Basic credentials, without pulling in Buffer so this stays runtime-agnostic. */
function basicHeader(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

export type QmpToken = {
  token: string;
  expiresAt: number;
  /** What the credentials can see. Useful for confirming the account. */
  permissions?: unknown;
  userName?: string;
};

/** Fetch a token, ignoring the cache. Used by the connection check. */
export async function qmpFetchToken(config = qmpConfig()): Promise<QmpToken> {
  if (!config.configured) {
    throw new QmpError('QMP is not configured.', 0, 'Set QMP_API_KEY and QMP_API_SECRET in .env.local.');
  }

  const url = `${config.baseUrl}/oauth/generatetoken?grant_type=client_credentials`;
  const response = await withTimeout(20_000, (signal) =>
    fetch(url, {
      method: 'POST',
      headers: { authorization: basicHeader(config.apiKey, config.apiSecret), accept: 'application/json' },
      signal,
      cache: 'no-store',
    }),
  );

  if (!response.ok) {
    throw new QmpError(`QMP refused to issue a token (HTTP ${response.status}).`, response.status, hintFor(response.status));
  }

  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    permissions?: unknown;
    userName?: string;
  };
  if (!body.access_token) {
    throw new QmpError('QMP returned no access token.', 502, 'The token call succeeded but the body had no access_token.');
  }

  // Expire a minute early so a token cannot lapse mid-request.
  const ttl = typeof body.expires_in === 'number' && body.expires_in > 120 ? body.expires_in : 3600;
  return {
    token: body.access_token,
    expiresAt: Date.now() + (ttl - 60) * 1000,
    permissions: body.permissions,
    userName: body.userName,
  };
}

export async function qmpAccessToken(config = qmpConfig()): Promise<string> {
  const id = credentialId(config);
  if (cached && cached.id === id && cached.expiresAt > Date.now()) return cached.token;

  const fresh = await qmpFetchToken(config);
  cached = { id, token: fresh.token, expiresAt: fresh.expiresAt };
  return fresh.token;
}

/**
 * Pull the readable part out of a QMP error body.
 *
 * QMP answers with two different shapes depending on how far the request got,
 * and neither uses `message`:
 *
 *   {"errorCode":404,"errorMessage":"Report details not found","requestId":"..."}
 *   {"type":"about:blank","title":"Bad Request","detail":"Failed to convert
 *    'extractId' with value: 'abc'","instance":"/api/pub/download/abc"}
 *
 * The requestId is kept when there is one: it is what QuinStreet support will
 * ask for.
 */
export function describeQmpError(body: string): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return body.slice(0, 300).trim();
  }

  let detail = '';
  for (const key of ['errorMessage', 'detail', 'message', 'error_description', 'error', 'title']) {
    const value = parsed[key];
    if (typeof value === 'string' && value.trim()) {
      detail = value.trim();
      break;
    }
  }
  if (!detail) return body.slice(0, 300).trim();

  const requestId = parsed.requestId;
  return typeof requestId === 'string' && requestId ? `${detail} (QMP request ${requestId})` : detail;
}

/** A YYYY-MM-DD date, or '' for "not set". Anything else is refused. */
export function normalizeDate(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new QmpError(`"${value}" is not a date.`, 400, 'Dates must be YYYY-MM-DD.');
  }
  return value;
}

export type QmpTable = {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Where in the payload the rows were found, so a surprise shape is visible. */
  shape: string;
  rowCount: number;
};

function isRowArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item));
}

/**
 * Turn whatever QMP sends into columns and rows.
 *
 * The response shape is not documented and QMP's own snippet just prints it,
 * so this looks in the places a report payload plausibly hides rather than
 * assuming one. Anything it cannot read is still returned as raw JSON by the
 * route, so an unexpected shape shows up as something to look at instead of an
 * empty table.
 */
export function normalizeReport(payload: unknown): QmpTable {
  const empty: QmpTable = { columns: [], rows: [], shape: 'unrecognised', rowCount: 0 };
  if (payload === null || payload === undefined) return empty;

  if (isRowArray(payload)) return tableFrom(payload, 'array');

  if (typeof payload !== 'object') return empty;
  const record = payload as Record<string, unknown>;

  // What QMP actually sends:
  //
  //   { requestId, lastRefreshedOn,
  //     data: { columns: ["date","sub_id",...], records: [{"0":…,"1":…}], … } }
  //
  // The records are keyed by column position, not by name, so read on its own
  // a row looks like { "0": "2026-08-10", "1": "..." }. The names live one
  // level up in `columns` and have to be put back on.
  const named = fromColumnsAndRecords(record, 'root') ?? fromColumnsAndRecords(record.data, 'data');
  if (named) return named;

  for (const key of ['data', 'rows', 'results', 'records', 'report', 'reportData', 'items']) {
    const value = record[key];
    if (isRowArray(value)) return tableFrom(value, key);
    // One level deeper: { data: { rows: [...] } }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const inner = value as Record<string, unknown>;
      for (const innerKey of ['rows', 'data', 'results', 'records', 'items']) {
        if (isRowArray(inner[innerKey])) return tableFrom(inner[innerKey] as Record<string, unknown>[], `${key}.${innerKey}`);
      }
    }
  }

  return empty;
}

/**
 * A `{ columns: [...names], records: [...] }` pair, turned into rows keyed by
 * name. Records arrive either as positional objects ({"0": v}) or as plain
 * arrays depending on the endpoint, so both are accepted.
 */
function fromColumnsAndRecords(node: unknown, path: string): QmpTable | null {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const record = node as Record<string, unknown>;

  const columns = record.columns;
  if (!Array.isArray(columns) || columns.length === 0) return null;
  if (!columns.every((name) => typeof name === 'string')) return null;
  const names = columns as string[];

  const source = [record.records, record.rows, record.data].find(Array.isArray) as unknown[] | undefined;
  if (!source) return null;

  const rows: Record<string, unknown>[] = [];
  for (const entry of source) {
    const row: Record<string, unknown> = {};
    if (Array.isArray(entry)) {
      names.forEach((name, index) => {
        row[name] = entry[index] ?? null;
      });
    } else if (entry && typeof entry === 'object') {
      const positional = entry as Record<string, unknown>;
      names.forEach((name, index) => {
        // Prefer the positional key, but fall back to the name in case QMP
        // ever starts sending records keyed properly.
        row[name] = positional[String(index)] ?? positional[name] ?? null;
      });
    } else {
      continue;
    }
    rows.push(row);
  }

  return { columns: names, rows, shape: `${path}.columns+records`, rowCount: rows.length };
}

function tableFrom(rows: Record<string, unknown>[], shape: string): QmpTable {
  // Union of keys in document order: a report can omit a null column on some
  // rows, and taking only the first row's keys would drop it from the table.
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return { columns, rows, shape, rowCount: rows.length };
}

export type QmpReportResult = {
  table: QmpTable;
  raw: unknown;
  url: string;
  fetchedAt: string;
  durationMs: number;
};

export async function fetchQmpReport(options: {
  reportKey: string;
  startDate?: string;
  endDate?: string;
  config?: QmpConfig;
}): Promise<QmpReportResult> {
  const config = options.config ?? qmpConfig();
  const reportKey = options.reportKey.trim();
  if (!reportKey) {
    throw new QmpError('No report key.', 400, 'Paste the key from the report’s Download Via API screen.');
  }
  // QMP's own error calls this path segment `extractId` and fails to "convert"
  // anything non-numeric, so in practice a key is a number. The check stays
  // wider than that (a key must not be able to carry a slash into the path),
  // rather than hard-refusing a format QMP might later start issuing.
  if (/[^A-Za-z0-9_.:-]/.test(reportKey)) {
    throw new QmpError(
      'That does not look like a report key.',
      400,
      'A key is normally a number, taken from the end of the Download Via API URL.',
    );
  }

  const startDate = normalizeDate(options.startDate);
  const endDate = normalizeDate(options.endDate);
  // QMP treats the range as all-or-nothing: one half alone is ignored, which
  // would quietly return every date instead of the window that was asked for.
  if (Boolean(startDate) !== Boolean(endDate)) {
    throw new QmpError('A date range needs both ends.', 400, 'Set both dates, or neither for all available dates.');
  }
  if (startDate && endDate && startDate > endDate) {
    throw new QmpError('The start date is after the end date.', 400, 'Swap them.');
  }

  const token = await qmpAccessToken(config);
  const url = new URL(`${config.baseUrl}/api/${config.app}/download/${encodeURIComponent(reportKey)}`);
  if (startDate && endDate) {
    url.searchParams.set('startDate', startDate);
    url.searchParams.set('endDate', endDate);
  }

  const startedAt = Date.now();
  const response = await withTimeout(60_000, (signal) =>
    fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal,
      cache: 'no-store',
    }),
  );
  const durationMs = Date.now() - startedAt;

  const text = await response.text();
  if (!response.ok) {
    throw new QmpError(
      `QMP returned HTTP ${response.status}. ${describeQmpError(text)}`.trim(),
      response.status,
      hintFor(response.status),
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new QmpError('QMP returned a body that is not JSON.', 502, `First 200 characters: ${text.slice(0, 200)}`);
  }

  return { table: normalizeReport(raw), raw, url: url.toString(), fetchedAt: new Date().toISOString(), durationMs };
}

/** RFC 4180 enough for Excel and Sheets. */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) lines.push(columns.map((column) => cell(row[column])).join(','));
  return lines.join('\r\n');
}
