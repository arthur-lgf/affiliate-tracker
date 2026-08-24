import Link from 'next/link';
import { SignOutButton } from '@/components/SignOutButton';
import { authConfigured } from '@/lib/auth';
import { initialsOf } from '@/lib/analytics';
import { requireViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

/**
 * The way in, before there is a way in.
 *
 * Deliberately not the admin shell. Every tab in that navigation leads to a
 * page this person is not allowed to open yet, so drawing it would be drawing
 * seven doors that are all locked. What is left is the identity bar — which
 * product, which account — and a way to sign out, because somebody handed the
 * wrong credentials needs an exit that is not the back button.
 */
export default async function WelcomeLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();

  return (
    <div className="min-h-screen bg-paper">
      <header className="flex h-[52px] items-center justify-between gap-6 bg-navy px-5 text-white sm:px-7">
        <Link href="/welcome" className="flex flex-none items-center gap-2.5">
          <span aria-hidden className="h-[18px] w-[18px] flex-none bg-gold" />
          <span className="text-[15px] font-semibold tracking-[0.02em]">Ledger</span>
          <span aria-hidden className="mx-1.5 h-[18px] w-px bg-navy-rule" />
          <span className="hidden text-[12px] uppercase tracking-[0.06em] text-navy-mute sm:inline">
            Getting set up
          </span>
        </Link>

        <div className="flex min-w-0 items-center gap-4">
          {viewer.open ? null : (
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden
                className="flex h-[26px] w-[26px] flex-none items-center justify-center bg-navy-rule text-[10px] font-semibold text-navy-chip"
              >
                {initialsOf(viewer.username)}
              </span>
              <span className="hidden min-w-0 text-[12px] font-medium sm:block">
                <span className="block truncate">{viewer.username}</span>
              </span>
            </span>
          )}
          {authConfigured() ? <SignOutButton /> : null}
        </div>
      </header>

      {/* A reading measure, not the full width: these are forms and documents,
          not tables, and a paragraph that runs the whole way across a monitor is
          one the eye loses its place in on every line. */}
      <main className="mx-auto w-full max-w-[900px] px-5 pb-20 pt-7 sm:px-7">{children}</main>
    </div>
  );
}
