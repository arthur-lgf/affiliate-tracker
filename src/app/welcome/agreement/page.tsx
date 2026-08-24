import type { Metadata } from 'next';
import { OnboardingRail } from '@/components/OnboardingRail';
import { AgreementForm } from '@/components/onboarding/AgreementForm';
import { RevisitNotice } from '@/components/onboarding/StepControls';
import { formatDateTime } from '@/lib/analytics';
import { nextStep, previousStep } from '@/lib/onboarding';
import { requireStep } from '@/lib/onboarding-guard';
import { readAgreement } from '@/lib/onboarding-store';
import { findUserById } from '@/lib/users';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Affiliate agreement' };

export default async function AgreementPage() {
  const { viewer, state, revisiting } = await requireStep('agreement');
  const account = await findUserById(viewer.id).catch(() => null);

  // Only read when there is something to read. On a first pass this is a row
  // that does not exist yet, and asking for it would be a round trip to be told
  // so.
  const existing = revisiting ? await readAgreement(viewer.id).catch(() => null) : null;

  // Formatted here rather than in the browser: a date input wants YYYY-MM-DD,
  // and the browser's idea of today is the visitor's timezone while the row it
  // lands in is stamped by the server's.
  const today = new Date().toISOString().slice(0, 10);

  const back = previousStep('agreement');
  const onward = nextStep(state);

  return (
    <div>
      <div className="rise">
        <p className="label-cap">Step 2 of 4</p>
        <h1 className="mt-1.5 font-display text-[26px] leading-[1.15]">The affiliate agreement</h1>
        <p className="plain mt-2.5">
          {revisiting
            ? 'The agreement you signed, and the details it was signed with. Read it as often as you like. It only changes if you sign it again.'
            : 'Read it, fill in the four blanks at the top, and sign at the bottom. You will be able to download a copy of what you signed at any time.'}
        </p>
      </div>

      <div className="mt-6">
        <OnboardingRail current="agreement" state={state} />
      </div>

      {revisiting ? (
        <RevisitNotice
          savedAt={existing ? formatDateTime(existing.signedAt) : undefined}
          what="These are the details it was signed with."
          resign
        />
      ) : null}

      <AgreementForm
        initialName={existing?.affiliateName || account?.fullName || ''}
        initialEmail={existing?.affiliateEmail || account?.email || ''}
        initialAddress={existing?.affiliateAddress ?? ''}
        today={existing?.effectiveDate || today}
        previousSignature={existing?.signaturePng ?? ''}
        revisiting={revisiting}
        backTo={back ? { path: back.path, label: back.label } : undefined}
        continueTo={onward?.path ?? '/'}
        continueLabel={onward ? `Continue to ${onward.label.toLowerCase()}` : 'Go to the dashboard'}
      />
    </div>
  );
}
