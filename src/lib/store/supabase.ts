import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import type {
  AffiliateLink,
  Campaign,
  Conversion,
  CpaRate,
  CpaReport,
  NewAffiliateLink,
  NewConversion,
  NewSubmission,
  NewVisit,
  Store,
  Submission,
  SubmissionPatch,
  Visit,
} from '../types';
import { sortRates } from '../cpa';
import { parseSettings, type Settings } from '../settings';
import { DEFAULT_LEAD_STATUS, normalizeLeadStatus } from '../status';
import { StoreConfigError, StoreConflictError, StoreNotFoundError } from './errors';

/**
 * Postgres, via Supabase.
 *
 * Same interface as the Sheets and JSON adapters, so nothing above this layer
 * knows which one is running.
 *
 * Two things about this client are not optional:
 *
 *   - It uses the service role key and therefore bypasses RLS. That is the
 *     access model on purpose (see the migration), and it is exactly why the
 *     key must never reach a browser. It is read from a non-public env var and
 *     this module is server-only.
 *
 *   - Reads are paged. PostgREST answers with at most 1000 rows unless asked
 *     otherwise, and a dashboard that silently stops counting at visit 1000
 *     would be worse than one that fails, because nobody would notice.
 */

const PAGE_SIZE = 1000;

/**
 * How many rate rows go in one insert. A rate card is a couple of hundred rows
 * today; the chunk is what keeps a much larger one from being one request that
 * PostgREST refuses on size.
 */
const INSERT_CHUNK = 500;

/** The one row the settings live in. Named rather than numbered so a
 *  second set of settings, if there is ever one, is a second key. */
const SETTINGS_KEY = 'ledger';
const MAX_ROWS = 500_000;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseServiceKey());
}

function supabaseUrl(): string {
  return (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
}

function supabaseServiceKey(): string {
  // Deliberately never NEXT_PUBLIC_: this key bypasses every row level policy.
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ''
  ).trim();
}

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = supabaseUrl();
  const key = supabaseServiceKey();
  if (!url || !key) {
    throw new StoreConfigError(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // The service role is not a user, so there is no session to keep and
    // nothing to refresh. Saying so avoids a background timer in a server
    // process that may be frozen between requests.
  });
  return client;
}

/** Only for tests, which swap the environment between cases. */
export function resetSupabaseClient(): void {
  client = null;
}

type PostgrestErrorish = { code?: string; message?: string; details?: string } | null;

function fail(context: string, error: PostgrestErrorish): never {
  const code = error?.code ?? '';
  const message = error?.message ?? 'unknown error';

  // 23505 is a unique violation. The only unique constraint here is on
  // (slug, usr), so it always means this exact link already exists.
  if (code === '23505') {
    throw new StoreConflictError('A link for that slug and tracking key already exists.');
  }
  // 42P01 (missing table) and 42501 (permission denied) both mean the project
  // is not set up rather than that the request was wrong, so they are worth
  // saying plainly instead of surfacing as a generic failure.
  if (code === '42P01') {
    throw new StoreConfigError(
      'The Ledger tables are missing from this Supabase project. Run: npx supabase db push',
    );
  }
  if (code === '42501') {
    throw new StoreConfigError(
      'Supabase refused the request. SUPABASE_SERVICE_ROLE_KEY must be the service role key, not the publishable one.',
    );
  }

  throw new Error(`${context}: ${message}${code ? ` (${code})` : ''}`);
}

/**
 * Read a whole table, a page at a time.
 *
 * `range` is inclusive at both ends. The loop stops when a page comes back
 * short, which is the only reliable signal that there is nothing after it.
 */
function cpaRateFromRow(row: Record<string, unknown>): CpaRate {
  const money = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    placement: text(row.placement),
    issuer: text(row.issuer),
    card: text(row.card),
    tier: text(row.tier),
    current: money(row.current),
    previous: money(row.previous),
    change: money(row.change),
    changedOn: text(row.changed_on),
  };
}

async function readAll<T>(table: string, order: { column: string; ascending: boolean }): Promise<T[]> {
  const supabase = getSupabaseClient();
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    // A short page is the only thing that ends this loop, so a backend that
    // ignored the range would spin forever and take the process with it.
    // Refusing at half a million rows turns that into an error somebody can
    // read, and is far above anything this tool is meant to hold in memory.
    if (from >= MAX_ROWS) {
      throw new StoreConfigError(
        `Refusing to read more than ${MAX_ROWS.toLocaleString()} rows from ${table} in one go.`,
      );
    }

    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(order.column, { ascending: order.ascending })
      // A stable tiebreaker. Without one, two rows sharing a timestamp can
      // swap places between pages, which silently drops one and repeats the
      // other across a page boundary.
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) fail(`reading ${table}`, error);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** PostgREST returns `numeric` as a string so no precision is lost in JSON. */
function toAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/* ---------------------------------------------------------------- mapping */

