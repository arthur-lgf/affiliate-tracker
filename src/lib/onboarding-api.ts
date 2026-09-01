/**
 * The shape every onboarding route shares.
 *
 * Four routes, one question at the top of each: is this a signed-in affiliate
 * filling in their own paperwork? There is no "on behalf of" here on purpose —
 * an admin cannot sign somebody's W-9 for them, and a route that allowed it
 * would be a route that could forge a certification made under penalties of
 * perjury.
 */

import { NextResponse } from 'next/server';
import { unauthorized, viewerFromRequest, type Viewer } from './api-auth';
import { clientIp, userAgent } from './request';
import { blocksApp, isBypassed, NO_BYPASS, type Approval, type Bypass } from './approval';
import {
  canOpen,
  firstMissingRequired,
  isLocked,
  nextStep,
  stepByKey,
  type OnboardingState,
  type StepKey,
} from './onboarding';
import {
  markSubmitted,
  onboardingEnabled,
  readProgress,
  type SigningMeta,
} from './onboarding-store';
import { StoreConfigError } from './store/errors';

export type Actor = {
  viewer: Viewer;
  meta: SigningMeta;
  /** What was already done when the request arrived. Routes need it to tell a
   *  first submission from a correction, and to work out where to send them
   *  next. */
  state: OnboardingState;
  /** Whether an admin has let them in yet. Decides whether the end of the flow
   *  is the dashboard or the waiting page. */
  approval: Approval;
  /** Whether an admin waived the gate. Decides it again, differently. */
  bypass: Bypass;
};

/**
 * Who is filling this in, or the response to send instead.
 *
 * `step` is checked as well as the session: the steps are ordered because
 * signing an agreement on an account whose password somebody else chose is
 * signing as somebody else, and a route that skipped the check would let a
 * hand-made POST do exactly that.
 */
export async function actorFor(
  request: Request,
  step: StepKey,
): Promise<Actor | { response: NextResponse }> {
  if (!onboardingEnabled()) {
    return {
      response: NextResponse.json(
        { error: 'Onboarding needs a database. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' },
        { status: 503 },
      ),
    };
  }

  const viewer = await viewerFromRequest(request);
  if (!viewer) return { response: unauthorized() };

  // An admin has no tracking key, no payout and no W-9 to file. There is
  // nothing here for them to complete, and letting them try would write a row
  // against an account that onboarding does not apply to.
  if (viewer.role !== 'affiliate' || viewer.isEnvAdmin || viewer.open) {
    return {
      response: NextResponse.json(
        { error: 'Onboarding is for affiliate accounts.' },
        { status: 403 },
      ),
    };
  }

  let progress;
  try {
    progress = await readProgress(viewer.id);
  } catch (error) {
    return { response: storeResponse(error) };
  }
  const { state, approval, bypass, signedAt } = progress;

  const waived = isBypassed(bypass);
  if (!canOpen(state, step, { bypassed: waived })) {
    // Only ever the queue. A waived account is not in one: it may fill in any
    // of these, in any order, including the two nobody is asking it for.
    return {
      response: NextResponse.json({ error: 'Finish the earlier steps first.' }, { status: 409 }),
    };
  }

  /*
   * Checked here rather than in each of the four routes. Three of them would
   * have got it right and the fourth is the one that matters: this is the layer
   * that stands between a hand-made POST and a signed document being quietly
   * replaced after somebody approved it.
   */
  if (
    isLocked(step, state, {
      approved: approval.status === 'approved',
      reviewedAt: approval.reviewedAt,
      bypassedAt: bypass.at,
      signedAt: step === 'agreement' || step === 'w9' ? signedAt[step] : null,
    })
  ) {
    return {
      response: NextResponse.json(
        {
          error:
            `Your ${stepByKey(step).label.toLowerCase()} is on file and can no longer be ` +
            'changed here. Ask an admin if it needs correcting.',
        },
        { status: 409 },
      ),
    };
  }

  return {
    viewer,
    meta: { ip: clientIp(request), userAgent: userAgent(request) },
    state,
    approval,
    bypass,
  };
}

/**
 * Where to send them once this step has landed.
 *
 * Worked out from the state as it will be, not as it was, so the step just
 * saved is not offered back. On a first run through this is simply the next
 * form; on a correction made later it is whatever they still owe, or the
 * dashboard when the answer is nothing.
 */
export function nextPath(
  state: OnboardingState,
  justSaved: StepKey,
  approval: Approval,
  bypass: Bypass = NO_BYPASS,
): string {
  /*
   * A waived account is not walking a queue. Saving one item should hand them
   * back the list they picked it from, not march them into the next form as
   * though the order still meant something.
   */
  if (isBypassed(bypass)) return '/profile';

  const step = nextStep({ ...state, [justSaved]: true });
  if (step) return step.path;
  // Nothing left to fill in. That is not the same as being let in: an account
  // still waiting on an admin would only be bounced straight back off the
  // dashboard, so it is named here instead.
  return blocksApp(approval) ? '/welcome/review' : '/';
}

/**
 * Put them in the review queue once the required paperwork is all in.
 *
 * Called after every step rather than after the last one, because there is no
 * fixed last one: somebody can go back and re-sign the agreement, and that is a
 * resubmission the queue should show as such. The bank step is not required, so
 * it is not what anybody is waiting on.
 *
 * Never allowed to fail the request. The step itself saved; if stamping the
 * queue afterwards does not work, an admin sees an account whose paperwork is
 * plainly complete, which is a great deal better than telling somebody their
 * signature did not save when it did.
 */
export async function noteSubmission(
  userId: string,
  state: OnboardingState,
  justSaved: StepKey,
): Promise<void> {
  const after = { ...state, [justSaved]: true };
  if (firstMissingRequired(after)) return;
  try {
    await markSubmitted(userId);
  } catch {
    // Deliberately swallowed. See above.
  }
}

/** A store failure the reader can act on, rather than a 500 they cannot. */
export function storeResponse(error: unknown): NextResponse {
  if (error instanceof StoreConfigError) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'That did not save.' },
    { status: 500 },
  );
}

/** The body, or the response to send instead of reading one. */
export async function jsonBody(request: Request): Promise<unknown | { response: NextResponse }> {
  try {
    return await request.json();
  } catch {
    return { response: NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 }) };
  }
}

/** Field-level problems, in the shape the forms already know how to render. */
export function invalid(fields: Record<string, string>): NextResponse {
  return NextResponse.json(
    { error: 'Please check the highlighted fields.', fields },
    { status: 422 },
  );
}

/** Strings out of an unknown body, without trusting any of it. */
export function str(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : '';
}

export function bool(body: unknown, key: string): boolean {
  return (body as Record<string, unknown> | null)?.[key] === true;
}
