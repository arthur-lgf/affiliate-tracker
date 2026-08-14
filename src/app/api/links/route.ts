import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { scopeData } from '@/lib/scope';
import { getStore, statusForError } from '@/lib/store';
import { fieldErrors, linkInputSchema } from '@/lib/validate';
import { forbidden, unauthorized, viewerFromRequest } from '@/lib/api-auth';

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

export async function POST(request: Request) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();
  // Creating a link means choosing whose tracking key it pays out to, which is
  // the one decision an affiliate must never make for themselves.
  if (viewer.role !== 'admin') return forbidden('Only an admin can create links.');

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

  try {
    const link = await getStore().createLink({
      slug: input.slug,
      usr: input.usr,
      assignee: input.assignee,
      assigneeEmail: input.assigneeEmail,
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
