'use client';

import { useState } from 'react';
import { BusyLabel } from '@/components/Spinner';
import { SignaturePad } from '@/components/SignaturePad';
import { COMPANY } from '@/lib/agreement';
import { formatTin } from '@/lib/mask';
import {
  needsForeignPartnersQuestion,
  w9Problems,
  W9_CLASSIFICATIONS,
  type W9Classification,
  type W9Input,
} from '@/lib/onboarding';

/**
 * Form W-9, rebuilt.
 *
 * The source PDF is a flat scan — six JPEG pages, no text layer, no form
 * fields — so there was nothing to fill in and nothing to extract. This is the
 * layout of page 1 redrawn: the same numbered lines in the same order, the same
 * seven boxes on 3a, the same two-part split, and the Part II certification
 * reproduced word for word. That last one is not decoration. The IRS accepts a
 * substitute Form W-9 only where the certification language is unaltered, so
 * the text below is copied exactly and should not be edited for style.
 *
 * One deliberate departure: the taxpayer number is a single field rather than
 * nine separate digit boxes. Nine inputs looks more like the paper form and is
 * materially worse to use — pasting a number fails, a screen reader announces
 * nine unlabelled fields, and a backspace goes to the wrong place. The nine
 * boxes are on the PDF, where the layout is the artefact and nobody has to type
 * into it.
 */

const IRS_BLACK = 'border-[#0b2239]';

