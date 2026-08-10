import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AffiliateLink,
  NewAffiliateLink,
  NewSubmission,
  NewVisit,
  Store,
  Submission,
  Visit,
} from '../types';
import { StoreConflictError, StoreNotFoundError } from './errors';

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
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    // A corrupt file should not take the whole app down.
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

async function writeFile<T>(file: string, rows: T[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
  await fs.rename(tmp, file);
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
      return readFile<Submission>(FILES.submissions);
    },

    async addSubmission(input: NewSubmission) {
      return withLock(async () => {
        const rows = await readFile<Submission>(FILES.submissions);
        const row: Submission = {
          ...input,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        };
        rows.push(row);
        await writeFile(FILES.submissions, rows);
        return row;
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
