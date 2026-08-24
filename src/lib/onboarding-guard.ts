/**
 * The gate, as pages use it.
 *
 * lib/onboarding.ts decides *what* should happen and is checked directly.
 * This is the thin server-side layer that reads the database and acts on that
 * decision — the split exists so the rules can be tested without a request, a
 * session or a Postgres.
 *
 * Server components only: it calls redirect() and reads cookies through
 * lib/viewer.ts. Route handlers use lib/api-auth.ts and check the state
 * themselves.
 */

import { cache } from 'react';
import { redirect } from 'next/navigation';
import {
  blocksApp,
  isBypassed,
  NO_BYPASS,
  NOT_APPLICABLE,
  type Approval,
  type Bypass,
} from './approval';
import {
  canOpen,
  firstMissingRequired,
  isLocked,
  nextStep,
  NOTHING_DONE,
  WAIVED_HOME,
  type OnboardingState,
  type StepKey,
} from './onboarding';
import { onboardingEnabled, readProgress, type Progress } from './onboarding-store';
import { requireViewer, type Viewer } from './viewer';

/**
 * Whether this viewer is subject to onboarding at all.
 *
 * Admins are not: they are not paid through this and there is no W-9 to
 * collect. Neither is the environment admin, which has no database row to
 * record any of it against — and gating the break-glass account behind a form
 * it cannot complete would be a locked door with the key inside.
 *
 * Nor is anyone, when there is no database: with Supabase unconfigured there is
 * nowhere to store a signature, and the app falls back to the single env
 * account. Blocking on a step that cannot be completed would make the whole
 * thing unusable rather than degraded.
 */
export function onboards(viewer: Viewer): boolean {
  if (!onboardingEnabled()) return false;
  if (viewer.open || viewer.isEnvAdmin) return false;
  return viewer.role === 'affiliate';
}

/**
 * Memoised per request: the admin layout asks, and so does the page inside it.
 * Without this every render would spend a second round trip asking the same
 * question.
 */
const stateFor = cache(async (userId: string): Promise<Progress> => {
  try {
    return await readProgress(userId);
  } catch {
    /*
     * A database that cannot answer must not become a locked door. Treating an
     * unreadable state as "finished and approved" fails open, which is the
     * right way round here: the worst case is an affiliate briefly seeing the
     * app before their paperwork is in, and the alternative is everybody stuck
     * on a form that cannot save either, plus a review queue that cannot be
     * read to clear them.
     */
    return {
      state: { profile: true, agreement: true, w9: true, bank: true },
      approval: { ...NOT_APPLICABLE },
      bypass: { ...NO_BYPASS },
    };
  }
});

export type Onboarding = {
  viewer: Viewer;
  state: OnboardingState;
  /** False for admins, the env account, and an app with no database. */
  applies: boolean;
  /** True when this step has already been completed and is being looked at
   *  again. Pages use it to say so rather than pretending it is the first
   *  time. */
  revisiting: boolean;
  /** True when this step is a signed document that has been settled: the page
   *  shows the record and the download, and offers no way to replace it. */
  locked: boolean;
  /** Whether an admin has let them in. Always approved for anybody the flow
   *  does not apply to. */
  approval: Approval;
  /** Whether an admin waived the gate for them. */
  bypass: Bypass;
};

export async function onboardingFor(viewer: Viewer): Promise<Onboarding> {
  if (!onboards(viewer)) {
    return {
      viewer,
      state: { ...NOTHING_DONE },
      applies: false,
      revisiting: false,
      locked: false,
      approval: { ...NOT_APPLICABLE },
      bypass: { ...NO_BYPASS },
    };
  }
  const { state, approval, bypass } = await stateFor(viewer.id);
  return { viewer, state, applies: true, revisiting: false, locked: false, approval, bypass };
}

/** Where somebody waiting on an admin is sent. */
export const REVIEW_PATH = '/welcome/review';

/** Where somebody who is already inside the app manages their own paperwork.
 *  The same path lib/onboarding.ts sends a waived account back to, named once
 *  so the two cannot drift apart. */
