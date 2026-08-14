'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { initialsOf } from '@/lib/analytics';
import { CAMPAIGNS } from '@/lib/campaigns';
import { BusyLabel } from './Spinner';

/**
 * No `passUsrParam`.
 *
 * That control used to ask which query parameter to append the tracking key to
 * on the way out. It is gone because the key does not travel that way any more:
 * it is written into the destination URL itself as `var2=<usr>`, which is the
 * column QuinStreet reports back and therefore the column an approval is
 * matched on. Appending a second copy under another name only created a way for
 * the two to disagree. Links created before this keep whatever they were given,
 * and it is still honoured when they are followed.
 */
type Fields = {
  campaign: string;
  destination: string;
  slug: string;
  assignee: string;
  usr: string;
  assigneeEmail: string;
  headline: string;
  subheadline: string;
  ctaLabel: string;
  requirePhone: boolean;
  notes: string;
  active: boolean;
};

const EMPTY: Fields = {
  campaign: '',
  destination: '',
  slug: '',
  assignee: '',
  usr: '',
  assigneeEmail: '',
  headline: '',
  subheadline: '',
  ctaLabel: '',
  requirePhone: false,
  notes: '',
  active: true,
};

/**
 * Someone a link can belong to: an affiliate account, with the tracking key it
 * was given when the account was created.
 *
 * These come from the users table now, not from whoever happened to own an
 * existing link. That closes a gap: a link could previously be created for any
 * key an admin typed, and a key with no account behind it belongs to nobody who
 * can sign in, so its traffic was invisible to everyone but an admin.
 */
export type KnownPerson = {
  usr: string;
  assignee: string;
  email: string;
  /** The sign-in name, shown so two people with the same display name are distinguishable. */
  username?: string;
};

/**
 * The starting fields.
 *
 * With a locked person the answer to step 2 is already known, so it is filled
 * in from the first render rather than after an effect — a form that flickers
 * from "nobody" to "you" invites a submit in between.
 */
function initialFields(lockedTo: KnownPerson | null): Fields {
  if (!lockedTo) return EMPTY;
  return { ...EMPTY, assignee: lockedTo.assignee, usr: lockedTo.usr, assigneeEmail: lockedTo.email };
}

/** Loose while typing (keeps a trailing dash so you can type "cash-back"). */
function softKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '');
}

