import { randomUUID } from 'node:crypto';
import { google, type sheets_v4 } from 'googleapis';
import { SHEET_HEADERS, SHEET_TABS } from '../config';
import { resolveGoogleCredentials } from '../google-credentials';
import { DEFAULT_LEAD_STATUS, normalizeLeadStatus } from '../status';
import { conversionFromCells, conversionToCells } from './conversion-row';
import { makeRowId, parseRowId, rowFingerprint } from './row-id';
import type {
  AffiliateLink,
  NewAffiliateLink,
  NewConversion,
  NewSubmission,
  NewVisit,
  Store,
  Submission,
  SubmissionPatch,
  Visit,
} from '../types';
import { normalizeKey } from '../validate';
import { StoreConfigError, StoreConflictError, StoreNotFoundError } from './errors';

/**
 * Google Sheets adapter. The spreadsheet is the source of truth: three tabs
 * (Links / Submissions / Visits), one row per record, `id` in column A.
 *
 * Tabs and header rows are created on first use, so a brand new blank
 * spreadsheet works — you only have to share it with the service account.
 */

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

type TabName = keyof typeof SHEET_TABS;

let clientPromise: Promise<sheets_v4.Sheets> | null = null;
let ensurePromise: Promise<void> | null = null;

function spreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID?.trim();
  if (!id) throw new StoreConfigError('GOOGLE_SHEET_ID is not set');
  return id;
}

function getClient(): Promise<sheets_v4.Sheets> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const credentials = resolveGoogleCredentials();
      if (!credentials) {
        throw new StoreConfigError(
          'No Google credentials found. Add a service-account.json key file to the project root, ' +
            'or set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.',
        );
      }
      const auth = new google.auth.JWT({
        email: credentials.email,
        key: credentials.privateKey,
        scopes: SCOPES,
      });
      await auth.authorize();
      return google.sheets({ version: 'v4', auth });
    })().catch((error) => {
      // Never cache a failed auth — the next request should retry.
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

/** A1 column letter for a 1-based column index (1 -> A, 27 -> AA). */
function columnLetter(index: number): string {
  let out = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function tabRange(tab: TabName, firstRow = 1, lastRow?: number): string {
  const width = columnLetter(SHEET_HEADERS[tab].length);
  return `${SHEET_TABS[tab]}!A${firstRow}:${width}${lastRow ?? ''}`;
}

/** "Created At" and "created_at" are the same header as far as we're concerned. */
function normalizeHeaderCell(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * What to do with a header row we found, given the one we expect.
 *
 * Pure and exported so the decision can be tested without a spreadsheet — this
 * is the code that decides whether to write over somebody's live header row, so
 * "it looked right" is not a good enough standard.
 *
 * - `write` — one or more of our columns is blank (a new tab, or an existing
 *   sheet that predates a column we later added, which is how `status` arrives).
 *   Writing the full row only fills those blanks, since every non-blank cell has
 *   already been checked to match.
 * - `conflict` — a cell holds something else. Somebody has inserted a column or
 *   rearranged the row, and stamping our layout over it would file every value
 *   under the wrong heading. Refuse instead.
 * - `ok` — nothing to do.
 */
export function planHeaderRow(
  actual: string[],
  expected: readonly string[],
): { action: 'ok' | 'write' } | { action: 'conflict'; index: number; found: string } {
  for (let index = 0; index < expected.length; index += 1) {
    const cell = actual[index];
    if (cell == null || cell.trim() === '') continue;
    if (normalizeHeaderCell(cell) !== expected[index]) {
      return { action: 'conflict', index, found: cell };
    }
  }
  const blank = expected.some((_, index) => (actual[index] ?? '').trim() === '');
  return { action: blank ? 'write' : 'ok' };
}

/**
 * Bring one tab's header row in line with SHEET_HEADERS, filling blanks only.
 * Returns true when something was written.
 */
async function ensureHeaderRow(tab: TabName): Promise<boolean> {
  const sheets = await getClient();
  const id = spreadsheetId();
  const expected = SHEET_HEADERS[tab];

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: tabRange(tab, 1, 1),
  });
  const actual = (res.data.values?.[0] ?? []).map((cell) => (cell == null ? '' : String(cell)));

  const plan = planHeaderRow(actual, expected);
  if (plan.action === 'conflict') {
    throw new StoreConfigError(
      `The "${SHEET_TABS[tab]}" tab does not match the expected layout: column ` +
        `${columnLetter(plan.index + 1)} is headed "${plan.found}" but should be ` +
        `"${expected[plan.index]}". Restore that header, or move your own column to the right of ` +
        `the last one. If this tab was created by an earlier version of the app and holds nothing ` +
        `you need, delete the whole "${SHEET_TABS[tab]}" tab and it will be recreated. ` +
        'Writing to a shifted layout would file values under the wrong headings, so this is ' +
        'refused rather than guessed.',
    );
  }
  if (plan.action === 'ok') return false;

  // Anything the user keeps to the right of our last column is outside this
  // range and left alone.
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: tabRange(tab, 1, 1),
    valueInputOption: 'RAW',
    requestBody: { values: [[...expected]] },
  });
  return true;
}

