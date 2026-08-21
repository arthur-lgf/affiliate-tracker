import type { Metadata } from 'next';
import { CampaignSettings } from '@/components/CampaignSettings';
import { ErrorPanel } from '@/components/ErrorPanel';
import { defaultCampaigns } from '@/lib/campaigns';
import { getStore } from '@/lib/store';
import { requireAdmin } from '@/lib/viewer';
import type { Campaign } from '@/lib/types';

/**
 * Settings.
 *
 * Admin only, and campaigns are why: a campaign decides where a link sends
 * people, so anyone who can edit one can redirect the team's traffic. Everyone
 * signed in still *reads* the list — the link form needs it — but that read
 * happens on the server, on the page that needs it, not through here.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await requireAdmin();

  let campaigns: Campaign[] = [];
  let error: string | null = null;
  try {
    campaigns = await getStore().listCampaigns();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'Unknown storage error';
  }

  /*
   * Nothing saved yet means the built-in categories, which is what the campaign
   * picker has always offered. Showing them here rather than an empty table is
   * what makes the first save a small edit instead of retyping two dozen names
   * that are already attached to live links.
   */
  const usingDefaults = !error && campaigns.length === 0;
  const rows = usingDefaults ? defaultCampaigns() : campaigns;

  return (
    <div className="w-full">
      <div className="rise">
        <h1 className="font-display leading-[1.05] text-[26px]">Settings</h1>
        <p className="plain mt-3">
          Shared settings for everyone who uses Ledger. Only an admin can change them.
        </p>
      </div>

      {error ? (
        <div className="mt-5">
          <ErrorPanel title="Could not read the campaigns" message={error} />
        </div>
      ) : null}

      <section className="rise panel mt-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
          <h2 className="font-display text-[18px]">Campaigns</h2>
          <span className="text-[13px] text-ink-soft">
            {rows.length} offer{rows.length === 1 ? '' : 's'}
          </span>
        </div>

        {error ? null : <CampaignSettings campaigns={rows} usingDefaults={usingDefaults} />}
      </section>
    </div>
  );
}
