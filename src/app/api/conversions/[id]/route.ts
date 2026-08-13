import { NextResponse } from 'next/server';
import { getStore, statusForError } from '@/lib/store';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Context) {
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
