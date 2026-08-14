-- Sign-in accounts.
--
-- Until now the app had exactly one account, held in ADMIN_USER/ADMIN_PASSWORD.
-- That account still works and is deliberately NOT stored here: it is the
-- break-glass login that can still get in when this table is empty, wrong, or
-- unreachable, which is also how the first admin row gets created.
--
-- Two roles:
--   admin      sees everything and is the only role that may write.
--   affiliate  is bound to one tracking key and sees only that key's traffic.
--
-- Same access model as the rest of the schema: RLS on, no policies, revoked
-- from anon and authenticated. Password hashes are only ever read by the
-- server under the service role.
create table public.users (
  id text primary key,
  created_at timestamptz not null default now(),

  -- Lowercased by the application before it ever reaches here. The check makes
  -- that an invariant of the table rather than a habit of the caller, so
  -- "Arthur" and "arthur" can never become two accounts.
  username text not null,
  -- PBKDF2-HMAC-SHA256, as "pbkdf2-sha256$<iterations>$<salt>$<hash>". The
  -- iteration count travels with the hash so it can be raised later without
  -- invalidating anyone who has not signed in since.
  password_hash text not null,

  role text not null default 'affiliate',

  -- The tracking key this account is scoped to. Empty for admins, who are
  -- scoped to nothing because they see everything.
  usr text not null default '',

  full_name text not null default '',
  email text not null default '',

  -- Disabling beats deleting: the leads and approvals already recorded against
  -- this person's key stay attributable to a real account.
  active boolean not null default true,

  -- Every session token carries the password_changed_at it was minted under.
  -- Moving this forward invalidates every cookie issued before it, which is
  -- what makes "reset their password" actually end their sessions.
  password_changed_at timestamptz not null default now(),
  last_login_at timestamptz,

  -- Who created the row. Free text: it may name the env admin, which has no id.
  created_by text not null default '',

  constraint users_username_lower_check check (username = lower(username)),
  constraint users_username_shape_check check (username ~ '^[a-z0-9][a-z0-9._-]{1,31}$'),
  constraint users_role_check check (role in ('admin', 'affiliate')),
  -- An affiliate with no key would be scoped to nothing, and "scoped to
  -- nothing" is one buggy filter away from "scoped to everything".
  constraint users_affiliate_needs_usr_check check (role = 'admin' or usr <> ''),
  constraint users_usr_shape_check check (usr = '' or usr ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table public.users is 'Sign-in accounts. The env ADMIN_USER account is deliberately not stored here.';

create unique index users_username_key on public.users (username);

-- Two accounts sharing a tracking key would each see the other's leads and
-- earnings, so the pairing is one-to-one and the database says so.
create unique index users_usr_key on public.users (usr) where usr <> '';

create index users_role_idx on public.users (role);

alter table public.users enable row level security;
revoke all on public.users from anon, authenticated;
