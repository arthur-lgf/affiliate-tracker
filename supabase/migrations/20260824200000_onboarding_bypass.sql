-- Letting somebody in without the paperwork.
--
-- Not every affiliate arrives through the front door. Somebody already known,
-- somebody who signed on paper last year, somebody who needs to see the
-- dashboard today and will file a W-9 on Friday: for all three the honest
-- answer is an admin taking responsibility, not a form standing in the way.
--
-- A third state rather than a shortcut through the other two. Marking somebody
-- approved to get them in would be recording a review that never happened, and
-- pre-ticking their steps would be recording signatures that do not exist. This
-- says what actually occurred: an admin waived the gate, and here is who and
-- when.

alter table public.users
  -- Null means the normal flow applies. A timestamp is both the flag and the
  -- record of when it was set, which is one column instead of two that can
  -- disagree.
  add column if not exists onboarding_bypassed_at timestamptz,
  -- The admin's username. Somebody was accountable for this.
  add column if not exists onboarding_bypassed_by text,
  -- Why. Optional, and worth having: "signed on paper, filed 2026-07" is the
  -- difference between a decision and a mystery a year from now.
  add column if not exists onboarding_bypass_note text;

-- The People page filters on it, and the queue count is drawn on every render.
create index if not exists users_onboarding_bypassed_idx
  on public.users (onboarding_bypassed_at)
  where onboarding_bypassed_at is not null;
