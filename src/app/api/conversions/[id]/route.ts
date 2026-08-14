import { NextResponse } from 'next/server';
import { getStore, statusForError } from '@/lib/store';
import { forbidden, unauthorized, viewerFromRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Admin only. An approval is the money record; an affiliate deleting one would
 * be editing what they are owed.
 */
export async function DELETE(request: Request, { params }: Context) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();
  if (viewer.role !== 'admin') return forbidden('Only an admin can remove an approval.');

  const { id } = await params;
  try {
    await getStore().deleteConversion(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove the approval' },
      { status: statusForError(error) },
    );
  }
}