/**
 * Turn the Status column into a dropdown so marking a lead registered in the
 * spreadsheet is a click rather than a guess at the spelling.
 *
 * `strict: false` keeps a bulk paste from being rejected outright — anything
 * unrecognised is flagged in the sheet and read back as pending.
 */
async function applyStatusDropdown(): Promise<void> {
  const sheets = await getClient();
  const sheetId = await sheetIdForTab('submissions');
  const column = SHEET_HEADERS.submissions.indexOf('status');
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: {
      requests: [
        {
          setDataValidation: {
            // From row 2 down; no end bound, so it covers rows not yet written.
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: column,
              endColumnIndex: column + 1,
            },
            rule: {
              condition: {
                type: 'ONE_OF_LIST',
                values: [{ userEnteredValue: 'pending' }, { userEnteredValue: 'registered' }],
              },
              inputMessage: 'Set to "registered" once this lead has signed up.',
              showCustomUi: true,
              strict: false,
            },
          },
        },
      ],
    },
  });
}

/** Create any missing tab and stamp its header row. Runs at most once per process. */
function ensureTabs(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const sheets = await getClient();
      const id = spreadsheetId();
      const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
      const existing = new Set(
        (meta.data.sheets ?? [])
          .map((sheet) => sheet.properties?.title)
          .filter((title): title is string => Boolean(title)),
      );

      const missing = (Object.keys(SHEET_TABS) as TabName[]).filter(
        (tab) => !existing.has(SHEET_TABS[tab]),
      );

      if (missing.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: id,
          requestBody: {
            requests: missing.map((tab) => ({
              addSheet: { properties: { title: SHEET_TABS[tab] } },
            })),
          },
        });
      }

      let submissionsChanged = false;
      for (const tab of Object.keys(SHEET_TABS) as TabName[]) {
        const written = await ensureHeaderRow(tab);
        if (tab === 'submissions') submissionsChanged = written;
      }

      // Only on the run that introduced the column, so an ordinary cold start
      // doesn't pay for an extra write. The rule persists in the spreadsheet.
      if (submissionsChanged) {
        try {
          await applyStatusDropdown();
        } catch (error) {
          // Cosmetic. A sheet without the dropdown still works — free text is
          // normalised on read.
          console.warn('[sheets] could not set the status dropdown', error);
        }
      }
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

type NumberedRow = { rowNumber: number; cells: string[] };

/**
 * Rows with their PHYSICAL sheet row number attached.
 *
 * The row number is captured before blank rows are dropped. Deriving it from
 * the filtered array instead would make every write after an interior blank row
 * (someone selecting a row in the Sheets UI and pressing Delete, which clears
 * the cells but keeps the row) land on the wrong record.
 */