type LinkRow = Record<string, unknown>;

function linkFromRow(row: LinkRow): AffiliateLink {
  return {
    id: text(row.id),
    slug: text(row.slug),
    usr: text(row.usr),
    assignee: text(row.assignee),
    assigneeEmail: text(row.assignee_email),
    destination: text(row.destination),
    campaign: text(row.campaign),
    headline: text(row.headline),
    subheadline: text(row.subheadline),
    ctaLabel: text(row.cta_label),
    requirePhone: Boolean(row.require_phone),
    passUsrParam: text(row.pass_usr_param),
    active: Boolean(row.active),
    notes: text(row.notes),
    createdAt: text(row.created_at),
  };
}

function linkToRow(link: Partial<AffiliateLink>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (link.id !== undefined) row.id = link.id;
  if (link.slug !== undefined) row.slug = link.slug;
  if (link.usr !== undefined) row.usr = link.usr;
  if (link.assignee !== undefined) row.assignee = link.assignee;
  if (link.assigneeEmail !== undefined) row.assignee_email = link.assigneeEmail;
  if (link.destination !== undefined) row.destination = link.destination;
  if (link.campaign !== undefined) row.campaign = link.campaign;
  if (link.headline !== undefined) row.headline = link.headline;
  if (link.subheadline !== undefined) row.subheadline = link.subheadline;
  if (link.ctaLabel !== undefined) row.cta_label = link.ctaLabel;
  if (link.requirePhone !== undefined) row.require_phone = link.requirePhone;
  if (link.passUsrParam !== undefined) row.pass_usr_param = link.passUsrParam;
  if (link.active !== undefined) row.active = link.active;
  if (link.notes !== undefined) row.notes = link.notes;
  if (link.createdAt !== undefined) row.created_at = link.createdAt;
  return row;
}

function submissionFromRow(row: Record<string, unknown>): Submission {
  return {
    id: text(row.id),
    createdAt: text(row.created_at),
    slug: text(row.slug),
    usr: text(row.usr),
    assignee: text(row.assignee),
    campaign: text(row.campaign),
    fullName: text(row.full_name),
    email: text(row.email),
    phone: text(row.phone),
    destination: text(row.destination),
    referrer: text(row.referrer),
    userAgent: text(row.user_agent),
    ip: text(row.ip),
    status: normalizeLeadStatus(row.status),
  };
}

function visitFromRow(row: Record<string, unknown>): Visit {
  return {
    id: text(row.id),
    createdAt: text(row.created_at),
    slug: text(row.slug),
    usr: text(row.usr),
    referrer: text(row.referrer),
    userAgent: text(row.user_agent),
    ip: text(row.ip),
  };
}

function conversionFromRow(row: Record<string, unknown>): Conversion {
  return {
    id: text(row.id),
    createdAt: text(row.created_at),
    approvedOn: text(row.approved_on),
    slug: text(row.slug),
    usr: text(row.usr),
    amount: toAmount(row.amount),
    notes: text(row.notes),
  };
}

/* ---------------------------------------------------------------- adapter */

