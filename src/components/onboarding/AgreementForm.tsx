'use client';

import { useRef, useState } from 'react';
import { BusyLabel } from '@/components/Spinner';
import { SignaturePad } from '@/components/SignaturePad';
import {
  AGREEMENT_VERSION,
  CLAUSES,
  clauseText,
  COMPANY,
  governingStateSet,
  PREAMBLE,
  SUMMARY,
  SUMMARY_INTRO,
} from '@/lib/agreement';
import { agreementProblems, type AgreementInput } from '@/lib/onboarding';

/**
 * The agreement, readable and signable on one page.
 *
 * The document is not a PDF in an iframe and not a link to one. Both of those
 * are ways of showing somebody a contract that they will not read, and the
 * whole point of the signature at the bottom is that they did. So it is set as
 * text, in the page, with the blanks as real fields in the places the blanks
 * are — the four at the top and the signature at the end.
 *
 * The Sign button stays disabled until the document has actually been scrolled
 * through. That is not a legal requirement and it is not security; it is the
 * difference between a signature that means something and a click.
 */
export function AgreementForm({
  initialName,
  initialEmail,
  today,
}: {
  initialName: string;
  initialEmail: string;
  /** Yesterday's date on a server in another timezone is not today's date here,
   *  so the default comes from the server that will store it. */
  today: string;
}) {
  const [values, setValues] = useState<AgreementInput>({
    affiliateName: initialName,
    affiliateEmail: initialEmail,
    affiliateAddress: '',
    effectiveDate: today,
    signaturePng: '',
    affirmed: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  function set<K extends keyof AgreementInput>(key: K, value: AgreementInput[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  /** Within a few pixels of the bottom, because a scroll container rarely lands
   *  exactly on it and "almost read it all" is the same as read it all. */
  function onScroll() {
    const el = scroller.current;
    if (!el || read) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setRead(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const problems = agreementProblems(values);
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/onboarding/agreement', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'That did not save.');
        if (data.fields) setErrors(data.fields);
        setBusy(false);
        return;
      }
      globalThis.location.assign(data.next || '/welcome/w9');
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5" noValidate>
      {error ? (
        <p role="alert" className="warn-note mb-5">
          <span aria-hidden className="warn-note-mark">
            ⚠
          </span>
          <span>{error}</span>
        </p>
      ) : null}

      {/* The parties, which are the blanks at the head of the document. */}
      <section className="panel p-6 sm:p-7">
        <h2 className="text-[15px] font-semibold">The parties</h2>
        <p className="plain mt-1">
          These fill in the blanks at the top of the agreement. They appear in the copy you sign.
        </p>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Your full legal name</span>
            <input
              className="field mt-1.5"
              value={values.affiliateName}
              onChange={(e) => set('affiliateName', e.target.value)}
              aria-invalid={errors.affiliateName ? true : undefined}
            />
            {errors.affiliateName ? <span className="field-error">{errors.affiliateName}</span> : null}
          </label>

          <label className="block">
            <span className="field-label">Email</span>
            <input
              className="field mt-1.5"
              type="email"
              value={values.affiliateEmail}
              onChange={(e) => set('affiliateEmail', e.target.value)}
              aria-invalid={errors.affiliateEmail ? true : undefined}
            />
            {errors.affiliateEmail ? (
              <span className="field-error">{errors.affiliateEmail}</span>
            ) : null}
          </label>

          <label className="block sm:col-span-2">
            <span className="field-label">Address</span>
            <textarea
              className="field mt-1.5 min-h-[64px] py-2"
              rows={2}
              value={values.affiliateAddress}
              onChange={(e) => set('affiliateAddress', e.target.value)}
              aria-invalid={errors.affiliateAddress ? true : undefined}
            />
            {errors.affiliateAddress ? (
              <span className="field-error">{errors.affiliateAddress}</span>
            ) : null}
          </label>

          <label className="block">
            <span className="field-label">Effective date</span>
            <input
              className="field mt-1.5"
              type="date"
              value={values.effectiveDate}
              onChange={(e) => set('effectiveDate', e.target.value)}
              aria-invalid={errors.effectiveDate ? true : undefined}
            />
            {errors.effectiveDate ? (
              <span className="field-error">{errors.effectiveDate}</span>
            ) : null}
          </label>

          <div className="block">
            <span className="field-label">Company</span>
            <p className="url-box mt-1.5 font-sans text-[13px] text-ink">
              {COMPANY.name}, {COMPANY.description}
            </p>
          </div>
        </div>
      </section>

      {/* The document itself. */}
      <section className="panel mt-5 overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-b border-edge px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Affiliate agreement</h2>
          <span className="text-[12px] text-ink-dim">
            Version <span className="tnum">{AGREEMENT_VERSION}</span>
          </span>
        </div>

        <div
          ref={scroller}
          onScroll={onScroll}
          tabIndex={0}
          role="region"
          aria-label="Affiliate agreement text"
          className="max-h-[460px] overflow-y-auto px-5 py-5 sm:px-7"
        >
          <h3 className="text-center text-[15px] font-semibold uppercase tracking-[0.06em]">
            Affiliate Agreement
          </h3>
          <p className="mt-1 text-center text-[13px] text-ink-soft">
            Between {COMPANY.name} and{' '}
            <span className="font-semibold text-ink">
              {values.affiliateName.trim() || '________________'}
            </span>
          </p>

          <h4 className="mt-6 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-dim">
            Agreement summary
          </h4>
          <p className="plain mt-1.5">{SUMMARY_INTRO}</p>
          <dl className="mt-3 divide-y divide-edge-faint border-y border-edge-faint">
            {SUMMARY.map((row) => (
              <div key={row.term} className="grid gap-1 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
                <dt className="text-[13px] font-semibold">{row.term}</dt>
                <dd className="text-[13px] leading-relaxed text-ink-soft">{row.details}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-5 text-[13px] leading-relaxed text-ink-soft">{PREAMBLE}</p>

          {CLAUSES.map((clause) => (
            <div key={clause.n} className="mt-5">
              <h4 className="text-[13px] font-semibold">
                {clause.n}. {clause.title}
              </h4>
              {clause.paras.map((para, index) => (
                <p key={index} className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                  {clauseText(para)}
                </p>
              ))}
            </div>
          ))}

          {!governingStateSet() ? (
            <p className="plain-note mt-5">
              The governing state in section 12 has not been filled in on this copy. Ask your admin
              to set it before you rely on that clause.
            </p>
          ) : null}
        </div>

        <p
          className={`border-t px-5 py-2.5 text-[12px] ${
            read
              ? 'border-leaf-edge bg-leaf-wash text-leaf-text'
              : 'border-edge bg-paper-card text-ink-dim'
          }`}
        >
          {read ? '✓ You have read to the end.' : 'Scroll to the end of the agreement to sign it.'}
        </p>
      </section>

      {/* Signing. */}
      <section className="panel mt-5 p-6 sm:p-7">
        <h2 className="text-[15px] font-semibold">Sign</h2>
        <p className="plain mt-1">
          Draw your signature below. We record the time, and the address and browser it came from,
          which is what makes an electronic signature stand up.
        </p>

        <div className="mt-5 max-w-[420px]">
          <SignaturePad
            value={values.signaturePng}
            onChange={(png) => set('signaturePng', png)}
            label="Your signature"
            error={errors.signaturePng}
          />
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={values.affirmed}
            onChange={(e) => set('affirmed', e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-none accent-[var(--color-navy)]"
            aria-invalid={errors.affirmed ? true : undefined}
          />
          <span className="text-[13px] leading-relaxed text-ink-soft">
            I have read the agreement above and I intend the signature I have drawn to be my
            electronic signature on it.
          </span>
        </label>
        {errors.affirmed ? <span className="field-error">{errors.affirmed}</span> : null}

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="submit"
            className="btn-gold"
            disabled={busy || !read}
            aria-busy={busy}
            title={read ? undefined : 'Read to the end of the agreement first.'}
          >
            <BusyLabel busy={busy} idle="Sign and continue" busyLabel="Signing…" />
          </button>
          <span className="text-[12px] text-ink-dim">Next: your W-9.</span>
        </div>
      </section>
    </form>
  );
}
