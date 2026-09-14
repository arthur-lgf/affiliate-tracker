-- ---------------------------------------------------------------------------
-- Payout requests: an affiliate's own choice of which approved cards to be
-- paid for, once each one is 45 days old.
--
-- Replaces public.payouts, which counted 45-day cycles from the day somebody
-- signed. Every card now runs on its own clock, from the day it was approved,
-- and nothing is owed until the affiliate asks for it.
--
-- Two tables. The header (public.payout_requests) is one payment record, the
-- same shape public.payouts used to be: what was sent, the receipt, the
-- affiliate's confirmation. The items (public.payout_request_items) are which
-- approvals it covers and what each one was worth at the moment it was
-- requested. A snapshot, because an approval already paid against must never
-- reprice itself later.
--
-- The 45 below is a literal on purpose, and it is the same number as
-- PAYOUT_DAYS in lib/payout.ts. scripts/payout-request-store-checks.ts reads
-- this file and fails if the two ever disagree.
--
-- Same access model as every other table here: RLS on, no policies, revoked
-- from anon and authenticated. Only the server's service role reads or writes.
--
-- Safe to run twice.
-- ---------------------------------------------------------------------------

create table if not exists public.payout_requests (
  id bigint generated always as identity primary key,

  -- Refuse, not cascade: deleting an affiliate account must not silently
  -- erase the record that they were ever paid. "No action" rather than
  -- "restrict": both refuse the delete (this check is not deferrable), but
  -- restrict reports SQLSTATE 23001 on Postgres 15 and later, while no action
  -- reports the ordinary foreign key violation, 23503. Named, because
  -- lib/users.ts matches on this name to turn the refusal into a sentence.
  user_id text not null
    constraint payout_requests_user_id_fkey references public.users (id) on delete no action,

  status text not null default 'requested',
  requested_at timestamptz not null default now(),
  -- Who pressed the button. The affiliate's username, or
  -- "username (via Admin Name)" when an admin did it in Client View.
  requested_by text not null default '',

  -- The sum of its items' amounts at the moment it was created. Fixed then,
  -- and never recomputed.
  total_amount numeric(12, 2) not null,

  -- What was actually sent. Nullable rather than defaulted to zero, which
  -- would read as "we paid them nothing". May differ from total_amount if an
  -- admin sent a different figure; the page shows both when they disagree.
  amount numeric(12, 2),
  paid_at timestamptz,
  paid_by text not null default '',
  reference text not null default '',
  note text not null default '',

  -- The receipt, as a data URL, the way public.payouts held it. Never selected
  -- by a list query: see lib/payout-request-store.ts, where the columns are
  -- spelled out so a page cannot drag a few hundred kilobytes per row.
  proof_name text not null default '',
  proof_type text not null default '',
  proof_data text not null default '',
  proof_at timestamptz,
  proof_by text not null default '',

  confirmed_at timestamptz,
  confirmed_by text not null default '',

  cancelled_at timestamptz,
  cancelled_by text not null default '',

  updated_at timestamptz not null default now(),

  constraint payout_requests_status_check
    check (status in ('requested', 'paid', 'cancelled')),
  constraint payout_requests_total_check check (total_amount >= 0),
  -- A status and the timestamp that proves it travel together. The store's
  -- recordPayment and clearPayment each move both in one UPDATE, so these can
  -- only fail on a hand-edited row, which is exactly the row they are for.
  constraint payout_requests_paid_pair_check
    check ((status = 'paid') = (paid_at is not null)),
  constraint payout_requests_cancelled_pair_check
    check ((status = 'cancelled') = (cancelled_at is not null))
);

comment on table public.payout_requests is
  'One row per payment request an affiliate submitted: which cards they chose to be paid for, and what happened to the payment. Supersedes public.payouts, which counted 45 days from the day someone signed rather than from each approval.';

-- An affiliate's own list, newest first. Also what the users foreign key's
-- restrict check scans when an account is deleted.
create index if not exists payout_requests_user_idx
  on public.payout_requests (user_id, requested_at desc);

create index if not exists payout_requests_status_idx
  on public.payout_requests (status, requested_at);

alter table public.payout_requests enable row level security;
revoke all on public.payout_requests from anon, authenticated;

