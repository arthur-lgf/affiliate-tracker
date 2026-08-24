import type { Metadata } from 'next';
import { OnboardingRail } from '@/components/OnboardingRail';
import { W9Form } from '@/components/onboarding/W9Form';
import { requireStep } from '@/lib/onboarding-guard';
import { readAgreement } from '@/lib/onboarding-store';
import { findUserById } from '@/lib/users';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Form W-9' };

export default async function W9Page() {
  const { viewer, state } = await requireStep('w9');
  const account = await findUserById(viewer.id).catch(() => null);
  // The address they typed one step ago. Asking for it twice on consecutive
  // screens is how a form earns the reputation of not paying attention.
  const agreement = await readAgreement(viewer.id).catch(() => null);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="rise">
        <p className="label-cap">Step 3 of 4</p>
        <h1 className="mt-1.5 font-display text-[26px] leading-[1.15]">Form W-9</h1>
        <p className="plain mt-2.5">
          The IRS form every US contractor files with whoever pays them. It is what lets us issue a
          1099 at the end of the year, and section 2 of the agreement you just signed makes it a
          condition of being paid at all.
        </p>
        <p className="plain-note mt-4">
          Your taxpayer number is encrypted before it is stored and is never shown back to anyone in
          full — not on this screen, not to an admin, not in a list. If you would rather read the
          IRS’s own instructions first, they are at <em>www.irs.gov/FormW9</em>.
        </p>
      </div>

      <div className="mt-6">
        <OnboardingRail current="w9" state={state} />
      </div>

      <W9Form
        initialName={agreement?.affiliateName || account?.fullName || ''}
        initialAddress={agreement?.affiliateAddress ?? ''}
        today={today}
      />
    </div>
  );
}
