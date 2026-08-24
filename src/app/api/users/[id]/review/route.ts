import { NextResponse } from 'next/server';
import { requireApiAdmin } from '@/lib/api-auth';
import {
  isReviewDecision,
  reviewProblems,
  shouldEmailApproval,
  type ReviewDecision,
} from '@/lib/approval';
import { accountApprovedEmail } from '@/lib/emails/account-approved';
import { EmailError, emailProblem, sendEmail } from '@/lib/email';
import { configuredBaseUrl } from '@/lib/config';
import { storeResponse } from '@/lib/onboarding-api';
import { markApprovalEmailed, readProgress, setApproval } from '@/lib/onboarding-store';
import { originFromHeaders } from '@/lib/request';
import { findUserById, usersEnabled } from '@/lib/users';

export const dynamic = 'force-dynamic';

/**
 * An admin decides.
 *
 * The order here is the whole design. The decision is written first and the
 * email is sent afterwards, and a failure to send is reported without undoing
 * anything: an approval that could not be emailed is an approval, and rolling
 * one back because a mail domain is unverified would mean the state of somebody
 * else's account depends on whether a third party answered a POST.
 *
 * So the response says both things separately. "Approved" and "we could not
 * tell them" are different facts and the admin needs both.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiAdmin(request, 'Only an admin can review an account.');
  if ('response' in gate) return gate.response;
  const { viewer } = gate;

  if (!usersEnabled()) {
    return NextResponse.json(
      { error: 'Accounts need a database. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 503 },
    );
  }

  const { id } = await context.params;

  let body: { decision?: unknown; note?: unknown };
  try {
    body = (await request.json()) as { decision?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const decision: ReviewDecision = isReviewDecision(body.decision) ? body.decision : 'pending';
  const note = typeof body.note === 'string' ? body.note : '';

  const problems = reviewProblems({ decision, note });
  if (Object.keys(problems).length > 0) {
    return NextResponse.json(
      { error: 'Please check the highlighted fields.', fields: problems },
      { status: 422 },
    );
  }

  const account = await findUserById(id).catch(() => null);
  if (!account) return NextResponse.json({ error: 'No such account.' }, { status: 404 });
  if (account.role !== 'affiliate') {
    // Admins do not onboard and are not gated on approval, so a decision here
    // would be a value nothing reads.
    return NextResponse.json(
      { error: 'Only affiliate accounts go through review.' },
      { status: 409 },
    );
  }

  let before;
  try {
    before = (await readProgress(id)).approval;
  } catch (error) {
    return storeResponse(error);
  }

  const sendsEmail = shouldEmailApproval(before, decision);

  let approval;
  try {
    approval = await setApproval(id, { decision, note, by: viewer.username });
  } catch (error) {
    return storeResponse(error);
  }

  if (!sendsEmail) {
    return NextResponse.json({ ok: true, approval, emailed: false });
  }

  if (!account.email) {
    return NextResponse.json({
      ok: true,
      approval,
      emailed: false,
      emailProblem: 'That account has no email address, so nothing was sent.',
    });
  }

  try {
    await sendEmail(
      accountApprovedEmail({
        to: account.email,
        name: account.fullName || account.username,
        origin: originFromHeaders(request.headers, configuredBaseUrl()),
        note,
      }),
    );
  } catch (error) {
    const why =
      error instanceof EmailError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'The email could not be sent.';
    return NextResponse.json({ ok: true, approval, emailed: false, emailProblem: why });
  }

  try {
    await markApprovalEmailed(id);
    approval = { ...approval, emailedAt: new Date().toISOString() };
  } catch {
    // The message went. Failing to write down that it went is not worth
    // reporting as a failure to the person who just watched it happen.
  }

  return NextResponse.json({ ok: true, approval, emailed: true, emailProblem: emailProblem() });
}
