'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Person filter. A select rather than pills because the list grows with every
 * assignee, and it navigates on change so the table stays server-rendered —
 * the filter is in the URL, so a filtered view can be bookmarked or shared.
 */
export function PersonFilter({
  people,
  value,
}: {
  people: { usr: string; name: string }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function choose(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next) query.set('usr', next);
    else query.delete('usr');
    const search = query.toString();
    startTransition(() => router.push(search ? `${pathname}?${search}` : pathname));
  }

  return (
    <span className="flex min-w-0 items-center gap-3">
      <label htmlFor="person-filter" className="text-[19px] font-semibold text-ink-soft">
        Person
      </label>
      <select
        id="person-filter"
        value={value}
        disabled={pending}
        onChange={(event) => choose(event.target.value)}
        className="field max-w-[280px] truncate"
        /* Overrides rather than a second class: this is the one .field in the
           app that sits in a filter bar, not in a form. */
        style={{
          minHeight: '56px',
          fontSize: '19px',
          fontWeight: 600,
          borderColor: 'var(--color-ink)',
        }}
      >
        <option value="">Everyone</option>
        {people.map((person) => (
          <option key={person.usr} value={person.usr}>
            {person.name}
          </option>
        ))}
      </select>
    </span>
  );
}
