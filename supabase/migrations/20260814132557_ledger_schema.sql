-- Ledger: links, the leads they capture, the clicks they get, and what was paid.
--
-- Mirrors the four tabs the Google Sheet adapter reads, so the app's Store
-- interface is unchanged and either backend can serve it.
--
-- Access model, and the reason there are no policies below:
--
--   This app does not use Supabase Auth. It has one admin account of its own
--   (ADMIN_PASSWORD, a signed session cookie, checked in middleware), and every
--   query runs server-side under the service role. Nothing here is ever read
--   from a browser.
--
--   So RLS is enabled on all four tables and NO policy is created. With RLS on
--   and no policy, anon and authenticated can read nothing even if the Data API
--   is exposing the schema; service_role bypasses RLS and is the only way in.
--   The revokes below say the same thing a second way, at the grant level,
--   because "the table is unreachable" is worth being true twice.

-- ---------------------------------------------------------------------------
-- links
-- ---------------------------------------------------------------------------
-- Ids are text rather than uuid because the application mints them and has
-- always stored them as strings; keeping the type wide means a migrated row
-- keeps the id it already had, and a live /slug?usr= URL keeps working.
create table public.links (
  id text primary key,
  created_at timestamptz not null default now(),
  slug text not null,
  -- '' is the house row: traffic that arrived with no tracking key. Empty
  -- string rather than null so the unique constraint below actually bites
  -- (in Postgres every null is distinct, so nulls would let duplicates in).
  usr text not null default '',
  assignee text not null default '',
  assignee_email text not null default '',
  destination text not null,
  campaign text not null default '',
  headline text not null default '',
  subheadline text not null default '',
  cta_label text not null default '',
  require_phone boolean not null default false,
  pass_usr_param text not null default '',
  active boolean not null default true,
  notes text not null default '',

  -- Both adapters already refuse a second link for the same pair. Saying it
  -- here as well makes it true under concurrency, which an application-level
  -- "does it exist yet" check can never be.
  constraint links_slug_usr_key unique (slug, usr)
);

comment on table public.links is 'Affiliate links. One row per (slug, usr); usr = '''' is the house row.';

-- Every visit and every submission resolves a link by slug first.
create index links_slug_idx on public.links (slug);

-- ---------------------------------------------------------------------------
-- submissions (leads)
-- ---------------------------------------------------------------------------
-- The id is deliberately NOT generated here. It is minted by the app before
-- the row exists, because it travels out in the destination URL as var3 and is
-- what ties a merchant's approval back to this person. A database default
-- would produce a different value from the one already in the URL.
create table public.submissions (
  id text primary key,
  created_at timestamptz not null default now(),
  slug text not null,
  usr text not null default '',
  assignee text not null default '',
  campaign text not null default '',
  full_name text not null default '',
  email text not null default '',
  phone text not null default '',
  -- The exact URL this lead was forwarded to, var3 included.
  destination text not null default '',
  referrer text not null default '',
  user_agent text not null default '',
  ip text not null default '',
  status text not null default 'pending',

  constraint submissions_status_check check (status in ('pending', 'registered'))
);

comment on table public.submissions is 'Captured leads. id is the reference sent to the merchant as var3.';

create index submissions_created_at_idx on public.submissions (created_at desc);
create index submissions_slug_usr_idx on public.submissions (slug, usr);

-- ---------------------------------------------------------------------------
-- visits
-- ---------------------------------------------------------------------------
create table public.visits (
  id text primary key,
  created_at timestamptz not null default now(),
  slug text not null,
  usr text not null default '',
  referrer text not null default '',
  user_agent text not null default '',
  ip text not null default ''
);

comment on table public.visits is 'One row per landing page view, before any redirect.';

-- This is the table that grows fastest and is always read by date window.
create index visits_created_at_idx on public.visits (created_at desc);
create index visits_slug_usr_idx on public.visits (slug, usr);

-- ---------------------------------------------------------------------------
-- conversions (approvals)
-- ---------------------------------------------------------------------------
-- The only table given a generated key. The sheet and JSON adapters address a
-- conversion by its position plus a hash of its contents, because the tab has
-- no id column to type into; here a real key exists, so deleting the wrong row
-- stops being possible.
create table public.conversions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- The day the application was approved. A date, not a timestamp: it is the
  -- bucket every figure on the dashboard is grouped by, and a timezone would
  -- move approvals between days depending on where they were read.
  approved_on date not null,
  slug text not null,
  usr text not null default '',
  -- numeric, never float. This is money.
  amount numeric(12, 2) not null default 0,
  notes text not null default '',

  constraint conversions_amount_check check (amount >= 0)
);

comment on table public.conversions is 'Approved applications and what they paid.';

create index conversions_approved_on_idx on public.conversions (approved_on desc);
create index conversions_slug_usr_idx on public.conversions (slug, usr);

-- ---------------------------------------------------------------------------
-- Lock the doors
-- ---------------------------------------------------------------------------
-- RLS on with no policies: anon and authenticated match nothing, so they read
-- and write nothing. service_role bypasses RLS and is what the server uses.
alter table public.links enable row level security;
alter table public.submissions enable row level security;
alter table public.visits enable row level security;
alter table public.conversions enable row level security;

-- Belt and braces: even the ability to attempt a query is taken away, so a
-- future policy added by accident cannot quietly open a table to the browser.
-- No sequence revoke: an identity column's sequence is internal to the table
-- and needs no grant of its own, so naming it here would only risk failing the
-- migration over a privilege nobody was using.
revoke all on public.links from anon, authenticated;
revoke all on public.submissions from anon, authenticated;
revoke all on public.visits from anon, authenticated;
revoke all on public.conversions from anon, authenticated;
