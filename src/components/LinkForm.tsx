'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

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

/** Loose while typing (keeps a trailing dash so you can type "cash-back"). */
function softKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '');
}

/** Strict on blur / on derive. */
function hardKey(raw: string): string {
  return softKey(raw).replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

export function LinkForm({ origin }: { origin: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Fields>(EMPTY);
  const [touchedSlug, setTouchedSlug] = useState(false);
  const [touchedUsr, setTouchedUsr] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const bannerRef = useRef<HTMLParagraphElement | null>(null);

  // The submit button sits below four long sections; without this the failure
  // message appears far off-screen and the form just looks unresponsive.
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

  function onAssigneeChange(value: string) {
    const firstName = value.trim().split(/\s+/)[0] ?? '';
    setValues((prev) => ({
      ...prev,
      assignee: value,
      usr: touchedUsr ? prev.usr : hardKey(firstName).slice(0, 48),
    }));
    setErrors((prev) => ({ ...prev, assignee: '', usr: '' }));
  }

  const preview = useMemo(() => {
    const slug = values.slug || 'your-slug';
    const base = `${origin}/${slug}`;
    return values.usr ? `${base}?usr=${values.usr}` : base;
  }, [origin, values.slug, values.usr]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setErrors({});

    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...values,
          slug: hardKey(values.slug),
          usr: hardKey(values.usr),
        }),
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

      // Deliberately no setSubmitting(false) here: the navigation is still in
      // flight, and re-enabling the button invites a second create that fails
      // with "already exists" on a request that actually succeeded.
      router.push('/links');
      router.refresh();
    } catch {
      setFormError('Network error — the link was not created.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-12">
      {/* Live preview — the thing you are actually building */}
      <div className="panel-ink px-5 py-5 sm:px-7 sm:py-6">
        <span className="eyebrow" style={{ color: 'var(--color-paper-3)' }}>
          Your affiliate link
        </span>
        <p className="mt-2 break-all font-mono text-base leading-relaxed sm:text-lg">
          {preview.split('?')[0]}
          {values.usr ? (
            <span style={{ color: 'var(--color-signal-3)' }}>?usr={values.usr}</span>
          ) : null}
        </p>
        <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--color-paper-3)' }}>
          {values.destination
            ? `Fills the form, then forwards to ${values.destination}`
            : 'Add a destination URL below and this link will forward there after the form is filled.'}
        </p>
      </div>

      {formError ? (
        <p
          ref={bannerRef}
          tabIndex={-1}
          role="alert"
          className="border px-4 py-3 text-sm outline-none"
          style={{
            borderColor: 'var(--color-signal)',
            background: 'var(--color-signal-wash)',
            color: 'var(--color-signal-2)',
          }}
        >
          {formError}
        </p>
      ) : null}

      {/* Section 1 — the offer */}
      <Section number="01" title="The offer" caption="Where the lead ends up">
        <Field label="Campaign name" error={errors.campaign} required>
          <input
            className="field-input"
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
          hint="The merchant link, exactly as your affiliate network gave it to you."
          required
        >
          <input
            className="field-input"
            value={values.destination}
            onChange={(e) => set('destination', e.target.value)}
            placeholder="https://www.cardratings.com/bestcards/cash-back-credit-cards.php?src=714025"
            inputMode="url"
            maxLength={2000}
            autoComplete="off"
          />
        </Field>

        <Field
          label="Link slug"
          error={errors.slug}
          hint={`The path on your site — ${origin}/${values.slug || 'cashback'}`}
          required
        >
          <input
            className="field-input font-mono"
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
        </Field>
      </Section>

      {/* Section 2 — the person */}
      <Section number="02" title="The assignee" caption="Who this link belongs to">
        <Field label="Assignee name" error={errors.assignee} hint="Leave blank for a house link.">
          <input
            className="field-input"
            value={values.assignee}
            onChange={(e) => onAssigneeChange(e.target.value)}
            placeholder="Arthur Reyes"
            maxLength={120}
            autoComplete="off"
          />
        </Field>

        <Field
          label="Tracking key (usr)"
          error={errors.usr}
          hint="Appears in the link as ?usr=… and on every logged row."
        >
          <input
            className="field-input font-mono"
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

        <Field label="Assignee email" error={errors.assigneeEmail} hint="Optional, for your records.">
          <input
            className="field-input"
            value={values.assigneeEmail}
            onChange={(e) => set('assigneeEmail', e.target.value)}
            placeholder="arthur@example.com"
            type="email"
            maxLength={160}
            autoComplete="off"
          />
        </Field>
      </Section>

      {/* Section 3 — the landing page */}
      <Section
        number="03"
        title="The landing page"
        caption="What the client sees before being forwarded"
      >
        <Field label="Headline" error={errors.headline} hint="Defaults to the campaign name.">
          <input
            className="field-input"
            value={values.headline}
            onChange={(e) => set('headline', e.target.value)}
            placeholder="Find your best cash back card"
            maxLength={160}
            autoComplete="off"
          />
        </Field>

        <Field label="Sub-headline" error={errors.subheadline}>
          <input
            className="field-input"
            value={values.subheadline}
            onChange={(e) => set('subheadline', e.target.value)}
            placeholder="Tell us where to send your matches and we'll take you straight there."
            maxLength={300}
            autoComplete="off"
          />
        </Field>

        <Field label="Button label" error={errors.ctaLabel}>
          <input
            className="field-input"
            value={values.ctaLabel}
            onChange={(e) => set('ctaLabel', e.target.value)}
            placeholder="See my matches"
            maxLength={60}
            autoComplete="off"
          />
        </Field>

        <div className="sm:col-span-2">
          <Checkbox
            checked={values.requirePhone}
            onChange={(v) => set('requirePhone', v)}
            label="Require a phone number"
            hint="Phone is always shown; this makes it mandatory."
          />
        </div>
      </Section>

      {/* Section 4 — advanced */}
      <Section number="04" title="Tracking & status" caption="Optional">
        <Field
          label="Pass usr to destination as"
          error={errors.passUsrParam}
          hint="Leave blank to forward the destination untouched. Set e.g. subid to append ?subid=arthur."
        >
          <input
            className="field-input font-mono"
            value={values.passUsrParam}
            onChange={(e) => set('passUsrParam', e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))}
            placeholder="subid"
            maxLength={32}
            autoComplete="off"
          />
        </Field>

        <Field label="Internal notes" error={errors.notes}>
          <input
            className="field-input"
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Q3 push — CardRatings"
            maxLength={500}
            autoComplete="off"
          />
        </Field>

        <div className="sm:col-span-2">
          <Checkbox
            checked={values.active}
            onChange={(v) => set('active', v)}
            label="Live immediately"
            hint="Paused links show a 'not available' page instead of the form."
          />
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-4 border-t border-ink pt-6">
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create affiliate link'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={submitting}
          onClick={() => {
            setValues(EMPTY);
            setTouchedSlug(false);
            setTouchedUsr(false);
            setErrors({});
            setFormError(null);
          }}
        >
          Reset
        </button>
        <p className="text-xs text-muted">
          The link is written to your {`Links`} sheet and goes live right away.
        </p>
      </div>
    </form>
  );
}

