import Link from 'next/link';
import { MobileTabs, Nav } from '@/components/Nav';
import { SignOutButton } from '@/components/SignOutButton';
import { authConfigured } from '@/lib/auth';
import { storageStatus } from '@/lib/store';

export const dynamic = 'force-dynamic';

/* The storage badge. Each carries its own words as well as its own colour —
   three dots that differ only in hue is not a status anyone can read. */
const STORAGE = {
  sheets: {
    text: 'Sheets connected',
    dot: 'var(--color-leaf-live)',
    className: 'chip chip-live',
  },
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
} as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const status = storageStatus();
  const badge = STORAGE[status];

  return (
    <div className="min-h-screen bg-paper">
      {/* The rule spans the window, but the contents share the column the pages
          use — otherwise the wordmark drifts hundreds of px from the panels on
          a wide monitor. */}
      <header className="border-b-2 border-edge bg-panel">
        <div className="mx-auto flex w-full max-w-[1360px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-7">
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
            <Nav />
            <span className={`${badge.className} hidden lg:inline-flex`}>
              <span
                aria-hidden
                className="h-3 w-3 flex-none rounded-full"
                style={{ background: badge.dot }}
              />
              {badge.text}
            </span>
            {/* Only when there is a session to end. With no password set the
                admin surface is open and "Sign out" would do nothing. */}
            {authConfigured() ? <SignOutButton /> : null}
          </div>
        </div>
      </header>

      {/* pb-28 on phones clears the fixed tab bar; the last panel would
          otherwise sit underneath it and be unreachable at the end of a scroll. */}
      <main className="mx-auto w-full max-w-[1360px] px-5 pb-28 pt-6 sm:px-7 md:pb-20">
        {children}
      </main>

      <MobileTabs />
    </div>
  );
}
