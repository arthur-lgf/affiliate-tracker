-- ---------------------------------------------------------------------------
-- Shared settings: the commission share, and the rate-card floor.
--
-- Two values today, and deliberately not two columns. The commission share is
-- not a number: it is a dated history of rates, because changing what an
-- affiliate keeps must not restate what has already been approved and paid.
-- That is a nested value, and a column per setting would mean a migration every
-- time the shape of one of them moved.
--
-- One row, keyed by name. A second set of settings, if there is ever one, is a
-- second key rather than a second table.
--
-- Written to be run again. The table already exists on the live project, so a
-- migration that opens with a bare create is one that fails everywhere it has
-- already been applied — and this same file still has to bring an empty
-- database up. Every statement below either creates what is missing or leaves
-- what is there alone, and the seed at the end never overwrites a rate that
-- somebody has actually set.
-- ---------------------------------------------------------------------------

create table if not exists public.settings (
  -- 'ledger' today. Named rather than numbered so the row says what it is.
  key text primary key,

  -- The whole settings object, as the application writes it. See lib/settings:
  -- { shares: [{ from, rate }], cpaFloor, updatedAt, updatedBy }.
  value jsonb not null default '{}'::jsonb,

  -- Who last changed it and when. Also inside the blob, and repeated here so
  -- that "who put the commission at 60%" is answerable with a plain select
  -- rather than by picking through json.
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

-- A database that already has the table gets whichever of these it is missing,
-- rather than an error on the create above and nothing else running. On the
-- database this was first written for all three are already present and every
-- line here is a no-op, which is the point.
alter table public.settings
  add column if not exists value jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by text not null default '';

comment on table public.settings is
  'Shared settings, one row per key. The commission share is a dated history so that changing it never restates an approval already banked.';

-- Read and written by the service role only, like every other table here: the
-- commission percentage decides what the whole team is paid. Both statements
-- restate a position rather than change one, so running them twice costs
-- nothing.
alter table public.settings enable row level security;
revoke all on public.settings from anon, authenticated;

-- The starting point, so a deployment that has never opened the settings page
-- still has a row rather than an absence. Half from the beginning of time,
-- which is what the application has always paid, and no floor on the rate card.
--
-- do nothing, emphatically: on a database where somebody has already moved the
-- commission, this line must not put it back to half.
insert into public.settings (key, value, updated_by)
values (
  'ledger',
  '{"shares": [{"from": "", "rate": 0.5}], "cpaFloor": null, "updatedAt": "", "updatedBy": ""}'::jsonb,
  ''
)
on conflict (key) do nothing;

-- A row that predates the rate history: it exists, so the insert above skipped
-- it, but it has no shares to read. It gets the opening rate and nothing else.
-- Defaults on the left of the merge and the live value on the right, so any key
-- already set wins over the default that shares its name.
update public.settings
set value = '{"shares": [{"from": "", "rate": 0.5}], "cpaFloor": null, "updatedAt": "", "updatedBy": ""}'::jsonb || value
where key = 'ledger'
  and value -> 'shares' is null;
