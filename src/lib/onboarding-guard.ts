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
  canOpen,
  firstMissingRequired,
  isComplete,
  nextStep,
  NOTHING_DONE,
  type OnboardingState,
  type StepKey,
} from './onboarding';
import { onboardingEnabled, readOnboarding } from './onboarding-store';
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
const stateFor = cache(async (userId: string): Promise<OnboardingState> => {
  try {
    return await readOnboarding(userId);
  } catch {
    /*
     * A database that cannot answer must not become a locked door. Treating an
     * unreadable state as "finished" fails open, which is the right way round
     * here: the worst case is an affiliate briefly seeing the app before their
     * paperwork is in, and the alternative is everybody stuck on a form that
     * cannot save either.
     */
    return { profile: true, agreement: true, w9: true, bank: true };
  }
});

export type Onboarding = {
  viewer: Viewer;
  state: OnboardingState;
  /** False for admins, the env account, and an app with no database. */
  applies: boolean;
};

export async function onboardingFor(viewer: Viewer): Promise<Onboarding> {
  if (!onboards(viewer)) {
    return { viewer, state: { ...NOTHING_DONE }, applies: false };
  }
  return { viewer, state: await stateFor(viewer.id), applies: true };
}

/**
 * For any page inside the app.
 *
 * Sends an affiliate who still owes a signature to the earliest step they owe.
 * Bank details are not checked here on purpose — that step nags from a banner
 * rather than barring the door.
 */
export async function requireOnboarded(): Promise<Onboarding> {
  const viewer = await requireViewer();
  const onboarding = await onboardingFor(viewer);
  if (!onboarding.applies) return onboarding;

  const missing = firstMissingRequired(onboarding.state);
  if (missing) redirect(missing.path);
  return onboarding;
}

/**
 * For one step of the flow.
 *
 * Three ways out, and they are all redirects rather than errors: somebody who
 * does not onboard has no business here, somebody who has not reached this step
 * is sent back to the one they are on, and somebody who has already done it is
 * moved forward rather than being allowed to sign the same thing twice.
 */
export async function requireStep(key: StepKey): Promise<Onboarding> {
  const viewer = await requireViewer();
  const onboarding = await onboardingFor(viewer);
  if (!onboarding.applies) redirect('/');

  const { state } = onboarding;
  if (!canOpen(state, key)) {
    redirect((nextStep(state) ?? { path: '/' }).path);
  }
  if (state[key]) {
    redirect(isComplete(state) ? '/' : (nextStep(state) ?? { path: '/' }).path);
  }
  return onboarding;
}
