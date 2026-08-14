import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { authConfigured } from '@/lib/auth';
import { statusForError } from '@/lib/store';
import { fieldErrors, newUserSchema } from '@/lib/validate';
import { createUser, listUsers, usersEnabled } from '@/lib/users';
import { forbidden, unauthorized, viewerFromRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * Sign-in accounts.
 *
 * Admin only, checked here rather than left to the middleware: this is the
 * route that mints credentials, so it is the last place worth trusting another
 * layer to have got it right.
 */
export async function GET(request: Request) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();
  if (viewer.role !== 'admin') return forbidden('Only an admin can see the account list.');

  if (!usersEnabled()) return NextResponse.json({ users: [], enabled: false });

  try {
    return NextResponse.json({ users: await listUsers(), enabled: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read accounts' },
      { status: statusForError(error) },
    );
  }
}

export async function POST(request: Request) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();
  if (viewer.role !== 'admin') return forbidden('Only an admin can create accounts.');

  if (!usersEnabled()) {
    return NextResponse.json(
      {
        error: 'Accounts need a database.',
        hint: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then reload.',
      },
      { status: 503 },
    );
  }

  // Creating an account that nothing can sign in to is worse than refusing:
  // it looks like it worked, and the password it shows you is useless.
  if (!authConfigured()) {
    return NextResponse.json(
      {
        error: 'Sign-in is not configured, so a new account could not be used.',
        hint: 'Set SESSION_SECRET (or ADMIN_PASSWORD) and restart, then create the account.',
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  let input;
  try {
    input = newUserSchema.parse(body);
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
    const { user, password } = await createUser({
      username: input.username,
      role: input.role,
      fullName: input.fullName,
      email: input.email,
      createdBy: viewer.username,
    });
    // The only time this password is ever readable. It is not stored, not
    // logged, and cannot be fetched again — losing it means resetting it.
    return NextResponse.json({ user, password }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create the account' },
      { status: statusForError(error) },
    );
  }
}
