import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { LinkForm } from '@/components/LinkForm';
import { configuredBaseUrl } from '@/lib/config';
import { originFromHeaders } from '@/lib/request';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Create Link' };

export default async function NewLinkPage() {
  const origin = originFromHeaders(await headers(), configuredBaseUrl());

  return (
    <div className="max-w-4xl space-y-10">
      <div>
        <h2 className="font-display text-3xl">Create an affiliate link</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">
          Pair a destination with the person who owns the traffic. The client lands on a short form,
          fills in their details, and is forwarded on — with the row logged against that person.
        </p>
      </div>

      <LinkForm origin={origin} />
    </div>
  );
}
