-- ---------------------------------------------------------------------------
-- Payments made against a payout cycle.
--
-- The cycles themselves are not in here, and that is the point. Everybody is
-- paid 45 days from the day they signed, so their schedule is arithmetic on one
-- date the database already holds: affiliate_agreements.signed_at, or for an
-- account an admin waved through, users.created_at. Storing the windows as rows
-- would mean a job that has to run to open the next one, a backfill whenever
-- somebody signs late, and two sources of truth for a payday. See lib/payout.
--
-- What cannot be computed is what a person did: paid it, attached a receipt,
-- confirmed it arrived. That is what this table holds, one row per payment, and
-- a cycle nobody has touched has no row at all.
--
-- Safe to run twice.
-- ---------------------------------------------------------------------------

create table if not exists public.payouts (
  user_id text not null references public.users (id) on delete cascade,

  -- The first day of the cycle, which names it. Derived from the anchor rather
  -- than allocated, so the same cycle is the same key to every reader.
  period_start date not null,

  -- Payday, and the first day of the next cycle. Stored beside the start so a
  -- row can be read and understood without recomputing the schedule around it.
  period_end date not null,

  -- What was actually sent, as it stood when it was recorded.
  --
  -- Not the same thing as what the cycle comes to today, and deliberately kept
  -- apart from it: an approval entered late lands in a cycle already paid, and
  -- then the honest answer to "what did we pay" is this number, while the newer
  -- total is a difference for somebody to settle. The page shows both when they
  -- disagree rather than quietly moving on to the larger one.
  amount numeric(12, 2),

  paid_at timestamptz,
  paid_by text not null default '',
  -- The bank's reference for the transfer, when there is one. Free text: every
  -- provider names this differently and none of them is worth a column.
  reference text not null default '',
  note text not null default '',

  -- The receipt, as a data URL, the same way a signature is stored two tables
  -- over. It is a few hundred kilobytes, it is worthless without the row beside
  -- it, and a blob store would be one more thing that can be out of step with
  -- this one. Never selected by the list queries: see lib/payout-store, where
  -- the columns are spelled out so a page cannot drag a megabyte per row.
  proof_name text not null default '',
  proof_type text not null default '',
  proof_data text not null default '',
  proof_at timestamptz,
  proof_by text not null default '',

  -- When the affiliate said the money arrived. Their half of the record, and
  -- the only thing on this row they can write.
  confirmed_at timestamptz,

  updated_at timestamptz not null default now(),

  primary key (user_id, period_start)
);

comment on table public.payouts is
  'One row per payment made against a 45-day payout cycle. The cycles are computed from the signing date, not stored; a cycle nobody has acted on has no row.';

-- A row that claims to be a cycle has to be shaped like one: forward, and not
-- zero length. A start after its own end is a typo that would otherwise sit in
-- the table looking like data.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payouts_period_forward') then
    alter table public.payouts
      add constraint payouts_period_forward check (period_end > period_start);
  end if;
end $$;

-- Read and written by the service role only, like every other table here: these
-- rows say what each person was paid.
alter table public.payouts enable row level security;
revoke all on public.payouts from anon, authenticated;

-- The admin page reads every unpaid cycle across everybody on each render.
-- A small table, but this is the one query it makes.
create index if not exists payouts_unpaid_idx
  on public.payouts (period_end)
  where paid_at is null;
