/**
 * Reading and writing what an affiliate hands over on their way in.
 *
 * Sits beside lib/users.ts rather than inside the Store interface, for the same
 * reason accounts do: these rows include a password, a Social Security number
 * and a bank account number, and a Google Sheet is the wrong place for any of
 * the three. Supabase or nothing.
 *
 * The two sensitive numbers are sealed by lib/secret-box.ts before they get
 * here and are only ever unsealed by the two `reveal` functions at the bottom,
 * which exist so that "show me the SSN" is a specific, deliberate, greppable
 * act rather than a side effect of listing a table.
 */

import { hashPassword } from './password';
import { digitsOf, last4 } from './mask';
import { NOTHING_DONE, type OnboardingState } from './onboarding';
import { seal, open } from './secret-box';
import { StoreConfigError } from './store/errors';
import { getSupabaseClient, isSupabaseConfigured } from './store/supabase';

export function onboardingEnabled(): boolean {
  return isSupabaseConfigured();
}

function requireStore(): void {
  if (!onboardingEnabled()) {
    throw new StoreConfigError(
      'Onboarding needs a database. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then reload.',
    );
  }
}

type PostgrestErrorish = { code?: string; message?: string; details?: string } | null;

function fail(context: string, error: PostgrestErrorish): never {
  const code = error?.code ?? '';
  const message = error?.message ?? 'unknown error';
  if (code === '42P01') {
    throw new StoreConfigError(
      'The onboarding tables are missing from this Supabase project. Run: npx supabase db push',
    );
  }
  if (code === '42703') {
    throw new StoreConfigError(
      'The users table is missing its onboarding columns. Run: npx supabase db push',
    );
  }
  if (code === '42501') {
    throw new StoreConfigError(
      'Supabase refused the request. SUPABASE_SERVICE_ROLE_KEY must be the service role key, not the publishable one.',
    );
  }
  if (code === '23503') {
    throw new StoreConfigError('That account no longer exists.');
  }
  throw new Error(`${context}: ${message}${code ? ` (${code})` : ''}`);
}

/**
 * PostgREST returns an embedded one-to-one as an object and a one-to-many as an
 * array, and which one it decides on depends on it noticing the child's primary
 * key is also its foreign key. Rather than depend on that inference, both
 * shapes are accepted and the question asked of either is only ever "is there a
 * row".
 */
