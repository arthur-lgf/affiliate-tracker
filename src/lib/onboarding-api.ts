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
import { canOpen, type StepKey } from './onboarding';
import { onboardingEnabled, readOnboarding, type SigningMeta } from './onboarding-store';
import { StoreConfigError } from './store/errors';

export type Actor = { viewer: Viewer; meta: SigningMeta };

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

  let state;
  try {
    state = await readOnboarding(viewer.id);
  } catch (error) {
    return { response: storeResponse(error) };
  }

  if (!canOpen(state, step)) {
    return {
      response: NextResponse.json(
        { error: 'Finish the earlier steps first.' },
        { status: 409 },
      ),
    };
  }

  return {
    viewer,
    meta: { ip: clientIp(request), userAgent: userAgent(request) },
  };
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
