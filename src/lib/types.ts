/**
 * Domain types shared by the store adapters, the API routes and the UI.
 *
 * Everything is stored as flat rows so that a Google Sheet can be the source
 * of truth without any transformation layer: one type === one tab.
 */

// The one exception to "flat rows": the settings are two values rather than a
// table, and their own module owns what they mean. See lib/settings.
import type { Settings } from './settings';

export type AffiliateLink = {
  id: string;
  /** URL path segment, e.g. "cashback" in localhost:3000/cashback?usr=arthur */
  slug: string;
  /** The `usr` query value that identifies the assignee, e.g. "arthur". May be "" for a house link. */
  usr: string;
  /** Human name of the person this link is assigned to, e.g. "Arthur Reyes" */
  assignee: string;
  assigneeEmail: string;
  /** Where the lead is sent after the form is submitted. */
  destination: string;
  /** Human label for the offer, e.g. "Cash Back Credit Cards" */
  campaign: string;
  headline: string;
  subheadline: string;
  ctaLabel: string;
  requirePhone: boolean;
  /**
   * When non-empty, the assignee key is appended to the destination as this
   * query param (e.g. "subid" -> ...&subid=arthur) so the merchant can attribute
   * the click. Empty string disables it — the destination is used verbatim.
   */
  passUsrParam: string;
  active: boolean;
  notes: string;
  createdAt: string;
};

export type NewAffiliateLink = Omit<AffiliateLink, 'id' | 'createdAt'>;

/**
 * Where a lead stands. `pending` is stamped automatically on capture. The other
 * state is set by hand, written through by the report sync, or read off an
 * approval at display time — and reads "Approved" on screen. See `lib/status.ts`.
 */
export type LeadStatus = 'pending' | 'registered';

export type Submission = {
  id: string;
  createdAt: string;
  slug: string;
  usr: string;
  assignee: string;
  campaign: string;
  fullName: string;
  email: string;
  phone: string;
  /** The exact URL the lead was forwarded to. */
  destination: string;
  referrer: string;
  userAgent: string;
  ip: string;
  status: LeadStatus;
};

/**
 * Status is absent here on purpose: the capture endpoint never chooses it. The
 * store stamps `pending` on every new row so there is exactly one place that
 * decides what a brand new lead looks like.
 *
 * `id` is the one exception to the store owning identity, and only because the
 * reference has to exist before the row does: it is embedded in the destination
 * URL that is saved on the row and followed by the visitor. Left out, the store
 * mints one as before.
 */
export type NewSubmission = Omit<Submission, 'id' | 'createdAt' | 'status'> & {
  id?: string;
};

/** The only part of a logged lead the admin surface may change. */
export type SubmissionPatch = { status: LeadStatus };

export type Visit = {
  id: string;
  createdAt: string;
  slug: string;
  usr: string;
  referrer: string;
  userAgent: string;
  ip: string;
};

export type NewVisit = Omit<Visit, 'id' | 'createdAt'>;

/**
 * An approved application and what it paid.
 *
 * Keyed to a link (slug + usr) rather than to a visitor: with the capture form
 * off there is no lead row to attach it to, and the affiliate network reports by
 * tracking key, not by person. The person's name and the card are NOT stored —
 * the link that (slug, usr) points at already holds both, and a second copy is
 * just a second version of the truth waiting to disagree with the first.
 */
export type Conversion = {
  /**
   * Derived, never stored: `"<row>:<fingerprint>"`. The tab has no id column —
   * it is meant to be typed into — so a row is addressed by where it sits plus
   * a hash of what it says. See store/row-id.ts.
   */
  id: string;
  createdAt: string;
  /** Date the application was approved (YYYY-MM-DD) — what every figure is bucketed by. */
  approvedOn: string;
  slug: string;
  usr: string;
  /** Payout in whole currency units. */
  amount: number;
  notes: string;
};

export type NewConversion = Omit<Conversion, 'id' | 'createdAt'>;

