-- The CPA rate card.
--
-- What each issuer pays for an approval, per card and per tier. It comes from
-- QuinStreet's "CPA Report", which has no API — it is exported by hand and
-- uploaded on /cpa, so this table is a snapshot rather than something edited a
-- row at a time.
--
-- One upload is one batch. Every upload writes a fresh batch_id and then
-- deletes the others, so the table normally holds exactly one rate card. It is
-- done in that order because PostgREST has no transaction: deleting first would
-- leave the page showing an empty rate card for as long as the insert took,
-- while inserting first means a reader sees either the old card or the new one.
--
-- Same access model as the rest of the schema: RLS on, no policies, revoked
-- from anon and authenticated. The server reads it under the service role, and
-- the page in front of it is behind the same sign-in as everything else.
create table public.cpa_rates (
  id uuid primary key default gen_random_uuid(),

  -- Which upload this row came in with. Every row of one upload shares it.
  batch_id uuid not null,
  uploaded_at timestamptz not null default now(),
  -- The admin who uploaded. Free text: it may name the env admin, which has no
  -- id, exactly as users.created_by does.
  uploaded_by text not null default '',
  -- The name of the file, so a wrong upload is recognisable in the UI.
  source text not null default '',
  -- The "Day of" line from the export: when QMP read these rates. Text rather
  -- than date because the export sometimes omits it, and "" is not a date.
  report_date text not null default '',

  placement text not null default '',
  issuer text not null default '',
  card text not null,
  -- "Tier 1" … "Tier 10", or '' when the card pays a single rate.
  tier text not null default '',

  -- Nullable on purpose, all three. The export writes "-" for "no value", which
  -- is not zero: a card at 0 has been switched off and is worth seeing, while a
  -- blank previous rate only means the card is new. Storing 0 for both would
  -- turn every new card into a 100% cut on the page.
  current numeric,
  previous numeric,
  -- The reported change as a fraction: 0.1 for 10%.
  change numeric,
  -- ISO day the current rate took effect, or '' when the export says "-".
  changed_on text not null default '',

  constraint cpa_rates_card_not_blank_check check (card <> '')
);

comment on table public.cpa_rates is
  'CPA rate card, uploaded whole from the QMP export. One batch_id per upload; the newest batch is the current card.';

-- Every read is "the newest batch", so the index is on what that costs.
create index cpa_rates_batch_idx on public.cpa_rates (uploaded_at desc, batch_id);

alter table public.cpa_rates enable row level security;
revoke all on public.cpa_rates from anon, authenticated;
