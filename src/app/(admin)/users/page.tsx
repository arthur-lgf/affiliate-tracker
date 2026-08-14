import type { Metadata } from 'next';
import { ErrorPanel } from '@/components/ErrorPanel';
import { UsersPanel, type AccountRow } from '@/components/UsersPanel';
import { authConfigured } from '@/lib/auth';
import { listUsers, usersEnabled } from '@/lib/users';
import { requireAdmin } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'People' };

export default async function UsersPage() {
  const viewer = await requireAdmin();

  if (!usersEnabled()) {
    return (
      <ErrorPanel
        title="Accounts need a database"
        message={
          'Sign-in accounts are stored in Supabase, not in the Google Sheet, because a spreadsheet is the wrong place for a password hash. ' +
          'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then reload this page. Until then the built-in ADMIN_USER account is the only way in.'
        }
      />
    );
  }

  // The accounts exist but nothing can mint a session for them. Worth saying
  // here rather than letting someone create three people who then cannot sign
  // in and have no idea why.
  if (!authConfigured()) {
    return (
      <ErrorPanel
        title="Sign-in is not configured"
        message={
          'Accounts can be stored, but no session can be issued for them, so nobody could actually sign in. ' +
          'Set SESSION_SECRET (or ADMIN_PASSWORD) and restart, then come back.'
        }
      />
    );
  }

  let rows: AccountRow[];
  try {
    rows = (await listUsers()).map((user) => ({
      id: user.id,
      username: user.username,
      role: user.role,
      usr: user.usr,
      fullName: user.fullName,
      email: user.email,
      active: user.active,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      createdBy: user.createdBy,
    }));
  } catch (error) {
    return (
      <ErrorPanel
        title="Could not read the accounts"
        message={error instanceof Error ? error.message : 'Unknown error'}
      />
    );
  }

  return (
    <div className="w-full">
      <div className="rise">
        <h1 className="font-display leading-[1.05] text-[clamp(1.75rem,7vw,3rem)]">People</h1>
        <p className="mt-3 max-w-[680px] text-[20px] leading-relaxed text-ink-soft">
          Everyone who can sign in. An affiliate account is tied to one tracking key and sees only
          the links, leads and earnings recorded against it. An admin sees all of it.
        </p>
        {viewer.isEnvAdmin ? (
          <p className="plain-note mt-4 max-w-[680px]">
            You are signed in as the built-in <strong>{viewer.username}</strong> account, which
            comes from the environment and is not listed below. It cannot be edited or deleted from
            here, which is what makes it the way back in if these accounts ever go wrong.
          </p>
        ) : null}
      </div>

      <UsersPanel rows={rows} viewerId={viewer.id} viewerUsername={viewer.username} />
    </div>
  );
}