create table if not exists public.payout_request_items (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.payout_requests (id) on delete cascade,

  -- Nullable, and set null rather than restricted, on purpose. The
  -- block_delete_of_committed_conversion trigger below is what protects a
  -- LIVE item, so this key is free to let a RELEASED item's approval be
  -- deleted later without losing the item's own row: its snapshot amount and
  -- request membership survive, and only the card and customer labels for
  -- that one line fall back to the app's usual blank placeholder.
  conversion_id bigint references public.conversions (id) on delete set null,

  -- The affiliate's own share of this one approval, computed in TypeScript
  -- from the same commission history every other figure uses and handed to
  -- create_payout_request. Never computed in SQL, so there is one
  -- implementation of the commission history, not two that can disagree.
  amount numeric(12, 2) not null,

  -- Null while this item is committed to a live request (requested or paid).
  -- Set the moment its request is cancelled, which is what frees the card to
  -- be requested again.
  released_at timestamptz,

  constraint payout_request_items_amount_check check (amount >= 0),
  -- A live item always keeps its approval reference; only a released item's
  -- conversion_id may ever go null, and only because its approval was later
  -- deleted. This is also the second guard behind the trigger: a delete that
  -- slipped past it would try to null a live reference and fail here.
  constraint payout_request_items_live_conversion_check
    check (released_at is not null or conversion_id is not null)
);

comment on table public.payout_request_items is
  'Which approvals belong to which payout request, and what each was worth when it was requested.';

create index if not exists payout_request_items_request_idx
  on public.payout_request_items (request_id);

-- The index that stops the same approval riding two requests at once,
-- including two submits racing each other: only one row per conversion may
-- have released_at still null. The function below pre-checks this for a
-- friendly answer; this index is the actual guarantee.
create unique index if not exists payout_request_items_live_idx
  on public.payout_request_items (conversion_id)
  where released_at is null;

-- The partial index above cannot serve the "on delete set null" action, which
-- has to find released rows too. Without this, deleting any approval would
-- scan every item ever requested.
create index if not exists payout_request_items_conversion_idx
  on public.payout_request_items (conversion_id);

alter table public.payout_request_items enable row level security;
revoke all on public.payout_request_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Protect a LIVE approval from deletion, without permanently blocking a
-- RELEASED one. Plain "on delete restrict" on conversion_id cannot do this:
-- Postgres refuses the delete if ANY row references the id, live or released,
-- which would mean a card that was ever on a request (even one cancelled a
-- second later) could never be removed. This checks only for a live
-- reference, which is the thing that is actually unsafe to lose.
--
-- lib/store/supabase.ts turns LG007 into a 409 with the same sentence.
-- ---------------------------------------------------------------------------
create or replace function public.block_delete_of_committed_conversion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.payout_request_items
    where conversion_id = old.id and released_at is null
  ) then
    raise exception
      'This approval is part of a payout request and cannot be removed. Cancel the request first if it has not been paid.'
      using errcode = 'LG007';
  end if;
  -- A BEFORE DELETE trigger that returned null would skip the delete and
  -- report success. old lets it proceed.
  return old;
end;
$$;

drop trigger if exists block_delete_of_committed_conversion on public.conversions;
create trigger block_delete_of_committed_conversion
  before delete on public.conversions
  for each row
  execute function public.block_delete_of_committed_conversion();

