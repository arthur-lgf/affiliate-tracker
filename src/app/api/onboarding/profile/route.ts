import { NextResponse } from 'next/server';
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/auth';
import { actorFor, invalid, jsonBody, nextPath, noteSubmission, storeResponse, str } from '@/lib/onboarding-api';
import { profileProblems } from '@/lib/onboarding';
import { saveProfile } from '@/lib/onboarding-store';
import { isSecureRequest } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * Step 1: their details, and a password that is theirs.
 *
 * The interesting part is the cookie at the bottom. Every session token carries
 * the password_changed_at it was minted under, and changing a password moves
 * that forward — which is exactly what makes an admin's "reset their password"
 * end their sessions. Here it would end the session of the person doing the
 * resetting, mid-flow, and drop them on the sign-in page one step into a
 * four-step form. So a replacement token is minted from the new timestamp and
 * set in the same response.
 */
export async function POST(request: Request) {
  const gate = await actorFor(request, 'profile');
  if ('response' in gate) return gate.response;
  const { viewer, state, approval, bypass } = gate;

  const body = await jsonBody(request);
  if (body && typeof body === 'object' && 'response' in body) {
    return (body as { response: NextResponse }).response;
  }

  const input = {
    fullName: str(body, 'fullName'),
    email: str(body, 'email'),
    position: str(body, 'position'),
    mobile: str(body, 'mobile'),
    password: str(body, 'password'),
    confirmPassword: str(body, 'confirmPassword'),
  };

  /*
   * state.profile is true only for somebody who has been through this step
   * before, which is exactly when leaving both password fields empty is a
   * request to keep the password rather than an omission. On a first run they
   * are still required: the whole reason step 1 exists is that the password on
   * the account is one an admin typed.
   */
  const problems = profileProblems(input, { passwordSet: state.profile });
  if (Object.keys(problems).length > 0) return invalid(problems);

  let passwordChangedAt: string | null;
  try {
    ({ passwordChangedAt } = await saveProfile(viewer.id, input));
  } catch (error) {
    return storeResponse(error);
  }

  await noteSubmission(viewer.id, state, 'profile');

  const response = NextResponse.json({ ok: true, next: nextPath(state, 'profile', approval, bypass) });

  // Nothing to re-mint when the password did not move: the token they arrived
  // with is still the right one.
  if (!passwordChangedAt) return response;

  try {
    const token = await createSessionToken({
      uid: viewer.id,
      user: viewer.username,
      role: viewer.role,
      usr: viewer.usr,
      pwdAt: Date.parse(passwordChangedAt) || 0,
    });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(isSecureRequest(request)));
  } catch {
    /*
     * The password did change — that write already landed — so this is not a
     * failure of the step. What it costs is one sign-in with the new password,
     * which is a great deal better than reporting an error for something that
     * has already happened and inviting them to do it twice.
     */
  }

  return response;
}