async function readNumberedRows(tab: TabName): Promise<NumberedRow[]> {
  await ensureTabs();
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    // Start at row 2 to skip the header.
    range: tabRange(tab, 2),
  });
  const width = SHEET_HEADERS[tab].length;
  return (res.data.values ?? [])
    .map((row, index) => {
      const cells = row.map((cell) => (cell == null ? '' : String(cell)));
      while (cells.length < width) cells.push('');
      return { rowNumber: index + 2, cells };
    })
    .filter((row) => row.cells.some((cell) => cell !== ''));
}

async function readRows(tab: TabName): Promise<string[][]> {
  return (await readNumberedRows(tab)).map((row) => row.cells);
}

async function appendRow(tab: TabName, values: string[]): Promise<void> {
  await ensureTabs();
  const sheets = await getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: tabRange(tab, 1),
    // RAW keeps phone numbers, URLs and leading zeros exactly as submitted.
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });
}

function boolFromCell(value: string): boolean {
  return /^(true|yes|1|y)$/i.test(value.trim());
}

function boolToCell(value: boolean): string {
  return value ? 'TRUE' : 'FALSE';
}

function linkFromRow(row: string[]): AffiliateLink {
  const [
    id,
    createdAt,
    slug,
    usr,
    assignee,
    assigneeEmail,
    campaign,
    destination,
    headline,
    subheadline,
    ctaLabel,
    requirePhone,
    passUsrParam,
    active,
    notes,
  ] = row;
  return {
    id,
    createdAt,
    // Normalise on read: a row typed by hand in the Sheets UI ("CashBack",
    // " arthur") would otherwise never match the URL it advertises.
    slug: normalizeKey(slug),
    usr: normalizeKey(usr),
    assignee,
    assigneeEmail,
    campaign,
    destination,
    headline,
    subheadline,
    ctaLabel,
    requirePhone: boolFromCell(requirePhone),
    passUsrParam,
    active: boolFromCell(active),
    notes,
  };
}

function linkToRow(link: AffiliateLink): string[] {
  return [
    link.id,
    link.createdAt,
    link.slug,
    link.usr,
    link.assignee,
    link.assigneeEmail,
    link.campaign,
    link.destination,
    link.headline,
    link.subheadline,
    link.ctaLabel,
    boolToCell(link.requirePhone),
    link.passUsrParam,
    boolToCell(link.active),
    link.notes,
  ];
}

function submissionFromRow(row: string[]): Submission {
  const [
    id,
    createdAt,
    slug,
    usr,
    assignee,
    campaign,
    fullName,
    email,
    phone,
    destination,
    referrer,
    userAgent,
    ip,
    status,
  ] = row;
  return {
    id,
    createdAt,
    slug,
    usr,
    assignee,
    campaign,
    fullName,
    email,
    phone,
    destination,
    referrer,
    userAgent,
    ip,
    // Typed by hand as often as it is written by us — whatever is in the cell
    // (including nothing, on rows logged before the column existed) is read as
    // one of the two statuses.
    status: normalizeLeadStatus(status),
  };
}

function submissionToRow(row: Submission): string[] {
  return [
    row.id,
    row.createdAt,
    row.slug,
    row.usr,
    row.assignee,
    row.campaign,
    row.fullName,
    row.email,
    row.phone,
    row.destination,
    row.referrer,
    row.userAgent,
    row.ip,
    row.status,
  ];
}

/** A1 range for a single cell in a tab, e.g. `Submissions!N7:N7`. */
function cellRange(tab: TabName, column: string, rowNumber: number): string {
  return `${SHEET_TABS[tab]}!${column}${rowNumber}:${column}${rowNumber}`;
}

const STATUS_COLUMN = columnLetter(SHEET_HEADERS.submissions.indexOf('status') + 1);

function visitFromRow(row: string[]): Visit {
  const [id, createdAt, slug, usr, referrer, userAgent, ip] = row;
  return { id, createdAt, slug, usr, referrer, userAgent, ip };
}

