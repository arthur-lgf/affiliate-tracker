/**
 * One campaign as a row of cells, and back.
 *
 * Shared by the Sheets and the JSON adapters so a campaign reads the same
 * whichever one is running, exactly as conversion-row.ts does for approvals and
 * cpa-row.ts for rates. The column order lives in SHEET_HEADERS.campaigns and
 * this file must follow it.
 */

import { normalizeCampaigns } from '../campaigns';
import type { Campaign } from '../types';

export function campaignToCells(campaign: Campaign): string[] {
  return [campaign.name, campaign.destination];
}

/**
 * Cells back into campaigns, in the order they were written.
 *
 * Order is the whole state of this list — there is no sort key, because the
 * order somebody put them in is the order they want to read them in — so it is
 * preserved as-is. Blank and duplicate rows are dropped on the way through: a
 * spreadsheet accumulates empty rows just by being scrolled in.
 */
export function campaignsFromCells(rows: string[][]): Campaign[] {
  return normalizeCampaigns(
    rows.map((cells) => ({ name: cells[0] ?? '', destination: cells[1] ?? '' })),
  );
}
