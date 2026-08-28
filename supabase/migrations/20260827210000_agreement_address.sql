-- ---------------------------------------------------------------------------
-- The affiliate's address, in parts.
--
-- The agreement asked for one free-text box, which let a state be typed as
-- "Tex." and a ZIP be left off entirely, on a document that then went and
-- printed it. The form now asks for street, city, state and ZIP separately,
-- and these are where the answers go.
--
-- affiliate_address stays exactly where it is and keeps its old job: it is the
-- one line the signed document prints, composed from the parts on the way in.
-- Agreements signed before today have that line and nothing else, which is why
-- every column here defaults to empty rather than being required. Reading them
-- back is lib/address addressFrom, which falls back to parsing the line.
--
-- Safe to run twice.
-- ---------------------------------------------------------------------------

alter table public.affiliate_agreements
  add column if not exists affiliate_address_line1 text not null default '',
  -- Apartment, suite, unit. Empty far more often than not.
  add column if not exists affiliate_address_line2 text not null default '',
  add column if not exists affiliate_city text not null default '',
  -- A two-letter code, checked against lib/address US_STATES before it is
  -- written. Not constrained here: the list includes the territories and would
  -- have to be migrated every time the application's copy of it moved.
  add column if not exists affiliate_state text not null default '',
  add column if not exists affiliate_postal_code text not null default '';

comment on column public.affiliate_agreements.affiliate_address is
  'The address as the signed document prints it, composed from the parts. Rows signed before the parts existed have only this.';