function Section({
  number,
  title,
  caption,
  children,
}: {
  number: string;
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-6 border-t border-ink pt-5 md:grid-cols-[190px_minmax(0,1fr)] md:gap-10">
      <div className="md:sticky md:top-6 md:self-start">
        <span className="eyebrow">{number}</span>
        <h3 className="mt-1 font-display text-2xl leading-tight">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">{caption}</p>
      </div>
      <div className="grid gap-7 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="field-label">
        {label}
        {required ? <span style={{ color: 'var(--color-signal)' }}> *</span> : null}
      </span>
      {children}
      {error ? (
        <span className="field-error block">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs leading-relaxed text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      {/* The real input is visually hidden, so the focus ring has to be drawn on
          the styled box via peer-focus-visible or keyboard users see nothing. */}
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-signal)]"
        style={{
          borderColor: checked ? 'var(--color-signal)' : 'var(--color-rule)',
          background: checked ? 'var(--color-signal)' : 'transparent',
        }}
        aria-hidden
      >
        {checked ? (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="var(--color-paper)" strokeWidth="2">
            <path d="M2.5 6.5 5 9l4.5-5.5" strokeLinecap="square" />
          </svg>
        ) : null}
      </span>
      <span>
        <span className="text-sm">{label}</span>
        {hint ? <span className="block text-xs leading-relaxed text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
