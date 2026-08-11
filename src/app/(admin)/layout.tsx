import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { storageStatus } from '@/lib/store';

export const dynamic = 'force-dynamic';

const STORAGE_LABEL: Record<string, { text: string; color: string }> = {
  sheets: { text: 'Google Sheets connected', color: 'var(--color-ok)' },
  local: { text: 'Local storage mode', color: 'var(--color-muted)' },
  unconfigured: { text: 'Storage not configured', color: 'var(--color-signal)' },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const status = storageStatus();
  const onSheets = status === 'sheets';
  const badge = STORAGE_LABEL[status]!;

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
              style={{ background: badge.color }}
            />
            <span className="eyebrow" style={{ color: badge.color }}>
              {badge.text}
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
          Affiliate Ledger —{' '}
          {onSheets
            ? 'writing to Google Sheets'
            : status === 'local'
              ? 'writing to ./.data'
              : 'no storage configured'}
        </p>
      </footer>
    </div>
  );
}
