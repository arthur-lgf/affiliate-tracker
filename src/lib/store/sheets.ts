import { randomUUID } from 'node:crypto';
import { google, type sheets_v4 } from 'googleapis';
import { SHEET_HEADERS, SHEET_TABS } from '../config';
import { resolveGoogleCredentials } from '../google-credentials';
import type {
  AffiliateLink,
  NewAffiliateLink,
  NewSubmission,
  NewVisit,
  Store,
  Submission,
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

      // Stamp headers on any tab whose first row is empty (new or pre-existing).
      for (const tab of Object.keys(SHEET_TABS) as TabName[]) {
        const header = await sheets.spreadsheets.values.get({
          spreadsheetId: id,
          range: tabRange(tab, 1, 1),
        });
        const firstRow = header.data.values?.[0] ?? [];
        if (firstRow.length === 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: id,
            range: tabRange(tab, 1, 1),
            valueInputOption: 'RAW',
            requestBody: { values: [[...SHEET_HEADERS[tab]]] },
          });
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
  ];
}

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
async function assertRowStillHolds(rowNumber: number, id: string): Promise<void> {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET_TABS.links}!A${rowNumber}:A${rowNumber}`,
  });
  const actual = res.data.values?.[0]?.[0];
  if (String(actual ?? '') !== id) {
    throw new StoreConflictError(
      'That link changed in the sheet while you were editing it. Reload and try again.',
    );
  }
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
      await assertRowStillHolds(rowNumber, id);
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
      await assertRowStillHolds(rowNumber, id);
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
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      await appendRow('submissions', submissionToRow(row));
      return row;
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
