import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { LinkForm, type KnownPerson } from '@/components/LinkForm';
import { linkKey } from '@/lib/analytics';
import { captureFormEnabled, configuredBaseUrl } from '@/lib/config';
import { loadAll } from '@/lib/load';
import { originFromHeaders } from '@/lib/request';
import { storageStatus } from '@/lib/store';
import { listUsers, usersEnabled } from '@/lib/users';
import { requireAdmin } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Create a link' };

const STORAGE_NOTE = {
  supabase: 'Written to your database straight away.',
  sheets: 'Written to your Links sheet straight away.',
  local: 'Written to local storage straight away.',
  unconfigured: 'Storage is not configured, so saving will fail until it is.',
} as const;

export default async function NewLinkPage() {
  // Creating a link decides whose tracking key gets paid for its traffic, so
  // this page is admin only and says so before it reads anything.
  const viewer = await requireAdmin();
  const origin = originFromHeaders(await headers(), configuredBaseUrl());
  const { links } = await loadAll(viewer);

  // Who a link can belong to: the affiliate accounts, each with the tracking
  // key it was given when it was created.
  //
  // This used to be assembled from whoever already owned a link, which meant a
  // link could be created for a key with no account behind it — traffic nobody
  // could sign in and see. Reading the accounts instead makes every new link
  // belong to a real person, and takes the key out of the admin's hands.
  const people: KnownPerson[] = [];
  if (usersEnabled()) {
    try {
      for (const account of await listUsers()) {
        if (account.role !== 'affiliate' || !account.active) continue;
        people.push({
          usr: account.usr,
          assignee: account.fullName || account.username,
          email: account.email,
          username: account.username,
        });
      }
    } catch {
      // A database that will not answer should not take the page down: the form
      // still works for a house link, and the empty state says why it is empty.
    }
  } else {
    // No accounts table (Sheets or local storage). Fall back to the people who
    // already own links, so the form is not reduced to house links only.
    const seen = new Map<string, KnownPerson>();
    for (const link of links) {
      if (!link.usr || seen.has(link.usr)) continue;
      seen.set(link.usr, {
        usr: link.usr,
        assignee: link.assignee || link.usr,
        email: link.assigneeEmail,
      });
    }
    people.push(...seen.values());
  }

  return (
    <div className="w-full">
      <LinkForm
        origin={origin}
        people={people}
        takenSlugKeys={links.map(linkKey)}
        storageLabel={STORAGE_NOTE[storageStatus()]}
        /* With the capture form hidden the visitor never sees a page of ours,
           so there is nothing to write copy for. */
        capture={captureFormEnabled()}
      />
    </div>
  );
}