function visitToRow(row: Visit): string[] {
  return [row.id, row.createdAt, row.slug, row.usr, row.referrer, row.userAgent, row.ip];
}

/**
 * Links are read on every landing-page hit, so they get a short TTL cache.
 * Any write invalidates it immediately.
 */
const LINK_CACHE_MS = 15_000;
let linkCache: { at: number; rows: AffiliateLink[] } | null = null;

function invalidateLinks() {
  linkCache = null;
}

async function loadLinks(force = false): Promise<AffiliateLink[]> {
  if (!force && linkCache && Date.now() - linkCache.at < LINK_CACHE_MS) {
    // Hand out a copy — callers sort the array, and sorting the cache in place
    // would change which row the landing-page fallback picks.
    return linkCache.rows.slice();
  }
  const rows = (await readRows('links')).map(linkFromRow);
  linkCache = { at: Date.now(), rows };
  return rows.slice();
}

/** Physical sheet row number for a link id, or -1. Row 1 is the header. */
async function findLinkRow(
  id: string,
): Promise<{ rowNumber: number; current: AffiliateLink | null; rows: AffiliateLink[] }> {
  const numbered = await readNumberedRows('links');
  const rows = numbered.map((row) => linkFromRow(row.cells));
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) return { rowNumber: -1, current: null, rows };
  return { rowNumber: numbered[index]!.rowNumber, current: rows[index]!, rows };
}

/**
 * Compare-and-swap guard. Between reading a row number and writing to it another
 * request can insert or delete rows, which would silently overwrite or delete a
 * different record. Re-reading column A immediately before the write closes that
 * window; a mismatch aborts instead of destroying someone else's row.
 */
async function assertRowStillHolds(tab: TabName, rowNumber: number, id: string): Promise<void> {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: cellRange(tab, 'A', rowNumber),
  });
  const actual = res.data.values?.[0]?.[0];
  if (String(actual ?? '') !== id) {
    throw new StoreConflictError(
      'That row moved in the sheet while you were working on it. Reload and try again.',
    );
  }
}

/** Physical sheet row number for a submission id, or -1. */
async function findSubmissionRow(
  id: string,
): Promise<{ rowNumber: number; current: Submission | null }> {
  const numbered = await readNumberedRows('submissions');
  const match = numbered.find((row) => row.cells[0] === id);
  if (!match) return { rowNumber: -1, current: null };
  return { rowNumber: match.rowNumber, current: submissionFromRow(match.cells) };
}

async function sheetIdForTab(tab: TabName): Promise<number> {
  const sheets = await getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: spreadsheetId() });
  const match = (meta.data.sheets ?? []).find(
    (sheet) => sheet.properties?.title === SHEET_TABS[tab],
  );
  const id = match?.properties?.sheetId;
  if (id == null) throw new StoreNotFoundError(`Tab "${SHEET_TABS[tab]}" not found`);
  return id;
}

