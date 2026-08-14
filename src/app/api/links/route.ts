import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ownerForNewLink, scopeData, type SelfAccount } from '@/lib/scope';
import { getStore, statusForError } from '@/lib/store';
import { findUserById, usersEnabled } from '@/lib/users';
import { fieldErrors, linkInputSchema } from '@/lib/validate';
import { forbidden, unauthorized, viewerFromRequest, type Viewer } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * Every handler resolves the viewer itself rather than trusting the middleware.
 * The middleware only proved the request is signed in; it cannot know whether
 * that account is still an admin, and this is a route that hands back every
 * affiliate's destination URLs.
 */
export async function GET(request: Request) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();

  try {
    const links = await getStore().listLinks();
    const scoped = scopeData({ links, submissions: [], visits: [], conversions: [] }, viewer);
    return NextResponse.json({ links: scoped.links });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read links' },
      { status: statusForError(error) },
    );
  }
}

/**
 * The viewer's own account row, for filling in their name and email.
 *
 * Best effort on purpose: a database that will not answer must not stop
 * somebody creating a link for themselves, because none of this decides
 * anything — the tracking key, which is the part that matters, comes from the
 * session and is never read from here.
 */
async function selfAccount(viewer: Viewer): Promise<SelfAccount | null> {
  if (!usersEnabled()) return null;
  try {
    const account = await findUserById(viewer.id);
    if (!account) return null;
    return { fullName: account.fullName, email: account.email, username: account.username };
  } catch {
    return null;
  }
}

/**
 * Anyone signed in may create a link. What they may not do is say whose it is:
 * an affiliate's is bound to the key on their session, whatever the body asks
 * for. See ownerForNewLink in lib/scope.ts, where that rule lives and is tested.
 */
export async function POST(request: Request) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  let input;
  try {
    input = linkInputSchema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Please fix the highlighted fields.', fields: fieldErrors(error) },
        { status: 422 },
      );
    }
    throw error;
  }

  const decision = ownerForNewLink(
    viewer,
    { usr: input.usr, assignee: input.assignee, assigneeEmail: input.assigneeEmail },
    viewer.role === 'admin' ? null : await selfAccount(viewer),
  );
  if (!decision.ok) return forbidden(decision.reason);
  const owner = decision.owner;

  try {
    const link = await getStore().createLink({
      slug: input.slug,
      usr: owner.usr,
      assignee: owner.assignee,
      assigneeEmail: owner.assigneeEmail,
      campaign: input.campaign,
      destination: input.destination,
      headline: input.headline,
      subheadline: input.subheadline,
      ctaLabel: input.ctaLabel,
      requirePhone: input.requirePhone,
      passUsrParam: input.passUsrParam,
      active: input.active,
      notes: input.notes,
    });
    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create the link' },
      { status: statusForError(error) },
    );
  }
}
