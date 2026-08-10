'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  slug: string;
  usr: string;
  requirePhone: boolean;
  ctaLabel: string;
};

export function LeadForm({ slug, usr, requirePhone, ctaLabel }: Props) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState(''); // honeypot
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'redirecting'>('idle');
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const beaconSent = useRef(false);
  const doneRef = useRef<HTMLDivElement | null>(null);

  // Move focus to the confirmation so screen-reader users are told what
  // happened instead of being dropped on <body> mid-redirect.
  useEffect(() => {
    if (status === 'redirecting') doneRef.current?.focus();
  }, [status]);

  // Log the page view once, without blocking render. React 18+ dev mode runs
  // effects twice, hence the ref guard.
  useEffect(() => {
    if (beaconSent.current) return;
    beaconSent.current = true;
    const body = JSON.stringify({ slug, usr });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/visits', new Blob([body], { type: 'application/json' }));
      } else {
        void fetch('/api/visits', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        });
      }
    } catch {
      // Visit logging is best-effort; never surface it to the visitor.
    }
  }, [slug, usr]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (fullName.trim().length < 2) next.fullName = 'Please enter your full name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      next.email = 'Please enter a valid email address';
    }
    if (requirePhone && phone.trim().length < 7) next.phone = 'Please enter a phone number';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setStatus('saving');
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, usr, fullName, email, phone, company }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        const fields = (payload.fields ?? {}) as Record<string, string>;
        setErrors(fields);
        // slug/usr errors belong to the URL, not to anything on screen. Without
        // surfacing them the visitor sees a form that silently refuses to submit.
        const rendered = new Set(['fullName', 'email', 'phone']);
        const unrendered = Object.entries(fields)
          .filter(([key]) => !rendered.has(key))
          .map(([, message]) => message);
        setFormError(
          unrendered.length > 0
            ? `There's a problem with this link: ${unrendered.join(' ')} Please ask for a fresh one.`
            : (payload.error ?? 'We could not save your details. Please try again.'),
        );
        setStatus('idle');
        return;
      }

      const target: string | undefined = payload.redirectUrl;
      if (!target) {
        setFormError('Saved, but no destination was configured for this link.');
        setStatus('idle');
        return;
      }

      setRedirectUrl(target);
      setStatus('redirecting');
      window.location.assign(target);
    } catch {
      setFormError('Network error — please check your connection and try again.');
      setStatus('idle');
    }
  }

  if (status === 'redirecting') {
    return (
      <div
        ref={doneRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="py-10 text-center outline-none"
      >
        <div className="mx-auto mb-6 h-px w-24 overflow-hidden bg-rule">
          <div className="draw-loop h-full w-full bg-signal" />
        </div>
        <p className="font-display text-3xl">Thanks, {fullName.trim().split(' ')[0]}.</p>
        <p className="mt-2 text-sm text-ink-2">Taking you there now…</p>
        {redirectUrl ? (
          <a
            href={redirectUrl}
            className="mt-6 inline-block font-mono text-[0.6875rem] uppercase tracking-[0.14em] underline decoration-rule underline-offset-4 hover:text-signal"
          >
            Continue manually ↗
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-7">
      {formError ? (
        <p
          role="alert"
          className="border px-4 py-3 text-sm"
          style={{
            borderColor: 'var(--color-signal)',
            background: 'var(--color-signal-wash)',
            color: 'var(--color-signal-2)',
          }}
        >
          {formError}
        </p>
      ) : null}

      <LeadField label="Full name" error={errors.fullName} htmlFor="fullName">
        <input
          id="fullName"
          name="name"
          aria-invalid={Boolean(errors.fullName)}
          aria-describedby={errors.fullName ? 'fullName-error' : undefined}
          className="field-input"
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            setErrors((prev) => ({ ...prev, fullName: '' }));
          }}
          placeholder="Arthur Reyes"
          autoComplete="name"
          maxLength={120}
          required
        />
      </LeadField>

      <LeadField label="Email address" error={errors.email} htmlFor="email">
        <input
          id="email"
          name="email"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'email-error' : undefined}
          type="email"
          className="field-input"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErrors((prev) => ({ ...prev, email: '' }));
          }}
          placeholder="you@example.com"
          autoComplete="email"
          inputMode="email"
          maxLength={160}
          required
        />
      </LeadField>

      <LeadField
        label={requirePhone ? 'Phone number' : 'Phone number (optional)'}
        error={errors.phone}
        htmlFor="phone"
      >
        <input
          id="phone"
          name="tel"
          aria-invalid={Boolean(errors.phone)}
          aria-describedby={errors.phone ? 'phone-error' : undefined}
          type="tel"
          className="field-input"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setErrors((prev) => ({ ...prev, phone: '' }));
          }}
          placeholder="(555) 010-4477"
          autoComplete="tel"
          inputMode="tel"
          maxLength={40}
          required={requirePhone}
        />
      </LeadField>

      {/* Honeypot — hidden from people, irresistible to bots. Deliberately NOT
          named "company"/"organization": those are autofill categories, and a
          browser filling this field would silently discard a real lead. */}
      <div aria-hidden className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="lf-ref-code">Leave this field empty</label>
        <input
          id="lf-ref-code"
          name="lf_ref_code"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
      </div>

      <button type="submit" className="btn w-full !py-4" disabled={status === 'saving'}>
        {status === 'saving' ? 'Saving…' : ctaLabel}
      </button>

      <p className="text-center text-xs leading-relaxed text-muted">
        We only use your details to follow up about this offer. You&rsquo;ll be taken to the offer
        page right after.
      </p>
    </form>
  );
}

function LeadField({
  label,
  error,
  htmlFor,
  children,
}: {
  label: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span id={`${htmlFor}-error`} role="alert" className="field-error block">
          {error}
        </span>
      ) : null}
    </div>
  );
}
