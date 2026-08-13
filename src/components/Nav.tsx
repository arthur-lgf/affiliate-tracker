'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Overview' },
  { href: '/links', label: 'Links' },
  { href: '/links/new', label: 'Create' },
];

/** Which item owns the current URL. `/affiliate/*` belongs to Overview — it is
 *  the page you reach by opening a row there, not a section of its own. */
function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/affiliate');
  if (href === '/links') return pathname === '/links';
  return pathname.startsWith('/links/new');
}

/** The header tabs. Hidden on phones, where the bar at the bottom takes over. */
export function Nav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className="hidden items-center gap-3 md:flex">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(item.href, pathname) ? 'page' : undefined}
          className="pill-tab"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The same three destinations pinned to the bottom of a phone screen, where
 * the thumb is. Full-width targets, 17px labels, and a thick bar over the
 * active one so "where am I" survives being read at arm's length.
 */
export function MobileTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-edge bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex items-stretch px-2">
        {ITEMS.map((item) => {
          const active = isActive(item.href, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className="flex flex-1 flex-col items-center gap-1.5 rounded-xl px-2 pb-3 pt-3"
            >
              <span
                aria-hidden
                className={`h-1.5 w-11 rounded-full ${active ? 'bg-leaf' : 'bg-edge-faint'}`}
              />
              <span
                className={`text-[17px] ${active ? 'font-bold text-leaf' : 'text-ink-soft'}`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
