'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = { href: string; label: string; adminOnly?: boolean };

const ITEMS: Item[] = [
  { href: '/', label: 'Overview' },
  { href: '/links', label: 'Links' },
  // Not admin-only: an affiliate may create links, but only ever their own.
  // The page hands them themselves instead of a picker, and the route decides
  // ownership again from the session whatever the form posts.
  { href: '/links/new', label: 'Create' },
  // Everyone: an affiliate quoting a card needs to know what it pays as much
  // as an admin does, and none of it is anybody's personal data. Only the
  // upload on that page is admin-only, and the route enforces that itself.
  { href: '/cpa', label: 'CPA', },
  { href: '/reports', label: 'Reports', adminOnly: true },
  { href: '/users', label: 'People', adminOnly: true },
];

/**
 * Hiding a tab is presentation, not protection. Every page behind these
 * re-checks the role server-side, because a hidden link is still a URL anyone
 * can type. This exists so an affiliate is not shown doors that all say no.
 */
function visibleItems(isAdmin: boolean): Item[] {
  return isAdmin ? ITEMS : ITEMS.filter((item) => !item.adminOnly);
}

/** Which item owns the current URL. `/affiliate/*` belongs to Overview — it is
 *  the page you reach by opening a row there, not a section of its own. */
function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/affiliate');
  if (href === '/links') return pathname === '/links';
  if (href === '/cpa') return pathname.startsWith('/cpa');
  if (href === '/reports') return pathname.startsWith('/reports');
  if (href === '/users') return pathname.startsWith('/users');
  return pathname.startsWith('/links/new');
}

/** The header tabs. Hidden on phones, where the bar at the bottom takes over. */
export function Nav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className="hidden items-center gap-3 md:flex">
      {visibleItems(isAdmin).map((item) => (
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
export function MobileTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-edge bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex items-stretch px-2">
        {visibleItems(isAdmin).map((item) => {
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
