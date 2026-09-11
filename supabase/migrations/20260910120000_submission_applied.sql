-- ---------------------------------------------------------------------------
-- Applied: the step between a captured lead and an approval.
--
-- The QMP report counts applications as well as approvals, and until now the
-- sync threw away every row that had an application and no approval. A lead
-- the merchant has an application from now says so, as 'applied', instead of
-- sitting at pending with nothing to show it got that far. 'registered' stays
-- the stored word for approved; lib/status.ts explains why the word in the
-- column and the word on screen are allowed to differ.
--
-- card is the card, or cards, the report says the lead applied for, as QMP
-- names them and comma separated. Empty until a sync sees one, which is every
-- row written before today. Not null with a default so that lead capture,
-- which never names this column, keeps inserting exactly as it did.
--
-- Run this before the code that comes with it is deployed. Capture, the
-- leads lists and the admin toggle carry on as before on a database without
-- it, but the report sync sends the card with every lead it moves, and
-- PostgREST refuses a write that names a column the table does not have. So
-- until this has run, each sync still writes its approvals, then stops its
-- lead updates with one line saying the migrations are behind.
--
-- Run it before scripts/migrate-to-supabase.ts as well, which copies the card
-- and the applied status across.
--
-- Postgres can neither alter a check constraint's expression nor "add
-- constraint if not exists", so the status check is dropped and added back.
-- Both happen in one statement, so there is no moment in which the column is
-- unchecked, and the drop is "if exists" so a second run is harmless.
--
-- Nothing to grant or lock down: RLS and the revokes in the schema migration
-- are table-wide, so they cover a new column the way they cover the old ones.
--
-- Safe to run twice.
-- ---------------------------------------------------------------------------

alter table public.submissions
  add column if not exists card text not null default '',
  drop constraint if exists submissions_status_check,
  add constraint submissions_status_check
    check (status in ('pending', 'applied', 'registered'));

comment on column public.submissions.card is
  'The card or cards the QMP report says this lead applied for, comma separated. Empty until a sync sees one.';
