import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { LinkForm, type KnownPerson } from '@/components/LinkForm';
import { linkKey } from '@/lib/analytics';
import { captureFormEnabled, configuredBaseUrl } from '@/lib/config';
import { loadAll } from '@/lib/load';
import { originFromHeaders } from '@/lib/request';
import { storageStatus } from '@/lib/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Create a link' };

const STORAGE_NOTE = {
  sheets: 'Written to your Links sheet straight away.',
  local: 'Written to local storage straight away.',
  unconfigured: 'Storage is not configured — saving will fail until it is.',
} as const;

export default async function NewLinkPage() {
  const origin = originFromHeaders(await headers(), configuredBaseUrl());
  const { links } = await loadAll();

  // Everyone who already owns a link, newest first, so the common case is a
  // one-tap pick rather than retyping a name and key.
  const seen = new Map<string, KnownPerson>();
  for (const link of links) {
    if (!link.usr || seen.has(link.usr)) continue;
    seen.set(link.usr, {
      usr: link.usr,
      assignee: link.assignee || link.usr,
      email: link.assigneeEmail,
    });
  }

  return (
    <div className="w-full">
      <LinkForm
        origin={origin}
        people={[...seen.values()]}
        takenSlugKeys={links.map(linkKey)}
        storageLabel={STORAGE_NOTE[storageStatus()]}
        /* With the capture form hidden the visitor never sees a page of ours,
           so there is nothing to write copy for. */
        capture={captureFormEnabled()}
      />
    </div>
  );
}
