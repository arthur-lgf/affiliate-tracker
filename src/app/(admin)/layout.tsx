import Link from 'next/link';
import { MobileTabs, Nav } from '@/components/Nav';
import { SignOutButton } from '@/components/SignOutButton';
import { authConfigured } from '@/lib/auth';
import { storageStatus, type StorageStatus } from '@/lib/store';
import { requireViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

/*
 * The storage badge, which now says nothing when there is nothing to say.
 *
 * It used to sit there reading "Database connected" on every page of every
 * working day — a permanent green light confirming that the normal thing was
 * happening, which is a sentence nobody needs twice, let alone a thousand
 * times. The two states left are the ones worth interrupting for: rows going to
 * a file on somebody's laptop, and no store configured at all.
 *
 * Each carries its own words as well as its own colour — two dots that differ
 * only in hue is not a status anyone can read.
 */
type Badge = { text: string; dot: string; className: string };

const STORAGE: Partial<Record<StorageStatus, Badge>> = {
  local: {
    text: 'Local storage',
    dot: 'var(--color-ink-dim)',
    className: 'chip chip-quiet',
  },
  unconfigured: {
    text: 'Storage not set up',
    dot: 'var(--color-gold-edge)',
    className: 'chip',
  },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Undefined on a healthy deployment, which is the point.
  const badge = STORAGE[storageStatus()];
  // Resolved here as well as in each page. The layout renders the navigation,
  // and a nav built from an unverified guess at who is looking is a nav that
  // offers an affiliate the admin tabs.
  const viewer = await requireViewer();
  const isAdmin = viewer.role === 'admin';

  return (
    <div className="min-h-screen bg-paper">
      {/* The header uses the same width and the same side padding as the pages
          below it, so the wordmark sits over the left edge of the panels and
          Sign out over their right edge however wide the window is. Those two
          values have to stay in step with <main>. */}
      <header className="border-b-2 border-edge bg-panel">
        <div className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-7 2xl:px-10">
          {/* py-1.5 takes the wordmark from 36px to a 48px target — it is the
              "go home" link, not an inline link in a sentence. */}
          <Link href="/" className="flex flex-none items-center gap-3.5 rounded-xl py-1.5">
            <span
              aria-hidden
              className="h-9 w-9 rounded-full border-2 border-ink bg-gold"
            />
            <span className="font-display text-[30px] leading-none">Ledger</span>
          </Link>

          <div className="flex min-w-0 items-center gap-4">
            <Nav isAdmin={isAdmin} />
            {badge ? (
              <span className={`${badge.className} hidden lg:inline-flex`}>
                <span
                  aria-hidden
                  className="h-3 w-3 flex-none rounded-full"
                  style={{ background: badge.dot }}
                />
                {badge.text}
              </span>
            ) : null}
            {/* Who you are signed in as. An affiliate sees a filtered version of
                every figure on every page, so the one thing that must never be
                ambiguous is whose numbers these are. */}
            {viewer.open ? null : (
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate text-[17px] font-semibold leading-tight">
                  {viewer.username}
                </span>
                <span className="block truncate text-[15px] leading-tight text-ink-soft">
                  {isAdmin ? 'Admin' : `Your links only · usr=${viewer.usr}`}
                </span>
              </span>
            )}
            {/* Only when there is a session to end. With nothing configured the
                admin surface is open and "Sign out" would do nothing. */}
            {authConfigured() ? <SignOutButton /> : null}
          </div>
        </div>
      </header>

      {/* Full width on purpose: the tables here are the point of the tool, and
          a rate card or a QMP report has more columns than a reading column can
          hold. Prose is not dragged along with it — every paragraph on every
          page carries its own max-width, so sentences stay the length a person
          can read while the tables get the whole monitor.

          pb-28 on phones clears the fixed tab bar; the last panel would
          otherwise sit underneath it and be unreachable at the end of a scroll. */}
      <main className="w-full px-5 pb-28 pt-6 sm:px-7 2xl:px-10 md:pb-20">
        {children}
      </main>

      <MobileTabs isAdmin={isAdmin} />
    </div>
  );
}
