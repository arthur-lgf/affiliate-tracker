import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const store = getStore();
  const onSheets = store.kind === 'sheets';

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1240px] px-5 sm:px-8">
      <header className="pt-7">
        {/* Slug line: mode + date, the way a masthead carries edition info. */}
        <div className="flex items-center justify-between gap-4 border-b border-rule pb-2">
          <span className="eyebrow">Affiliate Operations</span>
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: onSheets ? 'var(--color-ok)' : 'var(--color-muted)' }}
            />
            <span className="eyebrow" style={{ color: onSheets ? 'var(--color-ok)' : undefined }}>
              {onSheets ? 'Google Sheets connected' : 'Local storage mode'}
            </span>
          </span>
        </div>

        <div className="flex flex-col gap-6 py-6 md:flex-row md:items-end md:justify-between">
          <Link href="/" className="group block">
            <h1 className="font-display text-[2.75rem] leading-[0.95] tracking-tight sm:text-[3.5rem]">
              Affiliate <span className="italic text-signal">Ledger</span>
            </h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-2">
              Assign a link to a person, capture the lead, forward them on. Every row lands in
              your sheet.
            </p>
          </Link>
          <Nav />
        </div>

        {/* Double rule — the editorial signature of the layout. */}
        <div className="draw-rule border-t-[3px] border-ink" />
        <div className="draw-rule mt-[3px] border-t border-ink" style={{ animationDelay: '90ms' }} />
      </header>

      <main className="pb-24 pt-8">{children}</main>

      <footer className="border-t border-rule py-6">
        <p className="eyebrow">
          Affiliate Ledger — {onSheets ? 'writing to Google Sheets' : 'writing to ./.data'}
        </p>
      </footer>
    </div>
  );
}