revoke all on function public.block_delete_of_committed_conversion() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Creating a request: one transaction, or none of it happens.
--
-- p_items is a jsonb array of {"conversion_id": <bigint>, "amount": <numeric>}.
-- The amount is computed by the caller and trusted for arithmetic only. This
-- function re-derives ownership and eligibility from public.conversions (and
-- that p_user_id really is the account bound to p_usr) before it will record
-- anything, and it is the unique index above, not these pre-checks, that is
-- the actual guard against two concurrent submits landing on the same card.
--
-- Errors, which lib/payout-request-store.ts maps to its own classes:
--   LG001  nothing chosen, or an item it cannot read      (validation, 422)
--   LG002  the same card twice                            (validation, 422)
--   LG003  not theirs, or not 45 days old yet             (validation, 422)
--   LG004  already on a live request                      (conflict, 409)
-- ---------------------------------------------------------------------------
create or replace function public.create_payout_request(
  p_user_id text,
  p_usr text,
  p_requested_by text,
  p_items jsonb
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_request_id bigint;
  v_submitted int;
  v_distinct int;
  v_malformed int;
  v_owned int;
  v_committed int;
  v_total numeric(12, 2);
  -- UTC, to match dayOf() everywhere else in this app: a day key is never
  -- re-timezoned. Approved on D is requestable on D + 45 and every day after,
  -- which is approved_on <= today - 45.
  v_cutoff date := (now() at time zone 'utc')::date - 45;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one approved card.' using errcode = 'LG001';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) as e(value)
    where jsonb_typeof(e.value) <> 'object'
  ) then
    raise exception 'Those cards could not be read. Reload the page and choose them again.'
      using errcode = 'LG001';
  end if;

  select
    count(*),
    count(distinct x.conversion_id),
    count(*) filter (where x.conversion_id is null or x.amount is null or x.amount < 0)
    into v_submitted, v_distinct, v_malformed
  from jsonb_to_recordset(p_items) as x(conversion_id bigint, amount numeric);

  -- Before the duplicate check, because a missing id is not counted by
  -- count(distinct) and would otherwise read as "selected twice".
  if v_malformed > 0 then
    raise exception 'Those cards could not be read. Reload the page and choose them again.'
      using errcode = 'LG001';
  end if;

  if v_submitted <> v_distinct then
    raise exception 'The same card was selected twice.' using errcode = 'LG002';
  end if;

  -- Hold the chosen approvals still until this commits. A delete that starts
  -- now waits for this transaction, and then its trigger sees the committed
  -- items and refuses with LG007, rather than slipping between these checks
  -- and the insert below.
  perform 1
  from public.conversions c
  join jsonb_to_recordset(p_items) as x(conversion_id bigint, amount numeric)
    on c.id = x.conversion_id
  for key share of c;

  -- Ownership and eligibility, read fresh from the tables that actually know
  -- them. A house approval (usr = '') can never pass: it belongs to no
  -- account. And the account named by p_user_id must be the one bound to
  -- p_usr, so a caller that mixed up two people cannot file one person's
  -- cards under the other's name.
  select count(*) into v_owned
  from jsonb_to_recordset(p_items) as x(conversion_id bigint, amount numeric)
  join public.conversions c on c.id = x.conversion_id
  join public.users u on u.id = p_user_id and u.usr = c.usr
  where c.usr = p_usr and c.usr <> '' and c.approved_on <= v_cutoff;

  if v_owned <> v_submitted then
    raise exception 'One of those approvals is not yours, or is not 45 days old yet.'
      using errcode = 'LG003';
  end if;

  select count(*) into v_committed
  from jsonb_to_recordset(p_items) as x(conversion_id bigint, amount numeric)
  join public.payout_request_items pri
    on pri.conversion_id = x.conversion_id and pri.released_at is null;

  if v_committed > 0 then
    raise exception 'One of those approvals is already on a request.' using errcode = 'LG004';
  end if;

  -- Each amount is rounded to the cent once, here, and the total is the sum
  -- of those rounded amounts. Letting the columns round the items and the
  -- total separately could leave a request a cent off its own lines.
  select coalesce(sum(round(x.amount, 2)), 0)::numeric(12, 2) into v_total
  from jsonb_to_recordset(p_items) as x(conversion_id bigint, amount numeric);

  insert into public.payout_requests (user_id, status, requested_at, requested_by, total_amount)
  values (p_user_id, 'requested', now(), coalesce(p_requested_by, ''), v_total)
  returning id into v_request_id;

  insert into public.payout_request_items (request_id, conversion_id, amount)
  select v_request_id, x.conversion_id, round(x.amount, 2)
  from jsonb_to_recordset(p_items) as x(conversion_id bigint, amount numeric);

  return v_request_id;
exception
  -- The race the pre-check above cannot see: two submits that both passed it
  -- before either committed. Whichever reaches the unique index second lands
  -- here instead, and everything this call wrote is rolled back with it.
  when unique_violation then
    raise exception 'One of those approvals is already on a request.' using errcode = 'LG004';
end;
$$;

comment on function public.create_payout_request(text, text, text, jsonb) is
  'Atomically create a payout request and lock its items. Called by the service role only.';

revoke all on function public.create_payout_request(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_payout_request(text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Cancelling a request: the status and the release of its cards together.
--
--   LG005  no such request                                (not found, 404)
--   LG006  not in the requested state                     (conflict, 409)
--
-- A paid request cannot be cancelled directly. Clearing the payment first is
-- the same "undo, then decide" sequence the admin page already models.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_payout_request(p_request_id bigint, p_cancelled_by text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  -- For update, so a payment being recorded at the same moment either lands
  -- first (and this sees paid) or waits and then matches nothing.
  select status into v_status from public.payout_requests where id = p_request_id for update;
  if v_status is null then
    raise exception 'That request no longer exists.' using errcode = 'LG005';
  end if;
  if v_status <> 'requested' then
    raise exception 'Only an unpaid request can be cancelled.' using errcode = 'LG006';
  end if;

  update public.payout_requests
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = coalesce(p_cancelled_by, ''),
        updated_at = now()
    where id = p_request_id;

  update public.payout_request_items
    set released_at = now()
    where request_id = p_request_id and released_at is null;
end;
$$;

comment on function public.cancel_payout_request(bigint, text) is
  'Cancel an unpaid payout request and free its cards to be requested again. Called by the service role only.';

revoke all on function public.cancel_payout_request(bigint, text) from public, anon, authenticated;
grant execute on function public.cancel_payout_request(bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- public.payouts is superseded and has zero rows in production. Dropped, but
-- only if it is still actually empty.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'payouts'
  ) then
    if exists (select 1 from public.payouts limit 1) then
      raise exception
        'public.payouts is not empty. Refusing to drop it automatically; review its rows before dropping it by hand.';
    end if;
    drop table public.payouts;
  end if;
end $$;