/** Strict on blur / on derive. */
function hardKey(raw: string): string {
  return softKey(raw).replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

export function LinkForm({
  origin,
  people,
  lockedTo = null,
  takenSlugKeys,
  storageLabel,
  capture,
}: {
  origin: string;
  people: KnownPerson[];
  /**
   * The one person this link may belong to, or null to choose.
   *
   * Set when an affiliate is making a link for themselves. It replaces the
   * picker rather than preselecting inside it: a preselected picker is still a
   * picker, and the honest thing to show someone with one option is not a
   * choice. The server decides ownership again on its own, so this is the shape
   * of the form and not the protection.
   */
  lockedTo?: KnownPerson | null;
  /** "slug::usr" of every link that already exists, for the availability check. */
  takenSlugKeys: string[];
  storageLabel: string;
  /** Whether the capture form is switched on — section 3 only exists if it is. */
  capture: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Fields>(() => initialFields(lockedTo));
  const [touchedSlug, setTouchedSlug] = useState(false);
  /**
   * Which person the link belongs to, as explicit state.
   *
   * This used to be derived from `people.find(p => p.usr === values.usr)`,
   * which meant editing the tracking key of a picked person broke the match,
   * unmounted the assignee fields mid-keystroke, and still submitted their
   * name — attributing the link to someone the form no longer showed.
   */
  const [personMode, setPersonMode] = useState<'house' | 'known'>(lockedTo ? 'known' : 'house');
  const [pickedUsr, setPickedUsr] = useState(lockedTo?.usr ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const bannerRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (formError) bannerRef.current?.focus();
  }, [formError]);

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: '' } : prev));
  }

  // Slug follows the campaign name, and usr follows the assignee's first name,
  // until either one is edited by hand.
  function onCampaignChange(value: string) {
    setValues((prev) => ({
      ...prev,
      campaign: value,
      slug: touchedSlug ? prev.slug : hardKey(value).slice(0, 48),
    }));
    setErrors((prev) => ({ ...prev, campaign: '', slug: '' }));
  }

  function pickPerson(person: KnownPerson) {
    setPersonMode('known');
    setPickedUsr(person.usr);
    setValues((prev) => ({
      ...prev,
      assignee: person.assignee,
      usr: person.usr,
      assigneeEmail: person.email || prev.assigneeEmail,
    }));
    setErrors((prev) => ({ ...prev, assignee: '', usr: '' }));
  }

  function keepInHouse() {
    setPersonMode('house');
    setPickedUsr('');
    setValues((prev) => ({ ...prev, assignee: '', usr: '', assigneeEmail: '' }));
  }

  const picked = lockedTo ?? people.find((person) => person.usr === pickedUsr) ?? null;

  const slug = hardKey(values.slug);
  const usr = hardKey(values.usr);
  const previewUrl = `${origin}/${slug || 'your-slug'}${usr ? `?usr=${usr}` : ''}`;

  const slugTaken = useMemo(
    () => Boolean(slug) && takenSlugKeys.includes(`${slug}::${usr}`),
    [slug, usr, takenSlugKeys],
  );

  const destinationOk = useMemo(() => {
    if (!values.destination.trim()) return null;
    try {
      const url = new URL(values.destination.trim());
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, [values.destination]);

  /**
   * Whether the destination carries `var2=<usr>`.
   *
   * This is the whole attribution chain in one query parameter: QuinStreet
   * passes var2 through to its reporting untouched, and the sync matches that
   * column back to a tracking key to decide who an approval paid. A destination
   * without it produces traffic that reports against nobody, which is invisible
   * until a payout is missing weeks later — so it is worth saying now, while
   * the URL is still on screen and easy to fix.
   *
   * A warning rather than a block: the merchant may one day use a different
   * column, and a form that refuses to save is worse than one that tells you.
   */
  const var2Ok = useMemo(() => {
    const destination = values.destination.trim();
    if (!destination || !usr) return null;
    try {
      const carried = new URL(destination).searchParams.get('var2') ?? '';
      return carried.trim().toLowerCase() === usr.toLowerCase();
    } catch {
      return null;
    }
  }, [values.destination, usr]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setErrors({});

    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...values, slug, usr }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (payload.fields && typeof payload.fields === 'object') {
          setErrors(payload.fields as Record<string, string>);
        }
        setFormError(payload.error ?? `Could not create the link (${res.status})`);
        setSubmitting(false);
        return;
      }

      // No setSubmitting(false): the navigation is still in flight, and
      // re-enabling invites a second create that fails with "already exists".
      router.push('/links');
      router.refresh();
    } catch {
      setFormError('Network error. The link was not created.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">
        <h1 className="font-display text-[38px] leading-[1.05] sm:text-[46px]">
          {lockedTo ? 'Create your affiliate link' : 'Create an affiliate link'}
        </h1>
        <p className="mt-3 max-w-[640px] text-[20px] leading-relaxed text-ink-soft">
          {lockedTo ? (
            <>
              Every link you make here is tracked to your key, so the clicks and the payouts land on
              your dashboard. Three answers are required; the rest have sensible defaults.
            </>
          ) : (
            <>
              Pair a destination with the person who owns the traffic. Three answers are required.
              The rest have sensible defaults you can change later.
            </>
          )}
        </p>

        {formError ? (
          <p
            ref={bannerRef}
            tabIndex={-1}
            role="alert"
            className="mt-6 rounded-2xl border-2 border-alarm bg-alarm-wash px-5 py-4 text-[19px] font-semibold text-alarm outline-none"
          >
            {formError}
          </p>
        ) : null}

        {/* 1 — the offer */}
        <Step number={1} title="The offer">
          <div className="grid gap-6 sm:grid-cols-2">
            <Field
              label="Campaign"
              error={errors.campaign}
              note="Pick the category this offer belongs to."
              required
            >
              {/* A fixed list, not free text: "Cash back" typed once and "Cash
                  Back" typed the next week are the same offer, and every figure
                  grouped by campaign would quietly split in two. */}
              <select
                className="field"
                value={values.campaign}
                onChange={(e) => onCampaignChange(e.target.value)}
              >
                <option value="">Choose a campaign…</option>
                {CAMPAIGNS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Where it sends people"
              error={errors.destination}
              note={
                destinationOk === false
                  ? undefined
                  : 'Paste it exactly as your affiliate network gave it.'
              }
              required
            >
              <input
                className="field"
                value={values.destination}
                onChange={(e) => set('destination', e.target.value)}
                placeholder="https://www.cardratings.com/bestcards/cash-back.php?src=714025"
                inputMode="url"
                maxLength={2000}
                autoComplete="off"
                aria-invalid={destinationOk === false}
              />
              {destinationOk === false ? (
                <span className="field-error">Enter a full URL including https://</span>
              ) : var2Ok === false ? (
                <span className="field-note">
                  This URL does not carry <code>var2={usr}</code>. Approvals come back matched on
                  var2, so without it this link&rsquo;s earnings will not be traced to{' '}
                  {lockedTo ? 'you' : 'them'}.
                </span>
              ) : null}
            </Field>
          </div>

          <div className="mt-6">
            {/* Not a <label> wrapper: the availability line must live outside it,
                or it becomes part of the input's accessible name ("Your short
                link * The slug is free") and its changes go unannounced. */}
            <FieldGroup label="Your short link *" error={errors.slug}>
              <div className="field field-combo">
                {/* The origin can be long on a real host — let it shrink so the
                    slug input never collapses to nothing. The truncation is on
                    an inner span because this one is a flex container, and
                    text-overflow does nothing to a flex container's own text. */}
                <span className="field-combo-prefix">
                  <span className="truncate">{origin.replace(/^https?:\/\//, '')}/</span>
                </span>
                <input
                  id="slug-input"
                  aria-label="Your short link"
                  aria-describedby={slug ? 'slug-status' : undefined}
                  aria-invalid={slugTaken}
                  /* No height of its own: the row stretches it. Give it one and
                     it becomes a 25px strip pinned to the top of a 60px box,
                     with the text against the upper edge and most of the
                     control not taking a click. */
                  className="field-combo-input"
                  value={values.slug}
                  onChange={(e) => {
                    setTouchedSlug(true);
                    set('slug', softKey(e.target.value).slice(0, 48));
                  }}
                  onBlur={(e) => set('slug', hardKey(e.target.value))}
                  placeholder="cashback"
                  maxLength={48}
                  autoComplete="off"
                />
              </div>
              <span
                id="slug-status"
                role="status"
                aria-live="polite"
                className="mt-2 flex items-center gap-2.5 text-[18px] font-semibold"
                style={{
                  color: slugTaken ? 'var(--color-alarm)' : 'var(--color-leaf-text)',
                }}
              >
                {slug ? (
                  <>
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 flex-none rounded-full"
                      style={{
                        background: slugTaken ? 'var(--color-alarm)' : 'var(--color-leaf-live)',
                      }}
                    />
                    {slugTaken ? 'That link already exists' : 'That link is free'}
                  </>
                ) : null}
              </span>
            </FieldGroup>
          </div>

        </Step>

        {/* 2 — the person */}
        <Step number={2} title="Who it belongs to">
          {lockedTo ? (
            <p className="plain">
              This one is yours. Links you create are tracked to your own key and cannot be made for
              anybody else, so there is nothing to choose here.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3.5">
                {people.map((person) => {
                  const active = personMode === 'known' && pickedUsr === person.usr;
                  return (
                    <button
                      key={person.usr}
                      type="button"
                      aria-pressed={active}
                      onClick={() => pickPerson(person)}
                      className="pill-filter h-[68px] max-w-full gap-3.5 pl-3.5 pr-6"
                      data-active={active}
                    >
                      <span
                        aria-hidden
                        className="flex h-11 w-11 flex-none items-center justify-center rounded-full border-2 text-[17px] font-bold"
                        style={
                          active
                            ? {
                                background: 'var(--color-gold)',
                                borderColor: 'var(--color-gold-edge)',
                                color: 'var(--color-gold-ink)',
                              }
                            : {
                                background: 'var(--color-leaf-wash)',
                                borderColor: 'var(--color-leaf-edge)',
                                color: 'var(--color-leaf-text)',
                              }
                        }
                      >
                        {initialsOf(person.assignee || person.usr)}
                      </span>
                      {/* Names are free text and the pill cannot wrap — truncate
                          rather than let one long name widen the page. The key is
                          shown too, because two people can share a display name and
                          the key is the thing that decides who gets paid. */}
                      <span className="min-w-0 text-left">
                        <span className="block truncate text-[20px] font-semibold leading-tight">
                          {person.assignee || person.username || person.usr}
                        </span>
                        <span className="tnum block truncate text-[16px] leading-tight text-ink-soft">
                          usr={person.usr}
                        </span>
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-pressed={personMode === 'house'}
                  data-active={personMode === 'house'}
                  onClick={keepInHouse}
                  className="pill-filter h-[68px] px-7 text-[20px]"
                >
                  Keep it in house
                </button>
              </div>

              {people.length === 0 ? (
                <p className="plain-note mt-5">
                  Nobody has an affiliate account yet, so this link can only be a house link. Create
                  someone on the <Link href="/users" className="link-text">People page</Link> and
                  they will appear here with a tracking key of their own.
                </p>
              ) : (
                <p className="field-note mt-4">
                  Only people with an account are listed. Their tracking key was generated when the
                  account was made, so there is nothing to type and no way to mistype it. Add
                  someone on the <Link href="/users" className="link-text">People page</Link>.
                </p>
              )}
            </>
          )}

          {picked ? (
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              {/* Read-only, and not a disabled input: the key is a fact about
                  the account, not a field that happens to be locked. Editing it
                  here would point the link at a key nobody can sign in as. */}
              <div className="panel-sunk p-5">
                <span className="label-cap block">Tracking key</span>
                <p className="tnum mt-2 text-[26px] font-bold">{picked.usr}</p>
                <p className="field-note">
                  Appears in the link as <code>?usr={picked.usr}</code>, and is what lets{' '}
                  {lockedTo ? (
                    <>you see this link&rsquo;s traffic when you sign in.</>
                  ) : (
                    <>
                      {picked.assignee || picked.username || 'them'} see this link&rsquo;s traffic
                      when they sign in.
                    </>
                  )}
                </p>
              </div>
              <Field
                label={lockedTo ? 'Email for your records' : 'Email for their records'}
                error={errors.assigneeEmail}
                note={
                  lockedTo
                    ? 'Stored on the link. Prefilled from your account if it has one.'
                    : 'Stored on the link. Prefilled from their account if it has one.'
                }
              >
                <input
                  className="field"
                  value={values.assigneeEmail}
                  onChange={(e) => set('assigneeEmail', e.target.value)}
                  placeholder="arthur@example.com"
                  type="email"
                  maxLength={160}
                  autoComplete="off"
                />
              </Field>
            </div>
          ) : null}
        </Step>

        {/* 3 — the landing page. Only exists while the capture form is on;
            with it off the visitor never sees a page of ours to write copy for. */}
        {capture ? (
          <Step number={3} title="What the visitor sees" aside="Optional">
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Headline" error={errors.headline} note="Left empty, we use the campaign name.">
                <input
                  className="field"
                  value={values.headline}
                  onChange={(e) => set('headline', e.target.value)}
                  placeholder="Find your best cash back card"
                  maxLength={160}
                  autoComplete="off"
                />
              </Field>
              <Field label="Button label" error={errors.ctaLabel}>
                <input
                  className="field"
                  value={values.ctaLabel}
                  onChange={(e) => set('ctaLabel', e.target.value)}
                  placeholder="See my matches"
                  maxLength={60}
                  autoComplete="off"
                />
              </Field>
            </div>

            <div className="mt-6">
              <Field label="Sub-headline" error={errors.subheadline}>
                <input
                  className="field"
                  value={values.subheadline}
                  onChange={(e) => set('subheadline', e.target.value)}
                  placeholder="Tell us where to send your matches and we'll take you straight there."
                  maxLength={300}
                  autoComplete="off"
                />
              </Field>
            </div>

            <div className="mt-6">
              <Toggle
                checked={values.requirePhone}
                onChange={(v) => set('requirePhone', v)}
                label="Ask for a phone number"
                onText="On: name, email and phone"
                offText="Off: email only"
              />
            </div>
          </Step>
        ) : null}

        {/* 4 — housekeeping */}
        <Step number={capture ? 4 : 3} title="Before you save">
          <Toggle
            checked={values.active}
            onChange={(v) => set('active', v)}
            label="Go live immediately"
            onText="On: the link works as soon as you save"
            offText="Off: saves paused, you can activate it later"
          />
          <div className="mt-6">
            <Field label="Notes for your team" error={errors.notes}>
              <input
                className="field"
                value={values.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Q3 push for CardRatings"
                maxLength={500}
                autoComplete="off"
              />
            </Field>
          </div>
        </Step>

        <div className="mt-7 flex flex-wrap items-center gap-5">
          <button
            type="submit"
            className="btn-primary h-[68px] px-10 text-[22px]"
            disabled={submitting}
            aria-busy={submitting}
          >
            {/* Stays busy through the navigation that follows a success, which
                is deliberate — see onSubmit, where setSubmitting(false) is
                left out so a second click cannot create a second link. */}
            <BusyLabel busy={submitting} idle="Create the link" busyLabel="Creating…" />
          </button>
          <button
            type="button"
            className="btn-outline h-[68px]"
            disabled={submitting}
            onClick={() => {
              // Back to the starting state, which for a locked form means back
              // to them — not to a house link they are not allowed to make.
              setValues(initialFields(lockedTo));
              setTouchedSlug(false);
              setPersonMode(lockedTo ? 'known' : 'house');
              setPickedUsr(lockedTo?.usr ?? '');
              setErrors({});
              setFormError(null);
            }}
          >
            Start over
          </button>
          <span className="text-[19px] text-ink-soft">{storageLabel}</span>
        </div>
      </div>

      {/* Live preview rail */}
      <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
        <div className="panel-sunk p-6 sm:p-7">
          <h2 className="label-cap">The link you are making</h2>
          {/* anywhere, not break-all: wraps at ? and / before splitting a word */}
          <p className="mt-3.5 text-[22px] font-bold leading-[1.4]" style={{ overflowWrap: 'anywhere' }}>
            {previewUrl.split('?')[0]}
            {usr ? <span className="text-ink-soft">?usr={usr}</span> : null}
          </p>
          <p className="plain mt-3.5">
            {values.destination
              ? `Anyone who opens this is forwarded to ${values.destination
                  .replace(/^https?:\/\//, '')
                  .slice(0, 48)}${capture ? ' after the form' : ''}.`
              : 'Add a destination and this link will forward there.'}
          </p>
        </div>

        {capture ? (
          <div className="panel p-6 sm:p-7">
            <h2 className="label-cap">What the visitor will see</h2>
            <div className="mt-4 rounded-2xl border-2 border-edge-soft bg-paper-sunk p-6">
              <p className="text-[17px] text-ink-soft">{values.campaign || 'Your campaign'}</p>
              <p className="mt-3 font-display text-[28px] font-semibold leading-[1.2]">
                {values.headline || values.campaign || 'Your headline'}
              </p>
              <p className="mt-4 text-[18px] font-semibold">Full name</p>
              <div className="mt-2 h-14 rounded-xl border-2 border-edge-field bg-panel" />
              <p className="mt-4 text-[18px] font-semibold">Email address</p>
              <div className="mt-2 h-14 rounded-xl border-2 border-edge-field bg-panel" />
              {values.requirePhone ? (
                <>
                  <p className="mt-4 text-[18px] font-semibold">Phone number</p>
                  <div className="mt-2 h-14 rounded-xl border-2 border-edge-field bg-panel" />
                </>
              ) : null}
              <div className="mt-5 flex h-[60px] items-center justify-center rounded-full border-2 border-gold-edge bg-gold text-[20px] font-bold text-gold-ink">
                {values.ctaLabel || 'Continue to the offer'}
              </div>
            </div>
          </div>
        ) : null}

        <div className="panel p-6 sm:p-7">
          <h2 className="label-cap">Before it goes live</h2>
          <ul className="mt-4 flex flex-col gap-4">
            <Check
              ok={Boolean(slug) && !slugTaken}
              pending={!slug}
              text={
                !slug
                  ? 'Choose a short link'
                  : slugTaken
                    ? usr
                      ? `/${slug}?usr=${usr} already exists`
                      : `/${slug} already exists`
                    : 'Short link chosen'
              }
            />
            <Check
              ok={destinationOk === true}
              pending={destinationOk === null}
              text={
                destinationOk === null
                  ? 'Add a destination'
                  : destinationOk
                    ? 'Destination added'
                    : 'Destination must start with https://'
              }
            />
            <Check
              ok={Boolean(values.campaign.trim())}
              pending={!values.campaign.trim()}
              text={values.campaign.trim() ? 'Campaign named' : 'Name the campaign'}
            />
            {/* Only once there is a key to check against — on a house link
                there is no var2 to expect, so the row would be noise. */}
            {usr ? (
              <Check
                ok={var2Ok === true}
                pending={var2Ok === null}
                text={
                  var2Ok === null
                    ? `Destination should carry var2=${usr}`
                    : var2Ok
                      ? `Destination carries var2=${usr}`
                      : `Destination is missing var2=${usr}`
                }
              />
            ) : null}
            <Check
              ok={values.active}
              pending={!values.active}
              text={values.active ? 'Goes live the moment you save' : 'Saves paused until you activate it'}
            />
          </ul>
        </div>
      </aside>
    </form>
  );
}

function Step({
  number,
  title,
  aside,
  children,
}: {
  number: number;
  title: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel mt-6 p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full border-2 border-gold-edge bg-gold text-[21px] font-bold text-gold-ink"
        >
          {number}
        </span>
        <h2 className="font-display text-[28px] sm:text-[32px]">
          {/* The number is decorative in the circle and read here instead, so
              the heading list still says "Step 1" out loud. */}
          <span className="sr-only">Step {number}: </span>
          {title}
        </h2>
        {aside ? <span className="chip chip-quiet">{aside}</span> : null}
      </div>
      <div className="mt-7">{children}</div>
    </section>
  );
}

function Field({
  label,
  note,
  error,
  required,
  children,
}: {
  label: string;
  note?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="field-label mb-2.5">
        {label}
        {required ? (
          <span className="text-alarm" title="Required">
            {' '}
            *
          </span>
        ) : null}
      </span>
      {children}
      {error ? (
        <span role="alert" className="field-error">
          {error}
        </span>
      ) : note ? (
        <span className="field-note">{note}</span>
      ) : null}
    </label>
  );
}

/**
 * Same look as Field, but a <fieldset> rather than a <label>.
 *
 * A <label> wrapping buttons forwards every click on its caption or helper text
 * to the first control inside it — clicking "Pass the tracking key on as" would
 * silently select the first pill.
 */
function FieldGroup({
  label,
  note,
  error,
  children,
}: {
  label: string;
  note?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="block min-w-0 border-0 p-0">
      <legend className="field-label mb-2.5 p-0">{label}</legend>
      {children}
      {error ? (
        <span role="alert" className="field-error">
          {error}
        </span>
      ) : note ? (
        <span className="field-note">{note}</span>
      ) : null}
    </fieldset>
  );
}

/**
 * A switch that also says, in words, which way it is set. The knob alone puts
 * the whole state on one 30px circle and its position; the line underneath is
 * what makes it readable without looking closely.
 */
function Toggle({
  checked,
  onChange,
  label,
  onText,
  offText,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  onText: string;
  offText: string;
}) {
  return (
    <label className="card-row-lit flex cursor-pointer items-center justify-between gap-5 p-5">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-[20px] font-semibold">{label}</span>
        <span
          className={`mt-0.5 block text-[18px] ${
            checked ? 'font-semibold text-leaf-text' : 'text-ink-soft'
          }`}
        >
          {checked ? onText : offText}
        </span>
      </span>
      <span
        aria-hidden
        className="flex h-[42px] w-[76px] flex-none items-center rounded-full border-2 p-[4px] transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-0 peer-focus-visible:outline-[var(--color-ink)]"
        style={{
          background: checked ? 'var(--color-leaf)' : 'var(--color-panel)',
          borderColor: checked ? 'var(--color-ink)' : 'var(--color-edge-field)',
          justifyContent: checked ? 'flex-end' : 'flex-start',
          boxShadow: checked ? undefined : 'none',
        }}
      >
        <span
          className="h-[30px] w-[30px] rounded-full transition-colors"
          style={{ background: checked ? '#ffffff' : 'var(--color-edge-field)' }}
        />
      </span>
    </label>
  );
}

function Check({ ok, pending, text }: { ok: boolean; pending: boolean; text: string }) {
  return (
    <li className="flex items-center gap-3.5 text-[19px]">
      <span
        aria-hidden
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full border-2 text-[17px] font-bold"
        style={
          pending
            ? {
                background: 'var(--color-panel)',
                borderColor: 'var(--color-edge-field)',
                borderStyle: 'dashed',
                color: 'var(--color-ink-soft)',
              }
            : ok
              ? {
                  background: 'var(--color-leaf-wash)',
                  borderColor: 'var(--color-leaf-live)',
                  color: 'var(--color-leaf-text)',
                }
              : {
                  background: 'var(--color-alarm-wash)',
                  borderColor: 'var(--color-alarm)',
                  color: 'var(--color-alarm)',
                }
        }
      >
        {pending ? '' : ok ? '✓' : '!'}
      </span>
      <span className={pending ? 'text-ink-soft' : undefined}>{text}</span>
      {/* The tick is decorative; this is what a screen reader hears. */}
      <span className="sr-only">{pending ? '(not done yet)' : ok ? '(done)' : '(needs fixing)'}</span>
    </li>
  );
}
