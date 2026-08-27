import type { Metadata } from 'next';
import { CampaignSettings } from '@/components/CampaignSettings';
import { CommissionSettings } from '@/components/CommissionSettings';
import { ErrorPanel } from '@/components/ErrorPanel';
import { RateFloorSettings } from '@/components/RateFloorSettings';
import { defaultCampaigns } from '@/lib/campaigns';
import { cardsBelowFloor } from '@/lib/cpa';
import { defaultSettings, type Settings } from '@/lib/settings';
import { getStore } from '@/lib/store';
import { requireAdmin } from '@/lib/viewer';
import type { Campaign, Conversion } from '@/lib/types';

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
  let settings: Settings = defaultSettings();
  let conversions: Conversion[] = [];
  let cards = 0;
  let hidden = 0;
  let error: string | null = null;
  try {
    const store = getStore();
    const [saved, current, approvals, report] = await Promise.all([
      store.listCampaigns(),
      store.readSettings(),
      store.listConversions(),
      store.readCpaReport(),
    ]);
    campaigns = saved;
    settings = current;
    conversions = approvals;
    const rates = report?.rows ?? [];
    cards = new Set(rates.map((rate) => `${rate.issuer}|${rate.card}`)).size;
    hidden = cardsBelowFloor(rates, settings.cpaFloor);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'Unknown storage error';
  }

  /*
   * How many approvals sit on each day, so the commission form can say what a
   * start date would restate before anybody presses the button. Days and counts
   * only: the form has no business knowing whose approvals they are or what
   * they were worth, and this crosses to the browser.
   */
  const byDay = new Map<string, number>();
  for (const row of conversions) {
    const day = (row.approvedOn ?? '').slice(0, 10);
    if (day) byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const approvalDays = [...byDay].map(([day, count]) => ({ day, count }));
  const today = new Date().toISOString().slice(0, 10);

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
          <ErrorPanel title="Could not read the settings" message={error} />
        </div>
      ) : null}

      <section className="rise panel mt-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
          <h2 className="font-display text-[18px]">Commission</h2>
          <span className="text-[13px] text-ink-soft">
            {settings.updatedBy ? `Last changed by ${settings.updatedBy}` : 'Never changed'}
          </span>
        </div>

        {error ? null : (
          <CommissionSettings shares={settings.shares} today={today} approvalDays={approvalDays} />
        )}
      </section>

      <section className="rise panel mt-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
          <h2 className="font-display text-[18px]">What the rate card lists</h2>
        </div>

        {error ? null : (
          <RateFloorSettings floor={settings.cpaFloor} hidden={hidden} cards={cards} />
        )}
      </section>

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
