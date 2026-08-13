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
    <span className="flex items-center gap-2">
      <label htmlFor="person-filter" className="text-[11.5px] text-sage-dim">
        Person
      </label>
      <select
        id="person-filter"
        value={value}
        disabled={pending}
        onChange={(event) => choose(event.target.value)}
        className="max-w-[220px] cursor-pointer truncate rounded-full border border-pine-700 bg-transparent px-3.5 py-2 text-[11.5px] font-medium text-sage transition-colors hover:bg-pine-850 hover:text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-mustard)] disabled:opacity-50"
      >
        <option value="" className="bg-pine-850 text-cream">
          Everyone
        </option>
        {people.map((person) => (
          <option key={person.usr} value={person.usr} className="bg-pine-850 text-cream">
            {person.name}
          </option>
        ))}
      </select>
    </span>
  );
}
