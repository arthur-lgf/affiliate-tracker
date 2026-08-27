import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_LEAD_STATUS, normalizeLeadStatus } from '../status';
import { campaignToCells, campaignsFromCells } from './campaign-row';
import { conversionFromCells, conversionToCells } from './conversion-row';
import { cpaReportFromCells, cpaRowToCells } from './cpa-row';
import { makeRowId, parseRowId, rowFingerprint } from './row-id';

/**
 * On disk a conversion has no id — the JSON mirrors the sheet's columns exactly,
 * so the same row reads the same way whichever store is active.
 */
type StoredConversion = Omit<Conversion, 'id'>;
import type {
  AffiliateLink,
  Campaign,
  Conversion,
  NewAffiliateLink,
  NewConversion,
  NewSubmission,
  NewVisit,
  CpaReport,
  Store,
  Submission,
  SubmissionPatch,
  Visit,
} from '../types';
import { parseSettings, type Settings } from '../settings';
import { StoreConfigError, StoreConflictError, StoreNotFoundError } from './errors';

/**
 * Filesystem-backed store used when Google Sheets credentials are absent, so
 * the app is runnable the moment it is cloned. Data lives in ./.data/*.json
 * (gitignored). Same interface as the Sheets adapter — nothing above this layer
 * knows which one is active.
 */

const DATA_DIR = path.join(process.cwd(), '.data');

const FILES = {
  links: path.join(DATA_DIR, 'links.json'),
  submissions: path.join(DATA_DIR, 'submissions.json'),
  visits: path.join(DATA_DIR, 'visits.json'),
  conversions: path.join(DATA_DIR, 'conversions.json'),
  // Rows of cells rather than objects, so the file is the CPA tab of the
  // spreadsheet written out — same as every other file here.
  cpa: path.join(DATA_DIR, 'cpa.json'),
  campaigns: path.join(DATA_DIR, 'campaigns.json'),
  // Two values rather than a table, so this one file holds an object
  // rather than the usual array of rows.
  settings: path.join(DATA_DIR, 'settings.json'),
} as const;

/**
 * Serializes every read-modify-write so two concurrent submissions can't
 * clobber each other's append. Node runs one event loop per process, so a
 * single promise chain is sufficient here.
 */
let queue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  // Keep the chain alive even if this operation rejects.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readFile<T>(file: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    // Only "there is no file yet" may mean "there are no rows". A table that
    // has never been written to is genuinely empty.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  // Everything below used to return [] as well, on the reasoning that a corrupt
  // file should not take the app down. It is worse than taking it down: every
  // write path here reads the whole table, appends, and writes it back. So a
  // file that failed to parse — a truncated restore, a half-finished hand edit,
  // a disk-full write — read as zero rows, and the next visit or lead
  // overwrote it with a one-row file. The data was not lost by the corruption;
  // it was lost by the recovery.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StoreConfigError(
      `${file} is not readable JSON (${error instanceof Error ? error.message : 'parse failed'}). ` +
        'Refusing to read it as empty, because the next write would replace it. Fix or move the ' +
        'file aside, then reload.',
    );
  }

  if (!Array.isArray(parsed)) {
    throw new StoreConfigError(
      `${file} does not contain a JSON array. Refusing to read it as empty, because the next ` +
        'write would replace it.',
    );
  }

  return parsed as T[];
}

/** Read-only or non-existent filesystem — i.e. a serverless host. */
const UNWRITABLE = new Set(['EROFS', 'EACCES', 'EPERM', 'ENOENT']);

async function writeFile<T>(file: string, rows: T[]): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
    await fs.rename(tmp, file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (UNWRITABLE.has(code)) {
      // A bare "ENOENT: mkdir '/var/task/.data'" tells nobody what to do.
      throw new StoreConfigError(
        `Cannot write to ${DATA_DIR} (${code}). This host has no writable filesystem, so the ` +
          'local file store cannot be used. Configure Google Sheets instead by setting ' +
          'GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY, then redeploy.',
      );
    }
    throw error;
  }
}

