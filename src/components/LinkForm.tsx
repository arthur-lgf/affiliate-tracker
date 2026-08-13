'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { initialsOf } from '@/lib/analytics';

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
  passUsrParam: string;
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
  passUsrParam: '',
  notes: '',
  active: true,
};

export type KnownPerson = { usr: string; assignee: string; email: string };

/** Loose while typing (keeps a trailing dash so you can type "cash-back"). */
function softKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '');
}

/** Strict on blur / on derive. */
function hardKey(raw: string): string {
  return softKey(raw).replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

const PASS_OPTIONS = ['subid', 'aff_id', 'utm_source'];

export function LinkForm({
  origin,
  people,
  takenSlugKeys,
  storageLabel,
  capture,
}: {
  origin: string;
  people: KnownPerson[];
  /** "slug::usr" of every link that already exists, for the availability check. */
  takenSlugKeys: string[];
  storageLabel: string;
  /** Whether the capture form is switched on — section 3 only exists if it is. */
  capture: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Fields>(EMPTY);
  const [touchedSlug, setTouchedSlug] = useState(false);
  const [touchedUsr, setTouchedUsr] = useState(false);
  /**
   * Which person the link belongs to, as explicit state.
   *
   * This used to be derived from `people.find(p => p.usr === values.usr)`,
   * which meant editing the tracking key of a picked person broke the match,
   * unmounted the assignee fields mid-keystroke, and still submitted their
   * name — attributing the link to someone the form no longer showed.
   */
  const [personMode, setPersonMode] = useState<'house' | 'known' | 'new'>(
    people.length === 0 ? 'new' : 'house',
  );
  const [pickedUsr, setPickedUsr] = useState('');
  const [customParam, setCustomParam] = useState(false);
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
    setTouchedUsr(true);
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
    setTouchedUsr(true);
    setValues((prev) => ({ ...prev, assignee: '', usr: '', assigneeEmail: '' }));
  }

  function onAssigneeChange(value: string) {
    const firstName = value.trim().split(/\s+/)[0] ?? '';
    setValues((prev) => ({
      ...prev,
      assignee: value,
      usr: touchedUsr ? prev.usr : hardKey(firstName).slice(0, 48),
    }));
    setErrors((prev) => ({ ...prev, assignee: '', usr: '' }));
  }

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
      setFormError('Network error — the link was not created.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">
        <h1 className="font-display text-[38px] leading-[1.05] sm:text-[46px]">
          Create an affiliate link
        </h1>
        <p className="mt-3 max-w-[640px] text-[20px] leading-relaxed text-ink-soft">
          Pair a destination with the person who owns the traffic. Three answers are required — the
          rest have sensible defaults you can change later.
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
            <Field label="Campaign name" error={errors.campaign} required>
              <input
                className="field"
                value={values.campaign}
                onChange={(e) => onCampaignChange(e.target.value)}
                placeholder="Cash Back Credit Cards"
                maxLength={120}
                autoComplete="off"
              />
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
              ) : null}
            </Field>
          </div>

          <div className="mt-6">
            {/* Not a <label> wrapper: the availability line must live outside it,
                or it becomes part of the input's accessible name ("Your short
                link * The slug is free") and its changes go unannounced. */}
            <FieldGroup label="Your short link *" error={errors.slug}>
              <div className="field flex items-center gap-0 overflow-hidden p-0 focus-within:border-ink">
                {/* The origin can be long on a real host — let it shrink so the
                    slug input never collapses to nothing. */}
                <span className="flex h-[60px] min-w-0 max-w-[45%] shrink items-center truncate border-r-2 border-edge bg-paper-sunk px-5 text-[19px] text-ink-soft">
                  {origin.replace(/^https?:\/\//, '')}/
                </span>
                <input
                  id="slug-input"
                  aria-label="Your short link"
                  aria-describedby={slug ? 'slug-status' : undefined}
                  aria-invalid={slugTaken}
                  /* self-stretch, or the input is a 32px strip floating inside
                     a 64px box and half the control does not take a click. */
                  className="h-full w-full min-w-0 flex-1 self-stretch border-none bg-transparent px-5 text-[21px] font-semibold text-ink outline-none"
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

          <div className="mt-6">
            <FieldGroup
              label="Pass the tracking key on as"
              error={errors.passUsrParam}
              note="This adds the person's key to the end of the destination so the merchant knows whose traffic it was."
            >
              <div className="flex flex-wrap gap-3">
                {PASS_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="pill-filter"
                    aria-pressed={values.passUsrParam === option}
                    data-active={values.passUsrParam === option}
                    onClick={() => {
                      setCustomParam(false);
                      set('passUsrParam', option);
                    }}
                  >
                    {option}
                  </button>
                ))}
                <button
                  type="button"
                  className="pill-filter"
                  aria-pressed={!customParam && values.passUsrParam === ''}
                  data-active={!customParam && values.passUsrParam === ''}
                  onClick={() => {
                    setCustomParam(false);
                    set('passUsrParam', '');
                  }}
                >
                  Don&rsquo;t pass it
                </button>
                {/* Any param name was allowed before the redesign; keep that
                    possible rather than capping it at three presets. */}
                <button
                  type="button"
                  className="pill-filter border-dashed"
                  aria-pressed={customParam}
                  data-active={customParam}
                  onClick={() => {
                    setCustomParam(true);
                    if (PASS_OPTIONS.includes(values.passUsrParam)) set('passUsrParam', '');
                  }}
                >
                  Something else…
                </button>
              </div>
              {customParam ? (
                <input
                  className="field mt-4"
                  value={values.passUsrParam}
                  onChange={(e) =>
                    set('passUsrParam', e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))
                  }
                  placeholder="e.g. clickref"
                  maxLength={32}
                  autoComplete="off"
                  aria-label="Custom tracking parameter name"
                />
              ) : null}
            </FieldGroup>
          </div>
        </Step>

        {/* 2 — the person */}
        <Step number={2} title="Who it belongs to">
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
                      rather than let one long name widen the page. */}
                  <span className="min-w-0 truncate text-[20px] font-semibold">
                    {person.assignee || person.usr}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={personMode === 'new'}
              data-active={personMode === 'new'}
              onClick={() => {
                setPersonMode('new');
                setPickedUsr('');
                setTouchedUsr(false);
                setValues((prev) => ({ ...prev, assignee: '', usr: '', assigneeEmail: '' }));
              }}
              className="pill-filter h-[68px] border-dashed px-7 text-[20px]"
            >
              + Add someone new
            </button>
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

          {personMode !== 'house' ? (
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <Field label="Their name" error={errors.assignee}>
                <input
                  className="field"
                  value={values.assignee}
                  onChange={(e) => onAssigneeChange(e.target.value)}
                  placeholder="Arthur Reyes"
                  maxLength={120}
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Tracking key"
                error={errors.usr}
                note="Appears in the link as ?usr=…"
              >
                <input
                  className="field"
                  value={values.usr}
                  onChange={(e) => {
                    setTouchedUsr(true);
                    set('usr', softKey(e.target.value).slice(0, 48));
                  }}
                  onBlur={(e) => set('usr', hardKey(e.target.value))}
                  placeholder="arthur"
                  maxLength={48}
                  autoComplete="off"
                />
              </Field>
              <Field label="Email for their records" error={errors.assigneeEmail}>
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
                onText="On — name, email and phone"
                offText="Off — email only"
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
            onText="On — the link works as soon as you save"
            offText="Off — saves paused, you can activate it later"
          />
          <div className="mt-6">
            <Field label="Notes for your team" error={errors.notes}>
              <input
                className="field"
                value={values.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Q3 push — CardRatings"
                maxLength={500}
                autoComplete="off"
              />
            </Field>
          </div>
        </Step>

        <div className="mt-7 flex flex-wrap items-center gap-5">
          <button type="submit" className="btn-primary h-[68px] px-10 text-[22px]" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create the link'}
          </button>
          <button
            type="button"
            className="btn-outline h-[68px]"
            disabled={submitting}
            onClick={() => {
              setValues(EMPTY);
              setTouchedSlug(false);
              setTouchedUsr(false);
              setPersonMode(people.length === 0 ? 'new' : 'house');
              setPickedUsr('');
              setCustomParam(false);
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
            <Check
              ok={values.active}
              pending={!values.active}
              text={values.active ? 'Goes live the moment you save' : 'Saves paused — activate it later'}
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