export function createSupabaseStore(): Store {
  const supabase = () => getSupabaseClient();

  return {
    kind: 'supabase',

    async listLinks() {
      const rows = await readAll<LinkRow>('links', { column: 'created_at', ascending: false });
      return rows.map(linkFromRow);
    },

    async createLink(input: NewAffiliateLink) {
      const link: AffiliateLink = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      const { data, error } = await supabase()
        .from('links')
        .insert(linkToRow(link))
        .select()
        .single();
      if (error) fail('creating a link', error);
      return linkFromRow(data as LinkRow);
    },

    async updateLink(id: string, patch: Partial<NewAffiliateLink>) {
      const row = linkToRow(patch as Partial<AffiliateLink>);
      // An empty patch would be an UPDATE with no SET clause, which PostgREST
      // rejects. Nothing to change is not an error, so read the row back.
      if (Object.keys(row).length === 0) {
        const { data, error } = await supabase().from('links').select().eq('id', id).maybeSingle();
        if (error) fail('reading a link', error);
        if (!data) throw new StoreNotFoundError('Link not found');
        return linkFromRow(data as LinkRow);
      }

      const { data, error } = await supabase()
        .from('links')
        .update(row)
        .eq('id', id)
        .select()
        .maybeSingle();
      if (error) fail('updating a link', error);
      if (!data) throw new StoreNotFoundError('Link not found');
      return linkFromRow(data as LinkRow);
    },

    async deleteLink(id: string) {
      // select() so the response says whether a row was actually removed;
      // a delete that matched nothing is a 404, not a success.
      const { data, error } = await supabase().from('links').delete().eq('id', id).select('id');
      if (error) fail('deleting a link', error);
      if (!data || data.length === 0) throw new StoreNotFoundError('Link not found');
    },

    async listSubmissions() {
      const rows = await readAll<Record<string, unknown>>('submissions', {
        column: 'created_at',
        ascending: false,
      });
      return rows.map(submissionFromRow);
    },

    async addSubmission(input: NewSubmission) {
      const row = {
        // Supplied when the reference is already inside the destination URL on
        // this very row; otherwise this is a plain new lead.
        id: input.id?.trim() || randomUUID(),
        created_at: new Date().toISOString(),
        slug: input.slug,
        usr: input.usr,
        assignee: input.assignee,
        campaign: input.campaign,
        full_name: input.fullName,
        email: input.email,
        phone: input.phone,
        destination: input.destination,
        referrer: input.referrer,
        user_agent: input.userAgent,
        ip: input.ip,
        status: DEFAULT_LEAD_STATUS,
      };
      const { data, error } = await supabase().from('submissions').insert(row).select().single();
      if (error) fail('saving a lead', error);
      return submissionFromRow(data as Record<string, unknown>);
    },

    async updateSubmission(id: string, patch: SubmissionPatch) {
      const { data, error } = await supabase()
        .from('submissions')
        .update({ status: patch.status })
        .eq('id', id)
        .select()
        .maybeSingle();
      if (error) fail('updating a lead', error);
      if (!data) throw new StoreNotFoundError('Lead not found');
      return submissionFromRow(data as Record<string, unknown>);
    },

    async listVisits() {
      const rows = await readAll<Record<string, unknown>>('visits', {
        column: 'created_at',
        ascending: false,
      });
      return rows.map(visitFromRow);
    },

    async addVisit(input: NewVisit) {
      const row = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        slug: input.slug,
        usr: input.usr,
        referrer: input.referrer,
        user_agent: input.userAgent,
        ip: input.ip,
      };
      const { data, error } = await supabase().from('visits').insert(row).select().single();
      if (error) fail('logging a visit', error);
      return visitFromRow(data as Record<string, unknown>);
    },

    async listConversions() {
      const rows = await readAll<Record<string, unknown>>('conversions', {
        column: 'approved_on',
        ascending: false,
      });
      return rows.map(conversionFromRow);
    },

    async addConversion(input: NewConversion) {
      const row = {
        created_at: new Date().toISOString(),
        approved_on: input.approvedOn,
        slug: input.slug,
        usr: input.usr,
        amount: input.amount,
        notes: input.notes,
      };
      const { data, error } = await supabase().from('conversions').insert(row).select().single();
      if (error) fail('recording an approval', error);
      return conversionFromRow(data as Record<string, unknown>);
    },

    /**
     * The newest upload's rows.
     *
     * Every upload writes a fresh batch and then deletes the old ones, so this
     * table normally holds exactly one. Picking the newest batch out of
     * whatever is there covers the case where that cleanup failed: the reader
     * still sees one complete rate card rather than two spliced together.
     */
    /**
     * The newest save, in the order it was written.
     *
     * Ordered by position within the batch rather than by whatever Postgres
     * hands back: every row of a save shares its saved_at, so the tiebreaker
     * in readAll decides, and that tiebreaker is a random uuid. The order of
     * this list is the only arrangement it has, so it has to be put back.
     */
    async listCampaigns() {
      const rows = await readAll<Record<string, unknown>>('campaigns', {
        column: 'saved_at',
        ascending: false,
      });
      if (rows.length === 0) return [];

      const newest = text(rows[0]!.batch_id);
      return rows
        .filter((row) => text(row.batch_id) === newest)
        .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
        .map((row) => ({ name: text(row.name), destination: text(row.destination) }));
    },

    /**
     * Insert the new list, then drop everything that is not it.
     *
     * In that order for the same reason the rate card is: deleting first would
     * leave the link form with an empty campaign picker for as long as the
     * insert took, and PostgREST has no transaction to hide that in.
     *
     * Saving an empty list is a real thing to want — it clears the table and
     * the form falls back to the built-in category names — so the delete runs
     * whether or not anything was inserted.
     */
    async writeCampaigns(campaigns: Campaign[]) {
      const supabase = getSupabaseClient();
      const batchId = randomUUID();
      const savedAt = new Date().toISOString();

      const rows = campaigns.map((campaign, index) => ({
        batch_id: batchId,
        saved_at: savedAt,
        position: index,
        name: campaign.name,
        destination: campaign.destination,
      }));

      for (let from = 0; from < rows.length; from += INSERT_CHUNK) {
        const { error } = await supabase
          .from('campaigns')
          .insert(rows.slice(from, from + INSERT_CHUNK));
        if (error) fail('saving the campaigns', error);
      }

      // A failed cleanup leaves an older batch behind, which listCampaigns
      // steps over anyway — it only ever reads the newest.
      const { error } = await supabase.from('campaigns').delete().neq('batch_id', batchId);
      if (error) fail('clearing the previous campaigns', error);
    },

    /**
     * One row, one blob.
     *
     * A table rather than an environment variable because the commission share
     * is edited by a person on a page, and because it has to be the same for
     * every instance serving the app the moment it changes. A jsonb column
     * rather than a column per setting, so that adding the next setting is not
     * a migration on a table that already holds the answer to "what were we
     * paying in September".
     */
    async readSettings() {
      const { data, error } = await getSupabaseClient()
        .from('settings')
        .select('value')
        .eq('key', SETTINGS_KEY)
        .maybeSingle();
      if (error) fail('reading the settings', error);
      return parseSettings(data?.value ?? null);
    },

    async writeSettings(settings: Settings) {
      const { error } = await getSupabaseClient()
        .from('settings')
        .upsert(
          {
            key: SETTINGS_KEY,
            value: settings,
            updated_at: settings.updatedAt || new Date().toISOString(),
            updated_by: settings.updatedBy,
          },
          { onConflict: 'key' },
        );
      if (error) fail('saving the settings', error);
    },

    async readCpaReport() {
      const rows = await readAll<Record<string, unknown>>('cpa_rates', {
        column: 'uploaded_at',
        ascending: false,
      });
      if (rows.length === 0) return null;

      const newest = text(rows[0]!.batch_id);
      const batch = rows.filter((row) => text(row.batch_id) === newest);
      const first = batch[0]!;
      return {
        reportDate: text(first.report_date),
        updatedAt: text(first.uploaded_at),
        updatedBy: text(first.uploaded_by),
        source: text(first.source),
        /*
         * Put back in report order, because Postgres has none to give. Every
         * row of an upload shares its uploaded_at, so the tiebreaker in readAll
         * decides the order, and that tiebreaker is a random uuid: without this
         * the tiers of a card come back as 1, 3, 2 and the issuers in no order
         * at all. Sorted here rather than in the page so the other two adapters
         * and this one keep the same promise.
         */
        rows: sortRates(batch.map(cpaRateFromRow)),
      } satisfies CpaReport;
    },

    /**
     * Insert the new card, then drop everything that is not it.
     *
     * In that order on purpose. Deleting first would leave the page showing an
     * empty rate card for as long as the insert took, and PostgREST has no
     * transaction to hide that in. Inserting first means a reader either sees
     * the old card or the new one, never neither.
     */
    async writeCpaReport(report: CpaReport) {
      const supabase = getSupabaseClient();
      const batchId = randomUUID();
      const uploadedAt = report.updatedAt || new Date().toISOString();

      const rows = report.rows.map((rate) => ({
        batch_id: batchId,
        uploaded_at: uploadedAt,
        uploaded_by: report.updatedBy,
        report_date: report.reportDate,
        source: report.source,
        placement: rate.placement,
        issuer: rate.issuer,
        card: rate.card,
        tier: rate.tier,
        current: rate.current,
        previous: rate.previous,
        change: rate.change,
        changed_on: rate.changedOn,
      }));

      for (let from = 0; from < rows.length; from += INSERT_CHUNK) {
        const { error } = await supabase
          .from('cpa_rates')
          .insert(rows.slice(from, from + INSERT_CHUNK));
        if (error) fail('saving the CPA report', error);
      }

      const { error } = await supabase.from('cpa_rates').delete().neq('batch_id', batchId);
      // A failed cleanup leaves an old batch behind, which readCpaReport steps
      // over. Not worth failing an upload that has already landed.
      if (error) console.warn('[supabase] could not clear the previous CPA batch', error.message);
    },

    async deleteConversion(id: string) {
      const { data, error } = await supabase()
        .from('conversions')
        .delete()
        .eq('id', id)
        .select('id');
      if (error) fail('removing an approval', error);
      if (!data || data.length === 0) throw new StoreNotFoundError('Approval not found');
    },
  };
}