export function W9Form({
  initialName,
  initialAddress,
  today,
}: {
  initialName: string;
  initialAddress: string;
  today: string;
}) {
  const [values, setValues] = useState<W9Input>({
    line1Name: initialName,
    line2Business: '',
    classification: '',
    llcCode: '',
    otherText: '',
    foreignPartners: false,
    exemptPayeeCode: '',
    fatcaCode: '',
    address: initialAddress,
    cityStateZip: '',
    accountNumbers: '',
    tinType: 'ssn',
    tin: '',
    signaturePng: '',
    certified: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof W9Input>(key: K, value: W9Input[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  function chooseClassification(key: W9Classification) {
    setValues((current) => ({
      ...current,
      classification: key,
      // The extras belong to one box each. Leaving a stale letter behind would
      // send an LLC code on a form that no longer claims to be an LLC.
      llcCode: key === 'llc' ? current.llcCode : '',
      otherText: key === 'other' ? current.otherText : '',
      foreignPartners: needsForeignPartnersQuestion(key, key === 'llc' ? current.llcCode : '')
        ? current.foreignPartners
        : false,
    }));
    setErrors({});
  }

  const showForeign = values.classification
    ? needsForeignPartnersQuestion(values.classification, values.llcCode)
    : false;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const problems = w9Problems(values);
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/onboarding/w9', {
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
      globalThis.location.assign(data.next || '/welcome/bank');
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

      <div className={`border bg-panel ${IRS_BLACK}`}>
        {/* ---- Masthead ------------------------------------------------- */}
        <div className={`flex flex-col border-b sm:flex-row ${IRS_BLACK}`}>
          <div className={`border-b px-4 py-3 sm:w-[200px] sm:border-b-0 sm:border-r ${IRS_BLACK}`}>
            <p className="flex items-baseline gap-2">
              <span className="text-[11px]">Form</span>
              <span className="text-[30px] font-bold leading-none tracking-[-0.02em]">W-9</span>
            </p>
            <p className="mt-1 text-[11px]">(Rev. March 2024)</p>
            <p className="mt-1.5 text-[11px] leading-tight">
              Department of the Treasury
              <br />
              Internal Revenue Service
            </p>
          </div>

          <div className="flex-1 px-4 py-3 text-center">
            <p className="text-[16px] font-bold leading-tight">
              Request for Taxpayer
              <br />
              Identification Number and Certification
            </p>
            <p className="mt-1.5 text-[12px]">
              Go to <em>www.irs.gov/FormW9</em> for instructions and the latest information.
            </p>
          </div>

          <div className={`border-t px-4 py-3 sm:w-[170px] sm:border-l sm:border-t-0 ${IRS_BLACK}`}>
            <p className="text-[12px] font-bold leading-tight">
              Give form to the requester. Do not send to the IRS.
            </p>
          </div>
        </div>

        {/* ---- Lines 1 and 2 -------------------------------------------- */}
        <div className={`border-b px-4 py-3 ${IRS_BLACK}`}>
          <Line n="1">
            Name of entity/individual. An entry is required. (For a sole proprietor or disregarded
            entity, enter the owner’s name on line 1, and enter the business/disregarded entity’s
            name on line 2.)
          </Line>
          <input
            className="mt-2 w-full border-0 border-b border-edge-strong bg-transparent px-1 py-1 text-[14px] outline-none focus:border-link"
            value={values.line1Name}
            onChange={(e) => set('line1Name', e.target.value)}
            aria-label="Line 1, name of entity or individual"
            aria-invalid={errors.line1Name ? true : undefined}
          />
          {errors.line1Name ? <span className="field-error">{errors.line1Name}</span> : null}
        </div>

        <div className={`border-b px-4 py-3 ${IRS_BLACK}`}>
          <Line n="2">Business name/disregarded entity name, if different from above.</Line>
          <input
            className="mt-2 w-full border-0 border-b border-edge-strong bg-transparent px-1 py-1 text-[14px] outline-none focus:border-link"
            value={values.line2Business}
            onChange={(e) => set('line2Business', e.target.value)}
            aria-label="Line 2, business name"
          />
        </div>

        {/* ---- Line 3a and the exemption column ------------------------- */}
        <div className={`flex flex-col border-b lg:flex-row ${IRS_BLACK}`}>
          <fieldset className="min-w-0 flex-1 px-4 py-3">
            <legend className="sr-only">Line 3a, federal tax classification</legend>
            <Line n="3a">
              Check the appropriate box for federal tax classification of the entity/individual whose
              name is entered on line 1. Check only <strong>one</strong> of the following seven boxes.
            </Line>

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2.5">
              {W9_CLASSIFICATIONS.map((option) => (
                <label key={option.key} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="classification"
                    checked={values.classification === option.key}
                    onChange={() => chooseClassification(option.key)}
                    className="h-3.5 w-3.5 flex-none accent-[var(--color-navy)]"
                  />
                  <span className="text-[13px]">{option.label}</span>
                </label>
              ))}
            </div>
            {errors.classification ? (
              <span className="field-error">{errors.classification}</span>
            ) : null}

            {values.classification === 'llc' ? (
              <div className="mt-3">
                <label className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px]">
                    Enter the tax classification (C = C corporation, S = S corporation, P =
                    Partnership)
                  </span>
                  <input
                    className="w-[52px] border-0 border-b border-edge-strong bg-transparent px-1 py-0.5 text-center text-[14px] uppercase outline-none focus:border-link"
                    maxLength={1}
                    value={values.llcCode}
                    onChange={(e) => set('llcCode', e.target.value.toUpperCase().replace(/[^CSP]/g, ''))}
                    aria-label="LLC tax classification letter"
                    aria-invalid={errors.llcCode ? true : undefined}
                  />
                </label>
                <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
                  <strong>Note:</strong> Check the “LLC” box above and, in the entry space, enter the
                  appropriate code (C, S, or P) for the tax classification of the LLC, unless it is a
                  disregarded entity. A disregarded entity should instead check the appropriate box
                  for the tax classification of its owner.
                </p>
                {errors.llcCode ? <span className="field-error">{errors.llcCode}</span> : null}
              </div>
            ) : null}

            {values.classification === 'other' ? (
              <div className="mt-3">
                <label className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px]">Other (see instructions)</span>
                  <input
                    className="min-w-[200px] flex-1 border-0 border-b border-edge-strong bg-transparent px-1 py-0.5 text-[14px] outline-none focus:border-link"
                    value={values.otherText}
                    onChange={(e) => set('otherText', e.target.value)}
                    aria-label="Other classification"
                    aria-invalid={errors.otherText ? true : undefined}
                  />
                </label>
                {errors.otherText ? <span className="field-error">{errors.otherText}</span> : null}
              </div>
            ) : null}
          </fieldset>

          <div className={`border-t px-4 py-3 lg:w-[280px] lg:border-l lg:border-t-0 ${IRS_BLACK}`}>
            <Line n="4">
              Exemptions (codes apply only to certain entities, not individuals; see instructions on
              page 3):
            </Line>
            <label className="mt-3 block">
              <span className="text-[12px]">Exempt payee code (if any)</span>
              <input
                className="mt-1 w-full border-0 border-b border-edge-strong bg-transparent px-1 py-0.5 text-[14px] outline-none focus:border-link"
                value={values.exemptPayeeCode}
                onChange={(e) => set('exemptPayeeCode', e.target.value)}
              />
            </label>
            <label className="mt-3 block">
              <span className="text-[12px]">
                Exemption from Foreign Account Tax Compliance Act (FATCA) reporting code (if any)
              </span>
              <input
                className="mt-1 w-full border-0 border-b border-edge-strong bg-transparent px-1 py-0.5 text-[14px] outline-none focus:border-link"
                value={values.fatcaCode}
                onChange={(e) => set('fatcaCode', e.target.value)}
              />
            </label>
            <p className="mt-2 text-[11px] italic text-ink-soft">
              (Applies to accounts maintained outside the United States.)
            </p>
          </div>
        </div>

        {/* ---- Line 3b -------------------------------------------------- */}
        {showForeign ? (
          <div className={`border-b px-4 py-3 ${IRS_BLACK}`}>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={values.foreignPartners}
                onChange={(e) => set('foreignPartners', e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-none accent-[var(--color-navy)]"
              />
              <span className="text-[13px] leading-relaxed">
                <strong>3b</strong> If on line 3a you checked “Partnership” or “Trust/estate,” or
                checked “LLC” and entered “P” as its tax classification, and you are providing this
                form to a partnership, trust, or estate in which you have an ownership interest,
                check this box if you have any foreign partners, owners, or beneficiaries. See
                instructions.
              </span>
            </label>
          </div>
        ) : null}

        {/* ---- Lines 5, 6, 7 -------------------------------------------- */}
        <div className={`flex flex-col border-b lg:flex-row ${IRS_BLACK}`}>
          <div className="min-w-0 flex-1">
            <div className={`border-b px-4 py-3 ${IRS_BLACK}`}>
              <Line n="5">Address (number, street, and apt. or suite no.). See instructions.</Line>
              <input
                className="mt-2 w-full border-0 border-b border-edge-strong bg-transparent px-1 py-1 text-[14px] outline-none focus:border-link"
                value={values.address}
                onChange={(e) => set('address', e.target.value)}
                aria-label="Line 5, address"
                aria-invalid={errors.address ? true : undefined}
              />
              {errors.address ? <span className="field-error">{errors.address}</span> : null}
            </div>
            <div className="px-4 py-3">
              <Line n="6">City, state, and ZIP code</Line>
              <input
                className="mt-2 w-full border-0 border-b border-edge-strong bg-transparent px-1 py-1 text-[14px] outline-none focus:border-link"
                value={values.cityStateZip}
                onChange={(e) => set('cityStateZip', e.target.value)}
                aria-label="Line 6, city, state and ZIP"
                aria-invalid={errors.cityStateZip ? true : undefined}
              />
              {errors.cityStateZip ? <span className="field-error">{errors.cityStateZip}</span> : null}
            </div>
          </div>

          {/* Prefilled and not editable: the requester is us, and this is the
              one box on the form whose answer we already know. */}
          <div className={`border-t px-4 py-3 lg:w-[280px] lg:border-l lg:border-t-0 ${IRS_BLACK}`}>
            <p className="text-[12px]">Requester’s name and address (optional)</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{COMPANY.name}</p>
          </div>
        </div>

        <div className={`border-b px-4 py-3 ${IRS_BLACK}`}>
          <Line n="7">List account number(s) here (optional)</Line>
          <input
            className="mt-2 w-full border-0 border-b border-edge-strong bg-transparent px-1 py-1 text-[14px] outline-none focus:border-link"
            value={values.accountNumbers}
            onChange={(e) => set('accountNumbers', e.target.value)}
            aria-label="Line 7, account numbers"
          />
        </div>

        {/* ---- Part I --------------------------------------------------- */}
        <PartHeader label="Part I" title="Taxpayer Identification Number (TIN)" />

        <div className={`flex flex-col border-b lg:flex-row ${IRS_BLACK}`}>
          <div className="min-w-0 flex-1 px-4 py-3">
            <p className="text-[12px] leading-relaxed">
              Enter your TIN in the appropriate box. The TIN provided must match the name given on
              line 1 to avoid backup withholding. For individuals, this is generally your social
              security number (SSN). However, for a resident alien, sole proprietor, or disregarded
              entity, see the instructions for Part I, later. For other entities, it is your employer
              identification number (EIN). If you do not have a number, see <em>How to get a TIN</em>,
              later.
            </p>
            <p className="mt-2.5 text-[12px] leading-relaxed">
              <strong>Note:</strong> If the account is in more than one name, see the instructions for
              line 1. See also <em>What Name and Number To Give the Requester</em> for guidelines on
              whose number to enter.
            </p>
          </div>

          <div className={`border-t px-4 py-3 lg:w-[300px] lg:border-l lg:border-t-0 ${IRS_BLACK}`}>
            <div className="flex gap-4">
              {(['ssn', 'ein'] as const).map((type) => (
                <label key={type} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="tinType"
                    checked={values.tinType === type}
                    onChange={() => {
                      set('tinType', type);
                      set('tin', '');
                    }}
                    className="h-3.5 w-3.5 flex-none accent-[var(--color-navy)]"
                  />
                  <span className="text-[12px] font-semibold">
                    {type === 'ssn' ? 'Social security number' : 'Employer identification number'}
                  </span>
                </label>
              ))}
            </div>

            {/* One field, not nine boxes. See the note at the top of this file. */}
            <input
              className={`tnum mt-3 w-full border px-3 py-2 text-[18px] tracking-[0.18em] outline-none focus:border-link ${
                errors.tin || errors.tinType ? 'border-alarm' : 'border-[#0b2239]'
              }`}
              inputMode="numeric"
              autoComplete="off"
              placeholder={values.tinType === 'ssn' ? '123-45-6789' : '12-3456789'}
              value={values.tin}
              onChange={(e) => set('tin', e.target.value.replace(/[^\d-]/g, ''))}
              onBlur={() => set('tin', formatTin(values.tin, values.tinType || 'ssn'))}
              aria-label={
                values.tinType === 'ssn' ? 'Social security number' : 'Employer identification number'
              }
              aria-invalid={errors.tin ? true : undefined}
            />
            {errors.tin ? <span className="field-error">{errors.tin}</span> : null}
            {errors.tinType ? <span className="field-error">{errors.tinType}</span> : null}
            <p className="mt-2 text-[11px] text-ink-dim">
              Stored encrypted. Only the last four digits are ever shown back.
            </p>
          </div>
        </div>

        {/* ---- Part II -------------------------------------------------- */}
        <PartHeader label="Part II" title="Certification" />

        <div className={`border-b px-4 py-3 ${IRS_BLACK}`}>
          {/*
            Verbatim from the form. A substitute W-9 is only acceptable where
            this language is unaltered — do not reword it.
          */}
          <p className="text-[12px] font-semibold">Under penalties of perjury, I certify that:</p>
          <ol className="mt-2 space-y-1.5 text-[12px] leading-relaxed">
            <li>
              1. The number shown on this form is my correct taxpayer identification number (or I am
              waiting for a number to be issued to me); and
            </li>
            <li>
              2. I am not subject to backup withholding because (a) I am exempt from backup
              withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that
              I am subject to backup withholding as a result of a failure to report all interest or
              dividends, or (c) the IRS has notified me that I am no longer subject to backup
              withholding; and
            </li>
            <li>3. I am a U.S. citizen or other U.S. person (defined below); and</li>
            <li>
              4. The FATCA code(s) entered on this form (if any) indicating that I am exempt from
              FATCA reporting is correct.
            </li>
          </ol>
          <p className="mt-2.5 text-[12px] leading-relaxed">
            <strong>Certification instructions.</strong> You must cross out item 2 above if you have
            been notified by the IRS that you are currently subject to backup withholding because you
            have failed to report all interest and dividends on your tax return. For real estate
            transactions, item 2 does not apply. For mortgage interest paid, acquisition or
            abandonment of secured property, cancellation of debt, contributions to an individual
            retirement arrangement (IRA), and, generally, payments other than interest and dividends,
            you are not required to sign the certification, but you must provide your correct TIN. See
            the instructions for Part II, later.
          </p>
        </div>

        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-end">
          <div className="flex-none sm:w-[70px]">
            <p className="text-[15px] font-bold leading-tight">
              Sign
              <br />
              Here
            </p>
          </div>
          <div className="min-w-0 flex-1">
            <SignaturePad
              value={values.signaturePng}
              onChange={(png) => set('signaturePng', png)}
              label="Signature of U.S. person"
              error={errors.signaturePng}
            />
          </div>
          <div className="flex-none sm:w-[150px]">
            <span className="field-label">Date</span>
            <p className="url-box mt-1.5 font-sans text-[13px] text-ink">{today}</p>
          </div>
        </div>
      </div>

      <label className="mt-5 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={values.certified}
          onChange={(e) => set('certified', e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-none accent-[var(--color-navy)]"
          aria-invalid={errors.certified ? true : undefined}
        />
        <span className="text-[13px] leading-relaxed text-ink-soft">
          Under penalties of perjury, I certify that the statements in Part II above are true, and I
          intend the signature I have drawn to be my electronic signature on this form.
        </span>
      </label>
      {errors.certified ? <span className="field-error">{errors.certified}</span> : null}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button type="submit" className="btn-gold" disabled={busy} aria-busy={busy}>
          <BusyLabel busy={busy} idle="Submit W-9" busyLabel="Submitting…" />
        </button>
        <span className="text-[12px] text-ink-dim">Next: where to send the money.</span>
      </div>
    </form>
  );
}

/** A numbered line label, set the way the paper form sets them. */
function Line({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <p className="flex gap-2 text-[12px] leading-relaxed">
      <span className="flex-none font-semibold">{n}</span>
      <span>{children}</span>
    </p>
  );
}

/** The black tab that separates the two halves of the form. */
function PartHeader({ label, title }: { label: string; title: string }) {
  return (
    <div className={`flex items-stretch border-b ${IRS_BLACK}`}>
      <span className="flex items-center bg-navy px-3 py-1.5 text-[13px] font-bold text-white">
        {label}
      </span>
      <span className="flex items-center px-3 py-1.5 text-[14px] font-bold">{title}</span>
    </div>
  );
}