export const PROFILE_PATH = WAIVED_HOME;

/**
 * For any page inside the app.
 *
 * Two gates, in order. First: an affiliate who still owes a signature goes to
 * the earliest step they owe. Bank details are not checked here on purpose —
 * that step nags from a banner rather than barring the door.
 *
 * Then, once the paperwork is all in, the second gate: an account nobody has
 * approved yet does not open. Finishing four forms is not the same as being let
 * in, and the app deliberately cannot tell the difference between "not reviewed
 * yet" and "turned down" at this point — both wait on the same page, which says
 * which one it is.
 */
export async function requireOnboarded(): Promise<Onboarding> {
  const viewer = await requireViewer();
  const onboarding = await onboardingFor(viewer);
  if (!onboarding.applies) return onboarding;

  /*
   * Waived, so neither gate applies. Not "silently approved": their steps are
   * still unfinished and the queue still knows it, which is the whole reason
   * this is a separate flag. What changes is only that nothing bars the door.
   */
  if (isBypassed(onboarding.bypass)) return onboarding;

  const missing = firstMissingRequired(onboarding.state);
  if (missing) redirect(missing.path);

  if (blocksApp(onboarding.approval)) redirect(REVIEW_PATH);
  return onboarding;
}

/**
 * For the waiting page itself.
 *
 * The mirror of requireOnboarded: somebody who has not finished the forms has
 * nothing to wait for and is sent back to fill them in, and somebody already
 * approved has stopped waiting and belongs in the app. Without both halves this
 * page is a place people can get stuck.
 */
export async function requireAwaitingReview(): Promise<Onboarding> {
  const viewer = await requireViewer();
  const onboarding = await onboardingFor(viewer);
  if (!onboarding.applies) redirect('/');

  // Nobody with a waiver is waiting on anything, so there is nothing to show
  // them here.
  if (isBypassed(onboarding.bypass)) redirect('/');

  const missing = firstMissingRequired(onboarding.state);
  if (missing) redirect(missing.path);

  if (!blocksApp(onboarding.approval)) redirect('/');
  return onboarding;
}

/**
 * For one step of the flow.
 *
 * Two ways out, and both are redirects rather than errors: somebody who does
 * not onboard has no business here, and somebody who has not reached this step
 * yet is sent to the one they are actually on. The order only runs one way.
 *
 * A step that has already been done is *not* redirected away from. It used to
 * be, to stop anyone signing the same document twice — but that turned every
 * completed step into a room with no door, and the thing people most want from
 * a four-step form is to check what they put in the last one. Coming back is
 * allowed; the page says what it has on file and what saving again would do.
 */
export async function requireStep(key: StepKey): Promise<Onboarding> {
  const viewer = await requireViewer();
  const onboarding = await onboardingFor(viewer);
  if (!onboarding.applies) redirect('/');

  const { state, bypass } = onboarding;
  const bypassed = isBypassed(bypass);
  if (!canOpen(state, key, { bypassed })) {
    /*
     * Two different refusals. Without a waiver this is the queue: they have not
     * reached this step yet and are sent to the one they are on. With a waiver
     * it is the agreement or the W-9, which are not being collected from them
     * at all, so they go back to the list of what is.
     */
    redirect(bypassed ? PROFILE_PATH : (nextStep(state) ?? { path: '/' }).path);
  }
  return {
    ...onboarding,
    revisiting: state[key],
    locked: isLocked(key, state, {
      approved: onboarding.approval.status === 'approved',
      bypassed,
    }),
  };
}

/**
 * Where a finished step should send somebody next.
 *
 * The forms used to send everybody to the dashboard once the last one was
 * saved. For an account still waiting on an admin the dashboard is a redirect
 * back to the waiting page, so this names the waiting page directly rather than
 * bouncing them through a door that is shut.
 */
export function afterOnboarding(approval: Approval, bypass: Bypass = NO_BYPASS): string {
  if (isBypassed(bypass)) return PROFILE_PATH;
  return blocksApp(approval) ? REVIEW_PATH : '/';
}
