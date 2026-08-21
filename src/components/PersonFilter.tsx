'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Spinner } from './Spinner';

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
      <label htmlFor="person-filter" className="text-[13px] font-semibold text-ink-soft">
        Person
      </label>
      {/* Rendered beside the label rather than inside the select, which cannot
          hold anything but options. It replaces nothing, so the control keeps
          its width while the new table is fetched. */}
      {pending ? <Spinner className="text-ink-soft" /> : null}
      <select
        id="person-filter"
        value={value}
        disabled={pending}
        aria-busy={pending}
        onChange={(event) => choose(event.target.value)}
        className="field w-auto max-w-[280px] truncate"
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
