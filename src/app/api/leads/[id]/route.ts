import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getStore, statusForError } from '@/lib/store';
import { fieldErrors, submissionPatchSchema } from '@/lib/validate';

/**
 * Admin-side updates to a captured lead — currently just its status.
 *
 * Deliberately NOT under /api/submissions: that path is the public capture
 * endpoint and is excluded from the Basic-auth matcher on purpose. Hanging an
 * authenticated route off it would mean either leaving this one open or gating
 * the form the whole tool depends on.
 */

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  let patch;
  try {
    patch = submissionPatchSchema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'That is not a status we recognise.', fields: fieldErrors(error) },
        { status: 422 },
      );
    }
    throw error;
  }

  try {
    const submission = await getStore().updateSubmission(id, patch);
    return NextResponse.json({ submission });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update the lead' },
      { status: statusForError(error) },
    );
  }
}
