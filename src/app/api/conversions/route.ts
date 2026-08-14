import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getStore, statusForError } from '@/lib/store';
import { conversionInputSchema, fieldErrors } from '@/lib/validate';
import { forbidden, unauthorized, viewerFromRequest } from '@/lib/api-auth';

/**
 * Approved applications and what they paid. Admin only: this route decides who
 * is owed how much, so it is checked here as well as in the middleware.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();
  if (viewer.role !== 'admin') return forbidden('Only an admin can record an approval.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  let input;
  try {
    input = conversionInputSchema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Please check the highlighted fields.', fields: fieldErrors(error) },
        { status: 422 },
      );
    }
    throw error;
  }

  try {
    const conversion = await getStore().addConversion(input);
    return NextResponse.json({ conversion }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to record the approval' },
      { status: statusForError(error) },
    );
  }
}
