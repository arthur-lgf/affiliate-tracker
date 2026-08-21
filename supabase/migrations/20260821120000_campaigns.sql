-- The campaigns a link can point at.
--
-- A campaign is a name and the URL it sends people to, e.g. "Best Cards" ->
-- https://www.cardratings.com/bestcards?src=714025. The link form reads them to
-- fill in a new link's destination, writing the person's tracking key into it
-- as var2 on the way, which is the column QuinStreet reports back and therefore
-- the column an approval is matched on.
--
-- Edited as a list rather than a row at a time: the settings page hands back
-- the whole list and this table is replaced with it. So, like cpa_rates, one
-- save is one batch — a fresh batch_id is inserted and the others are deleted,
-- in that order, because PostgREST has no transaction and deleting first would
-- leave the link form with an empty campaign picker for as long as the insert
-- took.
--
-- Two consequences worth knowing. Two admins saving at once means the later
-- save wins whole, not merged. And a campaign has no id that survives a save,
-- which is why a link stores the campaign *name* rather than a reference.
--
-- Same access model as the rest of the schema: RLS on, no policies, revoked
-- from anon and authenticated. The server reads it under the service role.
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),

  -- Which save this row came in with. Every row of one save shares it.
  batch_id uuid not null,
  saved_at timestamptz not null default now(),

  -- Where this campaign sits in the list. The order is the only arrangement
  -- there is: no alphabetical sort, because the order somebody put them in is
  -- the order they want to read them in.
  position integer not null default 0,

  -- What the campaign is called. This is the value stored on a link, so it is
  -- the key the link form looks a destination up by.
  name text not null,

  -- Where it sends people, before the tracking key is written in. Allowed to be
  -- blank: a campaign can exist as a category with no URL behind it yet, which
  -- is exactly what every campaign was before this table.
  destination text not null default '',

  constraint campaigns_name_not_blank_check check (name <> '')
);

comment on table public.campaigns is
  'Campaigns and their destination URLs. One batch_id per save; the newest batch is the live list.';

-- Every read is "the newest batch, in order", so the index is on what that costs.
create index campaigns_batch_idx on public.campaigns (saved_at desc, batch_id, position);

alter table public.campaigns enable row level security;
revoke all on public.campaigns from anon, authenticated;
