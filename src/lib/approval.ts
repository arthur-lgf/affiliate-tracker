/**
 * Whether an account has been let in yet.
 *
 * Onboarding asks somebody to hand over their paperwork. This is the other half
 * of that transaction: a person reads it and decides. The two are deliberately
 * separate — finishing four forms is something an affiliate can do on their own
 * at two in the morning, and being approved is not.
 *
 * Pure, and client-safe: no database, no crypto, no request. The rules live
 * here so they can be checked directly, and lib/onboarding-guard.ts is the
 * thin layer that reads a row and acts on them.
 */

export type ApprovalStatus = 'pending' | 'approved' | 'declined';

export const APPROVAL_STATUSES: ApprovalStatus[] = ['pending', 'approved', 'declined'];

export type Approval = {
  status: ApprovalStatus;
  /** When the required paperwork was last completed. Null means they are still
   *  filling it in, so there is nothing to review yet. */
  submittedAt: string | null;
  reviewedAt: string | null;
  /** The admin's username, or '' when nobody has looked. */
  reviewedBy: string;
  /** Why it was declined, or a note left on an approval. */
  note: string;
  /** When the approval email was accepted by the provider, if it was. */
  emailedAt: string | null;
};

/** What a brand new account looks like. */
export const UNREVIEWED: Approval = {
  status: 'pending',
  submittedAt: null,
  reviewedAt: null,
  reviewedBy: '',
  note: '',
  emailedAt: null,
};

/**
 * An account with no database behind it, or one the flow does not apply to.
 *
 * Approved rather than pending, and for the same reason the migration backfills
 * every existing row: the failure mode of "assume not approved" is locking
 * people out of an app that was working, which is worse in every case than
 * briefly letting somebody in who should have waited.
 */
export const NOT_APPLICABLE: Approval = {
  ...UNREVIEWED,
  status: 'approved',
};

export function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return typeof value === 'string' && (APPROVAL_STATUSES as string[]).includes(value);
}

/** Whether the app itself is closed to them. */
export function blocksApp(approval: Approval): boolean {
  return approval.status !== 'approved';
}

/**
 * Whether this account is sitting in the admin's queue.
 *
 * Pending is not the same as waiting. Somebody who has signed up and not yet
 * filled anything in is also pending, and putting them in a review queue would
 * be asking an admin to approve a blank form.
 */
export function awaitingReview(approval: Approval): boolean {
  return approval.status === 'pending' && approval.submittedAt !== null;
}

/* ------------------------------------------------------- the way round it -- */

/**
 * An admin waiving the gate for one person.
 *
 * Deliberately its own axis rather than a value of ApprovalStatus. "Approved"
 * means somebody read the paperwork; "bypassed" means somebody decided the
 * paperwork could wait. Folding the second into the first would record a review
 * that never happened, and there would then be no way to ask the only question
 * that matters afterwards: whose W-9 do we still not have?
 */
export type Bypass = {
  /** When it was waived, or null for the normal flow. The timestamp is the
   *  flag: two columns that can disagree about the same fact is one column too
   *  many. */
  at: string | null;
  /** The admin who did it. */
  by: string;
  /** Why, in their words. Optional. */
  note: string;
};

export const NO_BYPASS: Bypass = { at: null, by: '', note: '' };

export function isBypassed(bypass: Bypass): boolean {
  return bypass.at !== null;
}

/**
 * Whether the onboarding gates apply to this person at all.
 *
 * One function, used by the page guard and the middleware rule alike, so there
 * is exactly one answer to "is this account gated" rather than two that drift.
 */
export function gatesApply(bypass: Bypass): boolean {
  return !isBypassed(bypass);
}

/**
 * For the pill in the People table and the heading on the waiting page.
 *
 * Bypass wins over everything else, because it is the fact that decides whether
 * the person can use the app. Somebody let in by an admin while still pending
 * is not "awaiting review" in any sense that matters to whoever is reading the
 * column: nobody is blocked and nothing is waiting.
 */
export function approvalLabel(approval: Approval, bypass: Bypass = NO_BYPASS): string {
  if (isBypassed(bypass)) return 'Bypassed';
  if (approval.status === 'approved') return 'Approved';
  if (approval.status === 'declined') return 'Declined';
  return approval.submittedAt ? 'Awaiting review' : 'Not submitted';
}

export type ReviewDecision = 'approved' | 'declined' | 'pending';

export function isReviewDecision(value: unknown): value is ReviewDecision {
  return value === 'approved' || value === 'declined' || value === 'pending';
}

export const MAX_NOTE = 1000;

/**
 * What a review has to say for itself.
 *
 * A decline needs a reason, and that is not paperwork for its own sake: the
 * reason is what the affiliate is shown, and "declined" with nothing after it
 * leaves somebody with a locked account, no idea what was wrong with it, and
 * nothing to do but email support. The note is the difference between a
 * decision and a wall.
 */
export function reviewProblems(input: {
  decision: ReviewDecision;
  note: string;
}): Record<string, string> {
  const problems: Record<string, string> = {};
  if (!isReviewDecision(input.decision)) {
    problems.decision = 'Approve, decline, or put it back in the queue.';
    return problems;
  }
  const note = (input.note ?? '').trim();
  if (input.decision === 'declined' && note.length < 4) {
    problems.note = 'Say what is wrong with it. They see this.';
  }
  if (note.length > MAX_NOTE) {
    problems.note = `Keep it under ${MAX_NOTE} characters.`;
  }
  return problems;
}

/** Whether approving this account should send the "you are approved" email:
 *  only on the move *into* approved, so re-saving a note does not send it
 *  again. */
export function shouldEmailApproval(before: Approval, decision: ReviewDecision): boolean {
  return decision === 'approved' && before.status !== 'approved';
}
