import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { storageStatus } from '@/lib/store';

export const dynamic = 'force-dynamic';

const STORAGE = {
  sheets: { text: 'Sheets connected', dot: 'var(--color-moss)' },
  local: { text: 'Local storage', dot: 'var(--color-sage-dim)' },
  unconfigured: { text: 'Storage not configured', dot: 'var(--color-mustard)' },
} as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const status = storageStatus();
  const badge = STORAGE[status];

  return (
    <div className="min-h-screen bg-pine-900">
      {/* The rule spans the window, but the contents share the 1280px column
          the pages use — otherwise the wordmark drifts hundreds of px away
          from the panels on a wide monitor. */}
      <header className="border-b border-pine-line">
        <div className="mx-auto flex h-[66px] w-full max-w-[1280px] items-center justify-between gap-3 px-5 sm:px-7">
          <Link href="/" className="flex flex-none items-center gap-3">
            <span aria-hidden className="h-6 w-6 rounded-full bg-mustard" />
            <span className="font-display text-[21px] leading-none">Ledger</span>
          </Link>

          <div className="flex min-w-0 items-center gap-4 sm:gap-6">
            <Nav />
            <span className="hidden items-center gap-2 text-xs text-sage lg:flex">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: badge.dot }}
              />
              {badge.text}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] px-5 pb-16 pt-6 sm:px-7">{children}</main>
    </div>
  );
}
