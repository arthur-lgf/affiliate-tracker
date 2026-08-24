-- Onboarding: what a new affiliate has to hand over before they can work.
--
-- Four steps, in order: their details and a password of their own, the signed
-- affiliate agreement, a signed IRS Form W-9, and where to send the money.
-- The first three are required to enter the app at all — §2 of the agreement
-- says no compensation is owed before a signed W-9 is on file, so letting
-- somebody earn without one only creates a payment that cannot be made. Bank
-- details are nagged rather than gated: they can be collected any time before
-- the first Net-30 payment falls due.
--
-- Same access model as the rest of the schema: RLS on, no policies, revoked
-- from anon and authenticated. Nothing here is ever read by anything but the
-- server under the service role, which matters more here than anywhere else in
-- this database: two of these columns hold a Social Security number and a bank
-- account number.

-- ---------------------------------------------------------------------------
-- Step 1 lives on the account itself.
--
-- full_name and email are already columns on users and are deliberately NOT
-- duplicated here: the onboarding form writes back to them. A second copy of
-- somebody's email is a second copy that can go stale, and the People list
-- reads the first one.
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists position text not null default '',
  add column if not exists mobile text not null default '',
  -- Null until they have filled in their details AND set a password of their
  -- own. An explicit marker rather than an inference from the four fields
  -- being non-empty, because "did they choose this password or did an admin
  -- hand it to them" is not visible in any of them. password_changed_at moves
  -- on an admin reset too, so it cannot answer this question either.
  add column if not exists profile_completed_at timestamptz;

comment on column public.users.profile_completed_at is
  'When the affiliate finished step 1 of onboarding: their details plus a password they chose themselves.';

-- ---------------------------------------------------------------------------
-- Step 2: the affiliate agreement.
-- ---------------------------------------------------------------------------
create table if not exists public.affiliate_agreements (
  -- One agreement per account, so the account id is the key. Re-signing
  -- replaces the row; the version column below is what says which text was
  -- agreed to, and a changed version is what would force a re-sign.
  user_id text primary key references public.users (id) on delete cascade,

  signed_at timestamptz not null default now(),

  -- Typed into the agreement rather than read from the account. They are the
  -- same values nine times out of ten, but this is the copy that was in front
  -- of them when they signed, and that is the copy a dispute is about.
  affiliate_name text not null,
  affiliate_email text not null,
  affiliate_address text not null,
  effective_date date not null,

  -- The drawn signature, as a PNG data URL. Stored whole rather than as a
  -- file reference: it is a few tens of kilobytes, it is worthless without the
  -- row beside it, and a blob store would be one more thing that can be out of
  -- sync with this table.
  signature_png text not null,

  -- What makes this hold up. ESIGN and UETA both turn on being able to show
  -- who signed, when, and that they meant to — so the affirmation, the clock,
  -- the address it came from and the browser it came from are all kept.
  affirmed boolean not null default false,
  signed_ip text not null default '',
  signed_user_agent text not null default '',

  -- Which text they agreed to. When the agreement is revised this changes, and
  -- every row still says which wording it was signed under.
  agreement_version text not null default '2026-08',

  constraint agreements_signature_present check (signature_png <> ''),
  constraint agreements_affirmed check (affirmed = true)
);

comment on table public.affiliate_agreements is
  'Signed affiliate agreements. One row per account; re-signing replaces it.';

-- ---------------------------------------------------------------------------
-- Step 3: IRS Form W-9.
--
-- The single most sensitive table in this database. The taxpayer number is
-- encrypted by the application before it arrives here (AES-256-GCM, key in
-- the environment), so the column holds ciphertext and a database dump on its
-- own does not hand over anyone's SSN. The last four digits are stored beside
-- it in the clear on purpose: every screen that lists these forms wants to
-- show •••-••-1234, and decrypting a whole page of numbers just to throw away
-- all but four digits would mean the plaintext existing in memory constantly
-- for no reason.
-- ---------------------------------------------------------------------------
create table if not exists public.w9_forms (
  user_id text primary key references public.users (id) on delete cascade,

  signed_at timestamptz not null default now(),

  -- Line 1 is required by the form itself; line 2 is the business name and is
  -- genuinely optional.
  line1_name text not null,
  line2_business text not null default '',

  -- Line 3a. One of seven, and two of them carry something extra: the LLC box
  -- takes a tax-classification letter, and "Other" takes the wording that goes
  -- on the rule beside it.
  classification text not null,
  llc_code text not null default '',
  other_text text not null default '',

  -- Line 3b, which only means anything for a partnership, trust/estate, or an
  -- LLC taxed as a partnership.
  foreign_partners boolean not null default false,

  -- Line 4. Codes, not amounts, and both are optional.
  exempt_payee_code text not null default '',
  fatca_code text not null default '',

  -- Lines 5, 6 and 7.
  address text not null,
  city_state_zip text not null,
  account_numbers text not null default '',

  -- Part I. An SSN or an EIN, never both — the form says "or" and the
  -- constraint says it too.
  tin_type text not null,
  tin_encrypted text not null,
  tin_last4 text not null default '',

  -- Part II.
  signature_png text not null,
  certified boolean not null default false,
  signed_ip text not null default '',
  signed_user_agent text not null default '',

  -- Which revision of the form was rendered. The IRS reissues W-9 and the
  -- certification wording is what a substitute form has to reproduce exactly,
  -- so a row that does not say which wording it used is a row nobody can
  -- vouch for later.
  form_revision text not null default 'Rev. March 2024',

  constraint w9_classification_check check (
    classification in (
      'individual',
      'c_corp',
      's_corp',
      'partnership',
      'trust_estate',
      'llc',
      'other'
    )
  ),
  -- The LLC box is the only one with a second letter, and it must have one.
  constraint w9_llc_code_check check (
    (classification = 'llc' and llc_code in ('C', 'S', 'P'))
    or (classification <> 'llc' and llc_code = '')
  ),
  constraint w9_tin_type_check check (tin_type in ('ssn', 'ein')),
  constraint w9_tin_present check (tin_encrypted <> ''),
  constraint w9_signature_present check (signature_png <> ''),
  -- Part II is a certification under penalties of perjury. A row without it is
  -- not a W-9, it is a draft, and drafts do not belong in this table.
  constraint w9_certified check (certified = true)
);

comment on table public.w9_forms is
  'Signed W-9s. tin_encrypted is AES-256-GCM ciphertext; the plaintext SSN or EIN is never written here.';

-- ---------------------------------------------------------------------------
-- Step 4: where the money goes.
--
-- Same treatment as the taxpayer number, for the same reason: an account
-- number and a routing path is enough to attempt a debit.
-- ---------------------------------------------------------------------------
create table if not exists public.bank_details (
  user_id text primary key references public.users (id) on delete cascade,

  saved_at timestamptz not null default now(),

  account_name text not null,
  bank_name text not null,
  account_number_encrypted text not null,
  account_number_last4 text not null default '',

  constraint bank_account_present check (account_number_encrypted <> '')
);

comment on table public.bank_details is
  'ACH destinations. account_number_encrypted is AES-256-GCM ciphertext.';

-- ---------------------------------------------------------------------------
-- Locked down exactly like every other table here.
-- ---------------------------------------------------------------------------
alter table public.affiliate_agreements enable row level security;
alter table public.w9_forms enable row level security;
alter table public.bank_details enable row level security;

revoke all on public.affiliate_agreements from anon, authenticated;
revoke all on public.w9_forms from anon, authenticated;
revoke all on public.bank_details from anon, authenticated;
