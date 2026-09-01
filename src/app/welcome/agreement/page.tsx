import type { Metadata } from 'next';
import { OnboardingRail } from '@/components/OnboardingRail';
import { AgreementForm } from '@/components/onboarding/AgreementForm';
import { LockedDocument } from '@/components/onboarding/LockedDocument';
import { RevisitNotice } from '@/components/onboarding/StepControls';
import { formatDateTime } from '@/lib/analytics';
import { isBypassed } from '@/lib/approval';
import { nextStep, previousStep, WAIVED_HOME } from '@/lib/onboarding';
import { requireStep } from '@/lib/onboarding-guard';
import { readAgreement } from '@/lib/onboarding-store';
import { findUserById } from '@/lib/users';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Affiliate agreement' };

export default async function AgreementPage() {
  const { viewer, state, revisiting, bypass, locked } = await requireStep('agreement');
  /*
   * Waived: nobody is waiting on this one. The page still works, because a
   * waiver removes the obligation rather than the form, but the rail and the
   * step number would both be describing a queue this person is not in.
   */
  const waived = isBypassed(bypass);
  const account = await findUserById(viewer.id).catch(() => null);

  // Only read when there is something to read. On a first pass this is a row
  // that does not exist yet, and asking for it would be a round trip to be told
  // so.
  const existing = revisiting ? await readAgreement(viewer.id).catch(() => null) : null;

  // Formatted here rather than in the browser: a date input wants YYYY-MM-DD,
  // and the browser's idea of today is the visitor's timezone while the row it
  // lands in is stamped by the server's.
  const today = new Date().toISOString().slice(0, 10);

  /*
   * Back goes where they came from. A waived account is not walking the queue,
   * so there is no step behind this one; what there is, is the list on their
   * profile that sent them here, and a page with no way back is a dead end.
   */
  const back = waived
    ? { path: WAIVED_HOME, label: 'Your profile' }
    : previousStep('agreement');
  const onward = nextStep(state, { bypassed: waived });

  /*
   * Settled: signed, and then either approved or waived through. What is shown
   * is the copy on file and the file itself. Rendering the form with its fields
   * disabled would be worse than this in every way — it would still look like
   * somewhere to type, and the only way to learn otherwise would be to fill it
   * in and be refused.
   */
  if (locked) {
    return (
      <div>
        <div className="rise">
          <p className="label-cap">On file</p>
          <h1 className="mt-1.5 font-display text-[26px] leading-[1.15]">The affiliate agreement</h1>
          <p className="plain mt-2.5">
            This is the agreement you signed and the details it was signed with. It is yours to read
            and to download whenever you need a copy.
          </p>
        </div>

        <LockedDocument
          title="Signed"
          savedAt={existing ? formatDateTime(existing.signedAt) : ''}
          note="It is on file as part of your account now, so it stays as it is. Ask an admin if anything on it needs correcting."
          facts={[
            { label: 'Name signed', value: existing?.affiliateName ?? '' },
            { label: 'Email on the agreement', value: existing?.affiliateEmail ?? '' },
            { label: 'Address', value: existing?.affiliateAddress ?? '' },
            { label: 'Effective date', value: existing?.effectiveDate ?? '' },
            { label: 'Version', value: existing?.agreementVersion ?? '' },
          ]}
          signaturePng={existing?.signaturePng}
          downloadHref={`/api/onboarding/${encodeURIComponent(viewer.id)}/agreement.pdf`}
          onward={{ path: '/profile', label: 'Back to your profile' }}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="rise">
        {/* Not a step in their queue, so not numbered like one. "On file" once
            there is something on file; before that it is simply optional. */}
        <p className="label-cap">
          {waived ? (revisiting ? 'On file' : 'Not required') : 'Step 2 of 4'}
        </p>
        <h1 className="mt-1.5 font-display text-[26px] leading-[1.15]">The affiliate agreement</h1>
        <p className="plain mt-2.5">
          {revisiting
            ? 'The agreement you signed, and the details it was signed with. Read it as often as you like. It only changes if you sign it again.'
            : 'Read it, fill in the four blanks at the top, and sign at the bottom. You will be able to download a copy of what you signed at any time.'}
        </p>
      </div>

      {waived ? (
        <p className="plain-note mt-6">
          {revisiting
            ? 'This is waived for your account, so nothing here is being asked of you. It is kept because you signed it, and you can read it back whenever you like.'
            : 'This is waived for your account, so nobody is waiting on it and nothing is held up by it. You are welcome to sign it anyway if you would rather have it on file.'}
        </p>
      ) : (
        <div className="mt-6">
          <OnboardingRail current="agreement" state={state} />
        </div>
      )}

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
        initialAddress={existing?.address}
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
