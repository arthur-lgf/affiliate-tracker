import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getStore, statusForError } from '@/lib/store';
import { fieldErrors, linkPatchSchema } from '@/lib/validate';
import { forbidden, unauthorized, viewerFromRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Admin only, both verbs.
 *
 * There is no affiliate-scoped version of these: a link's `usr` is the field
 * that decides who gets paid for its traffic, so an affiliate able to PATCH
 * their own link could point somebody else's at themselves. Editing is a whole
 * privilege, not a scoped one.
 */
export async function PATCH(request: Request, { params }: Context) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();
  if (viewer.role !== 'admin') return forbidden('Only an admin can change links.');

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  let patch;
  try {
    patch = linkPatchSchema.parse(body);
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
    const link = await getStore().updateLink(id, patch);
    return NextResponse.json({ link });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update the link' },
      { status: statusForError(error) },
    );
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();
  if (viewer.role !== 'admin') return forbidden('Only an admin can delete links.');

  const { id } = await params;
  try {
    await getStore().deleteLink(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete the link' },
      { status: statusForError(error) },
    );
  }
}