export function createLocalStore(): Store {
  return {
    kind: 'local',

    async listLinks() {
      return readFile<AffiliateLink>(FILES.links);
    },

    async createLink(input: NewAffiliateLink) {
      return withLock(async () => {
        const rows = await readFile<AffiliateLink>(FILES.links);
        const clash = rows.find(
          (row) => row.slug === input.slug && row.usr === input.usr,
        );
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
        rows.push(link);
        await writeFile(FILES.links, rows);
        return link;
      });
    },

    async updateLink(id: string, patch: Partial<NewAffiliateLink>) {
      return withLock(async () => {
        const rows = await readFile<AffiliateLink>(FILES.links);
        const index = rows.findIndex((row) => row.id === id);
        if (index === -1) throw new StoreNotFoundError('Link not found');
        const next: AffiliateLink = { ...rows[index], ...patch };
        const clash = rows.find(
          (row) => row.id !== id && row.slug === next.slug && row.usr === next.usr,
        );
        if (clash) {
          throw new StoreConflictError('Another link already uses that slug and assignee.');
        }
        rows[index] = next;
        await writeFile(FILES.links, rows);
        return next;
      });
    },

    async deleteLink(id: string) {
      return withLock(async () => {
        const rows = await readFile<AffiliateLink>(FILES.links);
        const next = rows.filter((row) => row.id !== id);
        if (next.length === rows.length) throw new StoreNotFoundError('Link not found');
        await writeFile(FILES.links, next);
      });
    },

    async listSubmissions() {
      const rows = await readFile<Submission>(FILES.submissions);
      // Rows written before the column existed have no status at all; they are
      // pending like any other lead nobody has acted on.
      return rows.map((row) => ({ ...row, status: normalizeLeadStatus(row.status) }));
    },

    async addSubmission(input: NewSubmission) {
      return withLock(async () => {
        const rows = await readFile<Submission>(FILES.submissions);
        const row: Submission = {
          ...input,
          // The caller supplies this when the reference is already inside the
          // destination URL on this very row.
          id: input.id?.trim() || randomUUID(),
          createdAt: new Date().toISOString(),
          // Every lead starts pending the moment it is captured.
          status: DEFAULT_LEAD_STATUS,
        };
        rows.push(row);
        await writeFile(FILES.submissions, rows);
        return row;
      });
    },

    async updateSubmission(id: string, patch: SubmissionPatch) {
      return withLock(async () => {
        const rows = await readFile<Submission>(FILES.submissions);
        const index = rows.findIndex((row) => row.id === id);
        if (index === -1) throw new StoreNotFoundError('Lead not found');
        const next: Submission = { ...rows[index]!, ...patch };
        rows[index] = next;
        await writeFile(FILES.submissions, rows);
        return next;
      });
    },

    async listConversions() {
      const rows = await readFile<StoredConversion>(FILES.conversions);
      // Same addressing as the sheet: position plus a fingerprint of the
      // content, so the two stores behave identically.
      return rows.map((row, index) => {
        const cells = conversionToCells(row);
        return conversionFromCells(cells, makeRowId(index, cells));
      });
    },

    async addConversion(input: NewConversion) {
      return withLock(async () => {
        const rows = await readFile<StoredConversion>(FILES.conversions);
        const row: StoredConversion = { ...input, createdAt: new Date().toISOString() };
        rows.push(row);
        await writeFile(FILES.conversions, rows);
        const cells = conversionToCells(row);
        return conversionFromCells(cells, makeRowId(rows.length - 1, cells));
      });
    },

    async readCpaReport() {
      const rows = await readFile<string[]>(FILES.cpa);
      return cpaReportFromCells(rows);
    },

    async listCampaigns() {
      return campaignsFromCells(await readFile<string[]>(FILES.campaigns));
    },

    async readSettings() {
      // readFile answers with [] for a file that is not there yet, which
      // parseSettings reads as "nothing saved" and turns into the defaults.
      const saved = await readFile<unknown>(FILES.settings);
      return parseSettings(Array.isArray(saved) ? saved[0] : saved);
    },

    async writeSettings(settings: Settings) {
      // Wrapped in an array so the file has the same shape as every other one
      // here, which is what readFile and the checks both expect.
      return withLock(async () => {
        await writeFile(FILES.settings, [settings]);
      });
    },

    async writeCampaigns(campaigns: Campaign[]) {
      // Whole-file replace under the same lock as everything else, so a reader
      // never catches the list half written.
      return withLock(async () => {
        await writeFile(FILES.campaigns, campaigns.map(campaignToCells));
      });
    },

    async writeCpaReport(report: CpaReport) {
      // Whole-file replace under the same lock as everything else: half a rate
      // card is worse than none, and a reader must never catch it mid-write.
      return withLock(async () => {
        await writeFile(
          FILES.cpa,
          report.rows.map((rate) => cpaRowToCells(report, rate)),
        );
      });
    },

    async deleteConversion(id: string) {
      return withLock(async () => {
        const target = parseRowId(id);
        if (!target) throw new StoreNotFoundError('Approval not found');
        const rows = await readFile<StoredConversion>(FILES.conversions);
        const row = rows[target.position];
        if (!row || rowFingerprint(conversionToCells(row)) !== target.fingerprint) {
          throw new StoreConflictError(
            'That approval changed while the page was open. Reload and try again.',
          );
        }
        rows.splice(target.position, 1);
        await writeFile(FILES.conversions, rows);
      });
    },

    async listVisits() {
      return readFile<Visit>(FILES.visits);
    },

    async addVisit(input: NewVisit) {
      return withLock(async () => {
        const rows = await readFile<Visit>(FILES.visits);
        const row: Visit = {
          ...input,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        };
        rows.push(row);
        await writeFile(FILES.visits, rows);
        return row;
      });
    },
  };
}
