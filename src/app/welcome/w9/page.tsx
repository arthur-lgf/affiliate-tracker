import { cityStateZip } from '@/lib/address';
import type { Metadata } from 'next';
import { OnboardingRail } from '@/components/OnboardingRail';
import { W9Form, type W9Prefill } from '@/components/onboarding/W9Form';
import { LockedDocument } from '@/components/onboarding/LockedDocument';
import { RevisitNotice } from '@/components/onboarding/StepControls';
import { formatDateTime } from '@/lib/analytics';
import { isBypassed } from '@/lib/approval';
import { maskTin } from '@/lib/mask';
import {
  nextStep,
  previousStep,
  W9_CLASSIFICATIONS,
  type W9Classification,
} from '@/lib/onboarding';
import { requireStep } from '@/lib/onboarding-guard';
import { readAgreement, readW9 } from '@/lib/onboarding-store';
import { findUserById } from '@/lib/users';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Form W-9' };

export default async function W9Page() {
  const { viewer, state, revisiting, bypass, locked } = await requireStep('w9');
  /*
   * Only ever true here for somebody who signed this before the waiver was
   * granted: canOpen refuses a waived account any document it has not already
   * signed. So this page is a record to read, not a step in a flow, and the
   * rail and the step number would both be describing a queue they are not in.
   */
  const waived = isBypassed(bypass);
  const account = await findUserById(viewer.id).catch(() => null);
  // The address they typed one step ago. Asking for it twice on consecutive
  // screens is how a form earns the reputation of not paying attention.
  const agreement = await readAgreement(viewer.id).catch(() => null);
  const filed = revisiting ? await readW9(viewer.id).catch(() => null) : null;

  // Every field except the number itself, which nothing can read back.
  const existing: W9Prefill | null = filed
    ? {
        line1Name: filed.line1Name,
        line2Business: filed.line2Business,
        classification: filed.classification as W9Classification | '',
        llcCode: filed.llcCode,
        otherText: filed.otherText,
        foreignPartners: filed.foreignPartners,
        exemptPayeeCode: filed.exemptPayeeCode,
        fatcaCode: filed.fatcaCode,
        address: filed.address,
        cityStateZip: filed.cityStateZip,
        accountNumbers: filed.accountNumbers,
        tinType: filed.tinType,
        tinLast4: filed.tinLast4,
        signaturePng: filed.signaturePng,
      }
    : null;

  const today = new Date().toISOString().slice(0, 10);
  const back = previousStep('w9', { bypassed: waived });
  const onward = nextStep(state, { bypassed: waived });

  /*
   * Line 5 of the W-9 is the street and line 6 is the city, state and ZIP,
   * which is exactly the split the agreement now collects. It used to arrive
   * as one string that had to go somewhere, so all of it went on line 5.
   */
  const street = agreement
    ? [agreement.address.line1, agreement.address.line2].filter(Boolean).join(', ')
    : '';

  // Settled. See the same branch on the agreement page for why this replaces
  // the form rather than disabling it.
  if (locked) {
    const classification = W9_CLASSIFICATIONS.find((entry) => entry.key === filed?.classification);
    return (
      <div>
        <div className="rise">
          <p className="label-cap">On file</p>
          <h1 className="mt-1.5 font-display text-[26px] leading-[1.15]">Form W-9</h1>
          <p className="plain mt-2.5">
            This is the W-9 you filed. The PDF is the whole form, all six pages, with your answers
            on the first one.
          </p>
        </div>

        <LockedDocument
          title="Filed"
          savedAt={filed ? formatDateTime(filed.signedAt) : ''}
          note="It is on file as part of your account now, so it stays as it is. Ask an admin if anything on it needs correcting."
          facts={[
            { label: 'Line 1, name', value: filed?.line1Name ?? '' },
            { label: 'Line 2, business', value: filed?.line2Business || 'None' },
            {
              label: 'Federal tax classification',
              value: classification
                ? classification.label + (filed?.llcCode ? ` (${filed.llcCode})` : '')
                : (filed?.classification ?? ''),
            },
            {
              label: filed?.tinType === 'ein' ? 'Employer identification number' : 'Social security number',
              value: filed ? maskTin(filed.tinLast4, filed.tinType) : '',
            },
            { label: 'Address', value: filed?.address ?? '' },
            { label: 'City, state, ZIP', value: filed?.cityStateZip ?? '' },
          ]}
          signaturePng={filed?.signaturePng}
          downloadHref={`/api/onboarding/${encodeURIComponent(viewer.id)}/w9.pdf`}
          onward={{ path: '/profile', label: 'Back to your profile' }}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="rise">
        <p className="label-cap">{waived ? 'On file' : 'Step 3 of 4'}</p>
        <h1 className="mt-1.5 font-display text-[26px] leading-[1.15]">Form W-9</h1>
        <p className="plain mt-2.5">
          The IRS form every US contractor files with whoever pays them. It is what lets us issue a
          1099 at the end of the year, and section 2 of the agreement you just signed makes it a
          condition of being paid at all.
        </p>
        <p className="plain-note mt-4">
          Your taxpayer number is encrypted before it is stored and is never shown back to anyone
          in full: not on this screen, not to an admin, not in a list. If you would rather read the
          IRS’s own instructions first, they are at <em>www.irs.gov/FormW9</em>.
        </p>
      </div>

      {waived ? (
        <p className="plain-note mt-6">
          This is waived for your account, so nothing here is being asked of you. It is kept because
          you signed it, and you can read it back whenever you like.
        </p>
      ) : (
        <div className="mt-6">
          <OnboardingRail current="w9" state={state} />
        </div>
      )}

      {revisiting ? (
        <RevisitNotice
          savedAt={filed ? formatDateTime(filed.signedAt) : undefined}
          what="This is the W-9 on file, filled in as you filed it."
          resign
        />
      ) : null}

      <W9Form
        initialName={agreement?.affiliateName || account?.fullName || ''}
        initialAddress={street}
        initialCityStateZip={agreement ? cityStateZip(agreement.address) : ''}
        today={today}
        existing={existing}
        revisiting={revisiting}
        backTo={back ? { path: back.path, label: back.label } : undefined}
        continueTo={onward?.path ?? '/'}
        continueLabel={onward ? `Continue to ${onward.label.toLowerCase()}` : 'Go to the dashboard'}
      />
    </div>
  );
}
