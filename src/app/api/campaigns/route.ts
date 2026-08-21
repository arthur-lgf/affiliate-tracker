import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { normalizeCampaigns } from '@/lib/campaigns';
import { getStore, statusForError } from '@/lib/store';
import { requireApiAdmin } from '@/lib/api-auth';
import { campaignsInputSchema, fieldErrors } from '@/lib/validate';

/**
 * Replace the campaign list.
 *
 * The whole list, not one row: the settings page edits it as a list and hands
 * it back as one, which is what the store underneath stores (see the campaigns
 * migration). The consequence is worth stating plainly — two admins saving at
 * the same time means the later save wins entire rather than the two merging.
 * For a list of a couple of dozen offers maintained by a couple of people, that
 * is the right trade against a per-row API and the reordering it would need.
 *
 * Admin only. A campaign decides where a link sends people, so anyone who can
 * edit one can redirect the team's traffic.
 */

export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  const gate = await requireApiAdmin(request, 'Only an admin can change the campaigns.');
  if ('response' in gate) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  let input;
  try {
    input = campaignsInputSchema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Please check the highlighted fields.', fields: fieldErrors(error) },
        { status: 422 },
      );
    }
    throw error;
  }

  /*
   * Normalised again here, not only in the browser. The form drops blank rows
   * and refuses a duplicate name before it posts, but the route is reachable
   * without the form, and a duplicate name would make which URL a link gets
   * depend on the order the rows happen to be in.
   */
  const campaigns = normalizeCampaigns(input.campaigns);

  try {
    await getStore().writeCampaigns(campaigns);
    return NextResponse.json({ campaigns });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save the campaigns' },
      { status: statusForError(error) },
    );
  }
}
