import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getStore, statusForError } from '@/lib/store';
import { fieldErrors, linkInputSchema } from '@/lib/validate';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const links = await getStore().listLinks();
    return NextResponse.json({ links });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read links' },
      { status: statusForError(error) },
    );
  }
}

export async function POST(request: Request) {
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
