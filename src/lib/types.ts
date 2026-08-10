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
};

export type NewSubmission = Omit<Submission, 'id' | 'createdAt'>;

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

export interface Store {
  /** Which backend is actually serving requests — surfaced in the UI. */
  readonly kind: 'sheets' | 'local';

  listLinks(): Promise<AffiliateLink[]>;
  createLink(input: NewAffiliateLink): Promise<AffiliateLink>;
  updateLink(id: string, patch: Partial<NewAffiliateLink>): Promise<AffiliateLink>;
  deleteLink(id: string): Promise<void>;

  listSubmissions(): Promise<Submission[]>;
  addSubmission(input: NewSubmission): Promise<Submission>;

  listVisits(): Promise<Visit[]>;
  addVisit(input: NewVisit): Promise<Visit>;
}
