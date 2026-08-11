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
}: {
  origin: string;
  people: KnownPerson[];
  /** "slug::usr" of every link that already exists, for the availability check. */
  takenSlugKeys: string[];
  storageLabel: string;
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
    <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div>
        <h1 className="font-display text-[34px] leading-[1.1]">Create an affiliate link</h1>
        <p className="mt-2.5 max-w-[520px] text-[13.5px] leading-relaxed text-sage">
          Pair a destination with the person who owns the traffic. Three fields are required — the
          rest have defaults you can change later.
        </p>

        {formError ? (
          <p
            ref={bannerRef}
            tabIndex={-1}
            role="alert"
            className="mt-5 rounded-xl border px-4 py-3 text-sm outline-none"
            style={{
              borderColor: 'var(--color-mustard)',
              background: 'rgba(227,176,75,0.1)',
              color: 'var(--color-mustard)',
            }}
          >
            {formError}
          </p>
        ) : null}

        {/* 1 — the offer */}
        <Step number={1} title="The offer">
          <div className="grid gap-[18px] sm:grid-cols-2">
            <Field label="Campaign name" error={errors.campaign} required>
              <input
                className="field-dark"
                value={values.campaign}
                onChange={(e) => onCampaignChange(e.target.value)}
                placeholder="Cash Back Credit Cards"
                maxLength={120}
                autoComplete="off"
              />
            </Field>
            <Field
              label="Destination URL"
              error={errors.destination}
              note={
                destinationOk === false ? undefined : 'Exactly as your affiliate network gave it.'
              }
              required
            >
              <input
                className="field-dark"
                value={values.destination}
                onChange={(e) => set('destination', e.target.value)}
                placeholder="https://www.cardratings.com/bestcards/cash-back.php?src=714025"
                inputMode="url"
                maxLength={2000}
                autoComplete="off"
                aria-invalid={destinationOk === false}
              />
              {destinationOk === false ? (
                <span className="field-error block">Enter a full URL including https://</span>
              ) : null}
            </Field>
          </div>

          <div className="mt-4 grid gap-[18px] sm:grid-cols-2">
            {/* Not a <label> wrapper: the availability chip must live outside
                it, or it becomes part of the input's accessible name ("Link
                slug * Free") and its changes go unannounced. */}
            <FieldGroup label="Link slug *" error={errors.slug}>
              <div className="flex items-center gap-2 rounded-[10px] border border-pine-700 bg-pine-900 px-3.5 py-3 focus-within:border-mustard">
                {/* The origin can be long on a real host — let it shrink so the
                    slug input never collapses to nothing. */}
                <span className="min-w-0 max-w-[45%] shrink truncate text-[13px] text-sage-dim">
                  {origin.replace(/^https?:\/\//, '')}/
                </span>
                <input
                  id="slug-input"
                  aria-label="Link slug"
                  aria-describedby={slug ? 'slug-status' : undefined}
                  aria-invalid={slugTaken}
                  className="w-full min-w-0 flex-1 border-none bg-transparent p-0 text-sm text-cream outline-none"
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
                className="mt-1.5 flex items-center gap-1.5 text-[11.5px]"
                style={{ color: slugTaken ? 'var(--color-mustard)' : 'var(--color-moss)' }}
              >
                {slug ? (
                  <>
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        background: slugTaken ? 'var(--color-mustard)' : 'var(--color-moss)',
                      }}
                    />
                    {slugTaken ? 'That link already exists' : 'The slug is free'}
                  </>
                ) : null}
              </span>
            </FieldGroup>

            <FieldGroup
              label="Pass the tracking key on as"
              error={errors.passUsrParam}
              note="Appends the person's key to the destination so the merchant can attribute it."
            >
              <div className="flex flex-wrap gap-[7px]">
                {PASS_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="pill-action"
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
                  className="pill-action"
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
                  className="pill-action"
                  aria-pressed={customParam}
                  data-active={customParam}
                  onClick={() => {
                    setCustomParam(true);
                    if (PASS_OPTIONS.includes(values.passUsrParam)) set('passUsrParam', '');
                  }}
                >
                  Something else
                </button>
              </div>
              {customParam ? (
                <input
                  className="field-dark mt-2"
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
        <Step number={2} title="The person it belongs to">
          <div className="flex flex-wrap gap-2">
            {people.map((person) => {
              const active = personMode === 'known' && pickedUsr === person.usr;
              return (
                <button
                  key={person.usr}
                  type="button"
                  aria-pressed={active}
                  onClick={() => pickPerson(person)}
                  className={`flex items-center gap-2.5 rounded-full py-2 pl-2 pr-3.5 text-[12.5px] transition-colors ${
                    active
                      ? 'bg-cream font-medium text-pine-900'
                      : 'border border-pine-700 text-[#d7cfbb] hover:border-moss'
                  }`}
                >
                  <span
                    aria-hidden
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium"
                    style={
                      active
                        ? { background: 'var(--color-pine-900)', color: 'var(--color-mustard)' }
                        : { background: 'var(--color-pine-800)', color: 'var(--color-moss)' }
                    }
                  >
                    {initialsOf(person.assignee || person.usr)}
                  </span>
                  {person.assignee || person.usr}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={personMode === 'new'}
              onClick={() => {
                setPersonMode('new');
                setPickedUsr('');
                setTouchedUsr(false);
                setValues((prev) => ({ ...prev, assignee: '', usr: '', assigneeEmail: '' }));
              }}
              className={`rounded-full px-3.5 py-2.5 text-[12.5px] transition-colors ${
                personMode === 'new'
                  ? 'border border-mustard text-mustard'
                  : 'border border-dashed border-[#3c5a52] text-sage hover:border-mustard hover:text-mustard'
              }`}
            >
              Add someone new
            </button>
            <button
              type="button"
              aria-pressed={personMode === 'house'}
              onClick={keepInHouse}
              className={`rounded-full border px-3.5 py-2.5 text-[12.5px] transition-colors ${
                personMode === 'house'
                  ? 'border-cream bg-cream font-medium text-pine-900'
                  : 'border-pine-700 text-sage hover:text-cream'
              }`}
            >
              Keep it in house
            </button>
          </div>

          {personMode !== 'house' ? (
            <div className="mt-[18px] grid gap-[18px] sm:grid-cols-2">
              <Field label="Assignee name" error={errors.assignee}>
                <input
                  className="field-dark"
                  value={values.assignee}
                  onChange={(e) => onAssigneeChange(e.target.value)}
                  placeholder="Arthur Reyes"
                  maxLength={120}
                  autoComplete="off"
                />
              </Field>
              <Field label="Tracking key" error={errors.usr} note="Appears in the link as ?usr=…">
                <input
                  className="field-dark"
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
                  className="field-dark"
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

        {/* 3 — the landing page */}
        <Step number={3} title="What the client sees" aside="Optional">
          <div className="grid gap-[18px] sm:grid-cols-2">
            <Field label="Headline" error={errors.headline} note="Defaults to the campaign name.">
              <input
                className="field-dark"
                value={values.headline}
                onChange={(e) => set('headline', e.target.value)}
                placeholder="Find your best cash back card"
                maxLength={160}
                autoComplete="off"
              />
            </Field>
            <Field label="Button label" error={errors.ctaLabel}>
              <input
                className="field-dark"
                value={values.ctaLabel}
                onChange={(e) => set('ctaLabel', e.target.value)}
                placeholder="See my matches"
                maxLength={60}
                autoComplete="off"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Sub-headline" error={errors.subheadline}>
                <input
                  className="field-dark"
                  value={values.subheadline}
                  onChange={(e) => set('subheadline', e.target.value)}
                  placeholder="Tell us where to send your matches and we'll take you straight there."
                  maxLength={300}
                  autoComplete="off"
                />
              </Field>
            </div>
          </div>

          <div className="mt-[18px] flex flex-wrap gap-6">
            <Toggle
              checked={values.requirePhone}
              onChange={(v) => set('requirePhone', v)}
              label="Ask for a phone number"
            />
            <Toggle
              checked={values.active}
              onChange={(v) => set('active', v)}
              label="Go live immediately"
            />
          </div>

          <div className="mt-[18px]">
            <Field label="Internal notes" error={errors.notes}>
              <input
                className="field-dark"
                value={values.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Q3 push — CardRatings"
                maxLength={500}
                autoComplete="off"
              />
            </Field>
          </div>
        </Step>

        <div className="mt-[22px] flex flex-wrap items-center gap-3.5">
          <button type="submit" className="btn-accent" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create the link'}
          </button>
          <button
            type="button"
            className="btn-quiet"
            disabled={submitting}
            onClick={() => {
              setValues(EMPTY);
              setTouchedSlug(false);
              setTouchedUsr(false);
              setPersonMode(people.length === 0 ? 'new' : 'house');
              setPickedUsr('');
              setErrors({});
              setFormError(null);
            }}
          >
            Reset
          </button>
          <span className="text-[12.5px] text-sage-dim">{storageLabel}</span>
        </div>
      </div>

      {/* Live preview rail */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <div className="panel-cream p-6">
          <p className="label-micro" style={{ color: 'var(--color-olive)' }}>
            The link you are making
          </p>
          {/* anywhere, not break-all: wraps at ? and / before splitting a word */}
          <p className="mt-3 text-[15px] leading-[1.5]" style={{ overflowWrap: 'anywhere' }}>
            {previewUrl.split('?')[0]}
            {usr ? <span style={{ color: 'var(--color-olive)' }}>?usr={usr}</span> : null}
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
            {values.destination
              ? `Forwards to ${values.destination.replace(/^https?:\/\//, '').slice(0, 60)}`
              : 'Add a destination and this link will forward there after the form.'}
          </p>
        </div>

        <div className="panel p-6">
          <p className="label-micro">What the client will see</p>
          <div className="mt-3.5 overflow-hidden rounded-xl bg-cream text-ink">
            <div className="p-[18px]">
              <p className="text-[12px]" style={{ color: 'var(--color-olive)' }}>
                {values.campaign || 'Your campaign'}
              </p>
              <p className="mt-2 font-display text-[23px] leading-[1.15]">
                {values.headline || values.campaign || 'Your headline'}
              </p>
              <div className="mt-3.5 h-px bg-cream-400" />
              <p className="mt-3.5 text-[11px] text-ink-faint">Full name</p>
              <div className="mt-1.5 h-8 rounded-lg border border-cream-400 bg-cream-50" />
              <p className="mt-2.5 text-[11px] text-ink-faint">Email address</p>
              <div className="mt-1.5 h-8 rounded-lg border border-cream-400 bg-cream-50" />
              {values.requirePhone ? (
                <>
                  <p className="mt-2.5 text-[11px] text-ink-faint">Phone number</p>
                  <div className="mt-1.5 h-8 rounded-lg border border-cream-400 bg-cream-50" />
                </>
              ) : null}
              <div className="mt-3.5 rounded-full bg-mustard px-3 py-2.5 text-center text-[12px] font-medium">
                {values.ctaLabel || 'Continue to the offer'}
              </div>
            </div>
          </div>
        </div>

        <div className="panel p-6">
          <p className="label-micro">Before it goes live</p>
          <Check
            ok={Boolean(slug) && !slugTaken}
            pending={!slug}
            text={
              !slug
                ? 'Choose a slug'
                : slugTaken
                  ? usr
                    ? `/${slug}?usr=${usr} already exists`
                    : `/${slug} already exists`
                  : 'The slug is free'
            }
          />
          <Check
            ok={destinationOk === true}
            pending={destinationOk === null}
            text={
              destinationOk === null
                ? 'Add a destination URL'
                : destinationOk
                  ? 'Destination is a valid http(s) URL'
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
            pending={false}
            text={values.active ? 'Goes live on save' : 'Saves paused — activate it later'}
          />
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
    <section className="panel mt-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-mustard text-[11px] font-medium text-pine-900">
          {number}
        </span>
        <h2 className="font-display text-[21px]">{title}</h2>
        {aside ? <span className="text-xs text-sage-dim">{aside}</span> : null}
      </div>
      <div className="mt-[18px]">{children}</div>
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
    <label className="block">
      <span className="label-micro mb-2 block">
        {label}
        {required ? <span style={{ color: 'var(--color-mustard)' }}> *</span> : null}
      </span>
      {children}
      {error ? (
        <span role="alert" className="field-error block">
          {error}
        </span>
      ) : note ? (
        <span className="field-note block">{note}</span>
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
      <legend className="label-micro mb-2 block p-0">{label}</legend>
      {children}
      {error ? (
        <span role="alert" className="field-error block">
          {error}
        </span>
      ) : note ? (
        <span className="field-note block">{note}</span>
      ) : null}
    </fieldset>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-[#d7cfbb]">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className="flex h-5 w-[34px] flex-none items-center rounded-full px-[3px] transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-mustard)]"
        style={{
          background: checked ? 'var(--color-mustard)' : 'var(--color-pine-800)',
          border: `1px solid ${checked ? 'var(--color-mustard)' : 'var(--color-pine-700)'}`,
          justifyContent: checked ? 'flex-end' : 'flex-start',
        }}
      >
        <span
          className="h-3.5 w-3.5 rounded-full transition-colors"
          style={{ background: checked ? 'var(--color-pine-900)' : 'var(--color-sage-dim)' }}
        />
      </span>
      {label}
    </label>
  );
}

function Check({ ok, pending, text }: { ok: boolean; pending: boolean; text: string }) {
  const color = pending
    ? 'var(--color-sage-dim)'
    : ok
      ? 'var(--color-moss)'
      : 'var(--color-mustard)';
  return (
    <p className="mt-3 flex items-center gap-2.5 text-[12.5px] text-[#d7cfbb]">
      <span
        aria-hidden
        className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[10px] font-medium"
        style={{ background: color, color: 'var(--color-pine-900)' }}
      >
        {pending ? '·' : ok ? '✓' : '!'}
      </span>
      {text}
    </p>
  );
}
