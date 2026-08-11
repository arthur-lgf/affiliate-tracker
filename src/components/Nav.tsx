'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Overview' },
  { href: '/links', label: 'Links' },
  { href: '/links/new', label: 'Create' },
];

/** Segmented pill nav — the active segment is the only mustard thing up here. */
export function Nav() {
  const pathname = usePathname();

  return (
    // Scrolls rather than pushing the page sideways on very narrow phones.
    <nav className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-pine-850 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ITEMS.map((item) => {
        const active =
          item.href === '/'
            ? pathname === '/'
            : item.href === '/links'
              ? pathname === '/links'
              : pathname.startsWith('/links/new');
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex-none rounded-full px-3 py-2 text-xs transition-colors sm:px-4 ${
              active
                ? 'bg-mustard font-medium text-pine-900'
                : 'text-sage hover:bg-pine-800 hover:text-cream'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
