/**
 * Domain types shared by the store adapters, the API routes and the UI.
 *
 * Everything is stored as flat rows so that a Google Sheet can be the source
 * of truth without any transformation layer: one type === one tab.
 */

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
 * Where a lead stands. `pending` is stamped automatically on capture;
 * `registered` is only ever set by hand. See `lib/status.ts`.
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
}