export function createSheetsStore(): Store {
  return {
    kind: 'sheets',

    async listLinks() {
      return loadLinks();
    },

    async createLink(input: NewAffiliateLink) {
      const rows = await loadLinks(true);
      const clash = rows.find((row) => row.slug === input.slug && row.usr === input.usr);
      if (clash) {
        throw new StoreConflictError(
          input.usr
            ? `A link for /${input.slug}?usr=${input.usr} already exists.`
            : `A link for /${input.slug} already exists.`,
        );
      }
      const link: AffiliateLink = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      await appendRow('links', linkToRow(link));
      invalidateLinks();
      return link;
    },

    async updateLink(id: string, patch: Partial<NewAffiliateLink>) {
      const { rowNumber, current, rows } = await findLinkRow(id);
      if (rowNumber === -1 || !current) throw new StoreNotFoundError('Link not found');
      const next: AffiliateLink = { ...current, ...patch };
      const clash = rows.find(
        (row) => row.id !== id && row.slug === next.slug && row.usr === next.usr,
      );
      if (clash) {
        throw new StoreConflictError('Another link already uses that slug and assignee.');
      }
      const sheets = await getClient();
      await assertRowStillHolds('links', rowNumber, id);
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: tabRange('links', rowNumber, rowNumber),
        valueInputOption: 'RAW',
        requestBody: { values: [linkToRow(next)] },
      });
      invalidateLinks();
      return next;
    },

    async deleteLink(id: string) {
      const { rowNumber } = await findLinkRow(id);
      if (rowNumber === -1) throw new StoreNotFoundError('Link not found');
      const sheets = await getClient();
      const tabId = await sheetIdForTab('links');
      // Re-check last, after the extra round trip above widened the window.
      await assertRowStillHolds('links', rowNumber, id);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId(),
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: tabId,
                  dimension: 'ROWS',
                  startIndex: rowNumber - 1, // 0-based, inclusive
                  endIndex: rowNumber, // exclusive
                },
              },
            },
          ],
        },
      });
      invalidateLinks();
    },

    async listSubmissions() {
      return (await readRows('submissions')).map(submissionFromRow);
    },

    async addSubmission(input: NewSubmission) {
      const row: Submission = {
        ...input,
        // The caller supplies this when the reference is already inside the
        // destination URL on this very row.
        id: input.id?.trim() || randomUUID(),
        createdAt: new Date().toISOString(),
        // Every lead starts pending the moment it is captured.
        status: DEFAULT_LEAD_STATUS,
      };
      await appendRow('submissions', submissionToRow(row));
      return row;
    },

    async updateSubmission(id: string, patch: SubmissionPatch) {
      const { rowNumber, current } = await findSubmissionRow(id);
      if (rowNumber === -1 || !current) throw new StoreNotFoundError('Lead not found');
      const next: Submission = { ...current, ...patch };
      const sheets = await getClient();
      await assertRowStillHolds('submissions', rowNumber, id);
      // Only the status cell is written. The rest of the row is the record of
      // what the lead actually submitted, and anything else on it may have been
      // annotated by hand in the sheet — rewriting the row would revert that.
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: cellRange('submissions', STATUS_COLUMN, rowNumber),
        valueInputOption: 'RAW',
        requestBody: { values: [[next.status]] },
      });
      return next;
    },

    async listConversions() {
      const numbered = await readNumberedRows('conversions');
      return numbered.map((row) =>
        conversionFromCells(row.cells, makeRowId(row.rowNumber, row.cells)),
      );
    },

    async addConversion(input: NewConversion) {
      const cells = conversionToCells({ ...input, createdAt: new Date().toISOString() });
      await appendRow('conversions', cells);
      // The row number is only known after a re-read; the caller uses the
      // returned row for a confirmation message, not for addressing.
      return conversionFromCells(cells, '');
    },

    async deleteConversion(id: string) {
      const target = parseRowId(id);
      if (!target) throw new StoreNotFoundError('Approval not found');

      const sheets = await getClient();
      // Resolved before the content check so that check is the last thing to
      // happen before the delete, keeping the window between them as small as
      // it can be.
      const tabId = await sheetIdForTab('conversions');

      const numbered = await readNumberedRows('conversions');
      const match = numbered.find((row) => row.rowNumber === target.position);
      // The fingerprint is the guard: with no id column, position alone would
      // happily delete whatever row has shifted into that slot since the page
      // was rendered.
      if (!match || rowFingerprint(match.cells) !== target.fingerprint) {
        throw new StoreConflictError(
          'That approval changed in the sheet while the page was open. Reload and try again.',
        );
      }

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId(),
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: tabId,
                  dimension: 'ROWS',
                  startIndex: match.rowNumber - 1, // 0-based, inclusive
                  endIndex: match.rowNumber, // exclusive
                },
              },
            },
          ],
        },
      });
    },

    async listVisits() {
      return (await readRows('visits')).map(visitFromRow);
    },

    async addVisit(input: NewVisit) {
      const row: Visit = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      await appendRow('visits', visitToRow(row));
      return row;
    },
  };
}
