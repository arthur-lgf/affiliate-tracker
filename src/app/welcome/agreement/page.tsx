import type { Metadata } from 'next';
import { OnboardingRail } from '@/components/OnboardingRail';
import { AgreementForm } from '@/components/onboarding/AgreementForm';
import { requireStep } from '@/lib/onboarding-guard';
import { findUserById } from '@/lib/users';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Affiliate agreement' };

export default async function AgreementPage() {
  const { viewer, state } = await requireStep('agreement');
  const account = await findUserById(viewer.id).catch(() => null);

  // Formatted here rather than in the browser: a date input wants YYYY-MM-DD,
  // and the browser's idea of today is the visitor's timezone while the row it
  // lands in is stamped by the server's.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="rise">
        <p className="label-cap">Step 2 of 4</p>
        <h1 className="mt-1.5 font-display text-[26px] leading-[1.15]">The affiliate agreement</h1>
        <p className="plain mt-2.5">
          Read it, fill in the four blanks at the top, and sign at the bottom. You will be able to
          download a copy of what you signed at any time.
        </p>
      </div>

      <div className="mt-6">
        <OnboardingRail current="agreement" state={state} />
      </div>

      <AgreementForm
        initialName={account?.fullName ?? ''}
        initialEmail={account?.email ?? ''}
        today={today}
      />
    </div>
  );
}