/**
 * One rate on the CPA report: what an issuer pays for an approval on one card,
 * at one tier.
 *
 * Every money field is nullable and that matters. The export writes "-" for
 * "no value", which is not the same as zero: a card at $0 has been switched
 * off and is worth seeing, while a blank previous rate only means the card is
 * new. Collapsing the two would quietly turn every new card into a 100% cut.
 */
export type CpaRate = {
  /** QMP's placement. The same for every row today; kept so a second can be added. */
  placement: string;
  issuer: string;
  card: string;
  /** "Tier 1" … "Tier 10", or "" when the card pays one rate. */
  tier: string;
  /** Dollars per approval now. */
  current: number | null;
  /** What it paid before the last change. */
  previous: number | null;
  /** 0.1 for a 10% rise. Null when the report gives none. */
  change: number | null;
  /** ISO day the current rate took effect, or "" when unknown. */
  changedOn: string;
};

/**
 * The whole rate card, as one upload.
 *
 * A snapshot rather than a table that is edited row by row: it arrives as a
 * file, in full, and replaces what was there. The stamps are what the page
 * shows so nobody reads a rate card without knowing how old it is.
 */
export type CpaReport = {
  /** The "Day of" line from the export: when QMP read these rates. */
  reportDate: string;
  /** When it was uploaded here. ISO, or "" when nothing has been. */
  updatedAt: string;
  /** The username of the admin who uploaded it. */
  updatedBy: string;
  /** The name of the uploaded file, so a wrong one is recognisable. */
  source: string;
  rows: CpaRate[];
};

/**
 * An offer a link can point at, and the URL it sends people to.
 *
 * No id. The list is stored and replaced whole (see the campaigns migration),
 * so an id would not survive a save — which is why a link records the campaign
 * *name*, and why the name is the key a destination is looked up by.
 */
export type Campaign = {
  name: string;
  /** Before the tracking key is written in. May be '' for a category with no URL yet. */
  destination: string;
};

export interface Store {
  /** Which backend is actually serving requests — surfaced in the UI. */
  readonly kind: 'sheets' | 'local' | 'supabase';

  listLinks(): Promise<AffiliateLink[]>;
  createLink(input: NewAffiliateLink): Promise<AffiliateLink>;
  updateLink(id: string, patch: Partial<NewAffiliateLink>): Promise<AffiliateLink>;
  deleteLink(id: string): Promise<void>;

  listSubmissions(): Promise<Submission[]>;
  addSubmission(input: NewSubmission): Promise<Submission>;
  updateSubmission(id: string, patch: SubmissionPatch): Promise<Submission>;

  listVisits(): Promise<Visit[]>;
  addVisit(input: NewVisit): Promise<Visit>;

  listConversions(): Promise<Conversion[]>;
  addConversion(input: NewConversion): Promise<Conversion>;
  deleteConversion(id: string): Promise<void>;

  /**
   * The current rate card, or null when none has been uploaded.
   *
   * Read and replaced whole rather than by row, because that is what it is:
   * one export of one report, superseded by the next one.
   *
   * Rows come back in report order — issuer, then card, then tier — whichever
   * adapter answers. A store with no order of its own has to put it back.
   */
  readCpaReport(): Promise<CpaReport | null>;
  writeCpaReport(report: CpaReport): Promise<void>;

  /** In the order they were saved in, whichever adapter answers. */
  listCampaigns(): Promise<Campaign[]>;
  /** Replaces the list whole. The later of two concurrent saves wins entire. */
  writeCampaigns(campaigns: Campaign[]): Promise<void>;

  /**
   * The commission share and the rate-card floor.
   *
   * Never null: an adapter with nothing saved answers with the defaults, so no
   * caller has to decide what a missing commission rate means. Getting that
   * wrong once would mean a page quietly paying nothing, or everything.
   */
  readSettings(): Promise<Settings>;
  /** Replaces both settings whole, the same way campaigns are replaced. */
  writeSettings(settings: Settings): Promise<void>;
}
