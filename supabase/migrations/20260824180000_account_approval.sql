-- Account approval: an affiliate finishes their paperwork, an admin reads it,
-- and only then is the account live.
--
-- Distinct from users.active, which already exists and means something else:
-- active is the switch that turns a working account off. Approval is the state
-- an account passes through once, on the way in. Conflating them would make
-- "suspended" and "never reviewed" the same value, and the difference between
-- those two is the entire question an admin is answering.

alter table public.users
  -- pending | approved | declined. Text with a check rather than an enum: a new
  -- state here should be one migration, not an ALTER TYPE and a redeploy.
  add column if not exists approval_status text not null default 'pending',

  -- When the required paperwork was last completed. This is what puts somebody
  -- in the queue, and it moves again if they correct something afterwards, so
  -- an admin can see they are looking at a resubmission.
  add column if not exists submitted_at timestamptz,

  add column if not exists reviewed_at timestamptz,
  -- The admin's username. A name, not an id: this is read by a person, and the
  -- account that made the decision may itself be deleted one day.
  add column if not exists reviewed_by text,
  -- Why. Shown to the affiliate on a decline, which is the whole point of
  -- having a decline rather than silence.
  add column if not exists review_note text,

  -- Set when the "you are approved" email is accepted by the provider. Kept
  -- apart from reviewed_at because an approval that could not be emailed is
  -- still an approval, and the gap between the two is a thing to be able to see.
  add column if not exists approval_emailed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_approval_status_check'
  ) then
    alter table public.users
      add constraint users_approval_status_check
      check (approval_status in ('pending', 'approved', 'declined'));
  end if;
end $$;

/*
 * Every account that already exists is approved, and this is the load-bearing
 * line of the migration.
 *
 * The column defaults to 'pending' because that is right for accounts made from
 * now on. Applied to the accounts already in the table it would lock out every
 * affiliate currently working — people who have been signing in for weeks would
 * arrive at a review screen for a review nobody asked for. Whatever the
 * approval flow is for, it is not for them.
 */
update public.users
set approval_status = 'approved',
    reviewed_at = coalesce(reviewed_at, now()),
    reviewed_by = coalesce(reviewed_by, 'existing account')
where approval_status = 'pending';

-- Finding the queue: a handful of rows out of a table that stays small, but the
-- admin list filters on this on every render.
create index if not exists users_approval_status_idx
  on public.users (approval_status);