function embedded(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

/* ------------------------------------------------------------------ */
/* Where somebody is up to                                              */
/* ------------------------------------------------------------------ */

/**
 * All four answers in one round trip.
 *
 * This runs on every admin page render for every affiliate, so it is one query
 * with three embeds rather than four queries. Only the keys are selected from
 * the children — nothing here needs the SSN, and a select that does not ask for
 * it is a select that cannot leak it.
 */
export async function readOnboarding(userId: string): Promise<OnboardingState> {
  requireStore();
  const { data, error } = await getSupabaseClient()
    .from('users')
    .select(
      'id, profile_completed_at, affiliate_agreements(user_id), w9_forms(user_id), bank_details(user_id)',
    )
    .eq('id', userId)
    .maybeSingle();
  if (error) fail('reading onboarding progress', error);
  if (!data) return { ...NOTHING_DONE };

  const row = data as Record<string, unknown>;
  return {
    profile: Boolean(row.profile_completed_at),
    agreement: embedded(row.affiliate_agreements),
    w9: embedded(row.w9_forms),
    bank: embedded(row.bank_details),
  };
}

/** One row per affiliate for the admin table: who has done what. */
export type OnboardingSummary = {
  userId: string;
  username: string;
  fullName: string;
  email: string;
  position: string;
  mobile: string;
  usr: string;
  state: OnboardingState;
  agreementSignedAt: string | null;
  w9SignedAt: string | null;
  bankSavedAt: string | null;
};

export async function listOnboarding(): Promise<OnboardingSummary[]> {
  requireStore();
  const { data, error } = await getSupabaseClient()
    .from('users')
    .select(
      'id, username, full_name, email, position, mobile, usr, role, profile_completed_at, ' +
        'affiliate_agreements(signed_at), w9_forms(signed_at), bank_details(saved_at)',
    )
    .eq('role', 'affiliate')
    .order('created_at', { ascending: true });
  if (error) fail('listing onboarding', error);

  /** The embed is an object or a one-element array; either way we want the date. */
  function stamp(value: unknown, key: string): string | null {
    const row = Array.isArray(value) ? value[0] : value;
    if (!row || typeof row !== 'object') return null;
    const found = (row as Record<string, unknown>)[key];
    return typeof found === 'string' ? found : null;
  }

  return (data ?? []).map((raw) => {
    // Through unknown: an embedded select can type a row as a Postgrest error
    // shape, and the two do not overlap enough for a direct cast.
    const row = raw as unknown as Record<string, unknown>;
    const agreementSignedAt = stamp(row.affiliate_agreements, 'signed_at');
    const w9SignedAt = stamp(row.w9_forms, 'signed_at');
    const bankSavedAt = stamp(row.bank_details, 'saved_at');
    return {
      userId: String(row.id ?? ''),
      username: String(row.username ?? ''),
      fullName: String(row.full_name ?? ''),
      email: String(row.email ?? ''),
      position: String(row.position ?? ''),
      mobile: String(row.mobile ?? ''),
      usr: String(row.usr ?? ''),
      state: {
        profile: Boolean(row.profile_completed_at),
        agreement: agreementSignedAt !== null,
        w9: w9SignedAt !== null,
        bank: bankSavedAt !== null,
      },
      agreementSignedAt,
      w9SignedAt,
      bankSavedAt,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Step 1 — their details and a password of their own                   */
/* ------------------------------------------------------------------ */

export type ProfileWrite = {
  fullName: string;
  email: string;
  position: string;
  mobile: string;
  password: string;
};

/**
 * Writes the details and the new password together, and returns the moment the
 * password changed.
 *
 * The caller needs that timestamp: every session token carries the
 * password_changed_at it was minted under, so moving it forward signs this
 * person out of the very session they are using. The route mints a replacement
 * cookie from the returned value, which is what stops step 1 from ending at the
 * sign-in page.
 */
export async function saveProfile(
  userId: string,
  input: ProfileWrite,
): Promise<{ passwordChangedAt: string }> {
  requireStore();
  const now = new Date().toISOString();
  const patch = {
    full_name: input.fullName.trim(),
    email: input.email.trim(),
    position: input.position.trim(),
    mobile: input.mobile.trim(),
    password_hash: await hashPassword(input.password),
    password_changed_at: now,
    profile_completed_at: now,
  };

  const { error } = await getSupabaseClient().from('users').update(patch).eq('id', userId);
  if (error) fail('saving your details', error);
  return { passwordChangedAt: now };
}

/* ------------------------------------------------------------------ */
/* Step 2 — the agreement                                               */
/* ------------------------------------------------------------------ */

/** Where a signature came from. Kept because ESIGN and UETA both turn on being
 *  able to show who signed, when, and that they meant to. */
export type SigningMeta = { ip: string; userAgent: string };

export type AgreementWrite = {
  affiliateName: string;
  affiliateEmail: string;
  affiliateAddress: string;
  effectiveDate: string;
  signaturePng: string;
};

export type AgreementRecord = AgreementWrite & {
  userId: string;
  signedAt: string;
  affirmed: boolean;
  signedIp: string;
  signedUserAgent: string;
  agreementVersion: string;
};

export async function saveAgreement(
  userId: string,
  input: AgreementWrite,
  meta: SigningMeta,
  version: string,
): Promise<void> {
  requireStore();
  const { error } = await getSupabaseClient()
    .from('affiliate_agreements')
    .upsert(
      {
        user_id: userId,
        signed_at: new Date().toISOString(),
        affiliate_name: input.affiliateName.trim(),
        affiliate_email: input.affiliateEmail.trim(),
        affiliate_address: input.affiliateAddress.trim(),
        effective_date: input.effectiveDate,
        signature_png: input.signaturePng,
        affirmed: true,
        signed_ip: meta.ip,
        signed_user_agent: meta.userAgent.slice(0, 400),
        agreement_version: version,
      },
      { onConflict: 'user_id' },
    );
  if (error) fail('saving the agreement', error);
}

export async function readAgreement(userId: string): Promise<AgreementRecord | null> {
  requireStore();
  const { data, error } = await getSupabaseClient()
    .from('affiliate_agreements')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) fail('reading the agreement', error);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    userId: String(row.user_id ?? ''),
    signedAt: String(row.signed_at ?? ''),
    affiliateName: String(row.affiliate_name ?? ''),
    affiliateEmail: String(row.affiliate_email ?? ''),
    affiliateAddress: String(row.affiliate_address ?? ''),
    effectiveDate: String(row.effective_date ?? ''),
    signaturePng: String(row.signature_png ?? ''),
    affirmed: row.affirmed === true,
    signedIp: String(row.signed_ip ?? ''),
    signedUserAgent: String(row.signed_user_agent ?? ''),
    agreementVersion: String(row.agreement_version ?? ''),
  };
}

/* ------------------------------------------------------------------ */
/* Step 3 — the W-9                                                     */
/* ------------------------------------------------------------------ */

export type W9Write = {
  line1Name: string;
  line2Business: string;
  classification: string;
  llcCode: string;
  otherText: string;
  foreignPartners: boolean;
  exemptPayeeCode: string;
  fatcaCode: string;
  address: string;
  cityStateZip: string;
  accountNumbers: string;
  tinType: 'ssn' | 'ein';
  /** Plaintext, and the only place in this module that holds one. Sealed below
   *  before it goes anywhere near the database. */
  tin: string;
  signaturePng: string;
};

/**
 * A stored W-9 as everything except the two reveal functions may see it: the
 * taxpayer number is four digits and a type, never the number.
 */
export type W9Record = Omit<W9Write, 'tin'> & {
  userId: string;
  signedAt: string;
  tinLast4: string;
  certified: boolean;
  signedIp: string;
  signedUserAgent: string;
  formRevision: string;
};

export async function saveW9(
  userId: string,
  input: W9Write,
  meta: SigningMeta,
  revision: string,
): Promise<void> {
  requireStore();
  const digits = digitsOf(input.tin);
  const { error } = await getSupabaseClient()
    .from('w9_forms')
    .upsert(
      {
        user_id: userId,
        signed_at: new Date().toISOString(),
        line1_name: input.line1Name.trim(),
        line2_business: input.line2Business.trim(),
        classification: input.classification,
        llc_code: input.classification === 'llc' ? input.llcCode : '',
        // Only kept for the one box that has a rule beside it to write on.
        other_text: input.classification === 'other' ? input.otherText.trim() : '',
        exempt_payee_code: input.exemptPayeeCode.trim(),
        fatca_code: input.fatcaCode.trim(),
        foreign_partners: input.foreignPartners,
        address: input.address.trim(),
        city_state_zip: input.cityStateZip.trim(),
        account_numbers: input.accountNumbers.trim(),
        tin_type: input.tinType,
        tin_encrypted: seal(digits),
        tin_last4: last4(digits),
        signature_png: input.signaturePng,
        certified: true,
        signed_ip: meta.ip,
        signed_user_agent: meta.userAgent.slice(0, 400),
        form_revision: revision,
      },
      { onConflict: 'user_id' },
    );
  if (error) fail('saving the W-9', error);
}

export async function readW9(userId: string): Promise<W9Record | null> {
  requireStore();
  const { data, error } = await getSupabaseClient()
    .from('w9_forms')
    // Every column except the ciphertext. Spelled out so the sealed number
    // cannot arrive somewhere that did not ask for it.
    .select(
      'user_id, signed_at, line1_name, line2_business, classification, llc_code, other_text, ' +
        'foreign_partners, exempt_payee_code, fatca_code, address, city_state_zip, account_numbers, ' +
        'tin_type, tin_last4, signature_png, certified, signed_ip, signed_user_agent, form_revision',
    )
    .eq('user_id', userId)
    .maybeSingle();
  if (error) fail('reading the W-9', error);
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  return {
    userId: String(row.user_id ?? ''),
    signedAt: String(row.signed_at ?? ''),
    line1Name: String(row.line1_name ?? ''),
    line2Business: String(row.line2_business ?? ''),
    classification: String(row.classification ?? ''),
    llcCode: String(row.llc_code ?? ''),
    otherText: String(row.other_text ?? ''),
    foreignPartners: row.foreign_partners === true,
    exemptPayeeCode: String(row.exempt_payee_code ?? ''),
    fatcaCode: String(row.fatca_code ?? ''),
    address: String(row.address ?? ''),
    cityStateZip: String(row.city_state_zip ?? ''),
    accountNumbers: String(row.account_numbers ?? ''),
    tinType: row.tin_type === 'ein' ? 'ein' : 'ssn',
    tinLast4: String(row.tin_last4 ?? ''),
    signaturePng: String(row.signature_png ?? ''),
    certified: row.certified === true,
    signedIp: String(row.signed_ip ?? ''),
    signedUserAgent: String(row.signed_user_agent ?? ''),
    formRevision: String(row.form_revision ?? ''),
  };
}

/* ------------------------------------------------------------------ */
/* Step 4 — where the money goes                                        */
/* ------------------------------------------------------------------ */

export type BankWrite = {
  accountName: string;
  bankName: string;
  /** Plaintext, sealed below. */
  accountNumber: string;
};

export type BankRecord = {
  userId: string;
  savedAt: string;
  accountName: string;
  bankName: string;
  accountLast4: string;
};

export async function saveBank(userId: string, input: BankWrite): Promise<void> {
  requireStore();
  const digits = digitsOf(input.accountNumber);
  const { error } = await getSupabaseClient()
    .from('bank_details')
    .upsert(
      {
        user_id: userId,
        saved_at: new Date().toISOString(),
        account_name: input.accountName.trim(),
        bank_name: input.bankName.trim(),
        account_number_encrypted: seal(digits),
        account_number_last4: last4(digits),
      },
      { onConflict: 'user_id' },
    );
  if (error) fail('saving your bank details', error);
}

export async function readBank(userId: string): Promise<BankRecord | null> {
  requireStore();
  const { data, error } = await getSupabaseClient()
    .from('bank_details')
    .select('user_id, saved_at, account_name, bank_name, account_number_last4')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) fail('reading the bank details', error);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    userId: String(row.user_id ?? ''),
    savedAt: String(row.saved_at ?? ''),
    accountName: String(row.account_name ?? ''),
    bankName: String(row.bank_name ?? ''),
    accountLast4: String(row.account_number_last4 ?? ''),
  };
}

/* ------------------------------------------------------------------ */
/* Unsealing, which is its own act                                      */
/* ------------------------------------------------------------------ */

/*
 * These two are the only code in the application that turns a sealed number
 * back into a readable one. They are deliberately not folded into readW9 and
 * readBank: a page that lists twenty affiliates should not be able to decrypt
 * twenty Social Security numbers as a side effect of rendering a table, and
 * keeping the plaintext path in two named functions means "who can see an SSN"
 * is a question you can answer by finding their callers.
 */

export async function revealTin(userId: string): Promise<{ tin: string; type: 'ssn' | 'ein' } | null> {
  requireStore();
  const { data, error } = await getSupabaseClient()
    .from('w9_forms')
    .select('tin_encrypted, tin_type')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) fail('reading the taxpayer number', error);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    tin: open(String(row.tin_encrypted ?? '')),
    type: row.tin_type === 'ein' ? 'ein' : 'ssn',
  };
}

export async function revealAccountNumber(userId: string): Promise<string | null> {
  requireStore();
  const { data, error } = await getSupabaseClient()
    .from('bank_details')
    .select('account_number_encrypted')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) fail('reading the account number', error);
  if (!data) return null;
  return open(String((data as Record<string, unknown>).account_number_encrypted ?? ''));
}
