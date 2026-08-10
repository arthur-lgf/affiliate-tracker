'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/links', label: 'Affiliate Links' },
  { href: '/links/new', label: 'Create Link' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-x-7 gap-y-2">
      {ITEMS.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname === item.href;
        return (
          // Classes rather than inline styles: an inline `color`/`transform`
          // beats a hover utility, which left both hover affordances dead.
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`group relative py-1 font-mono text-[0.6875rem] uppercase tracking-[0.18em] transition-colors ${
              active ? 'text-signal' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {item.label}
            <span
              aria-hidden
              className={`absolute -bottom-px left-0 h-px w-full origin-left transition-transform duration-200 ${
                active ? 'scale-x-100 bg-signal' : 'scale-x-0 bg-ink group-hover:scale-x-100'
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
