import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { OnboardingRail } from '@/components/OnboardingRail';
import { BankForm } from '@/components/onboarding/BankForm';
import { maskAccount } from '@/lib/mask';
import { canOpen } from '@/lib/onboarding';
import { onboardingFor } from '@/lib/onboarding-guard';
import { readBank } from '@/lib/onboarding-store';
import { requireViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Bank details' };

/**
 * The one step that can be come back to.
 *
 * requireStep() is not used here on purpose: it moves somebody on from a step
 * they have finished, which is right for a signature and wrong for a bank
 * account. People change banks, and a screen that says "done" with no way to
 * correct it is a screen that sends them looking for an admin.
 */
export default async function BankPage() {
  const viewer = await requireViewer();
  const { state, applies } = await onboardingFor(viewer);
  if (!applies) redirect('/');
  if (!canOpen(state, 'bank')) redirect('/welcome');

  const existing = state.bank ? await readBank(viewer.id).catch(() => null) : null;

  return (
    <div>
      <div className="rise">
        <p className="label-cap">Step 4 of 4</p>
        <h1 className="mt-1.5 font-display text-[26px] leading-[1.15]">Where the money goes</h1>
        <p className="plain mt-2.5">
          Payment is by ACH, thirty days after a referral is approved. This is the account it lands
          in.
        </p>
      </div>

      <div className="mt-6">
        <OnboardingRail current="bank" state={state} />
      </div>

      {existing ? (
        <div className="panel mt-5 p-5">
          <p className="text-[13px] text-ink-soft">
            On file:{' '}
            <strong className="text-ink">{existing.accountName}</strong> at{' '}
            <strong className="text-ink">{existing.bankName}</strong>,{' '}
            <span className="tnum">{maskAccount(existing.accountLast4)}</span>.
          </p>
          <p className="plain mt-1.5">
            Filling the form in again replaces it. Nothing else changes.{' '}
            <Link href="/" className="link-text">
              Or go to your dashboard
            </Link>
            .
          </p>
        </div>
      ) : null}

      <BankForm alreadySaved={Boolean(existing)} />

      {!existing ? (
        <p className="plain mt-5">
          Do not have these to hand?{' '}
          <Link href="/" className="link-text">
            Skip for now
          </Link>{' '}
          — everything else is done, so the dashboard is open to you. We will keep asking until this
          is filled in, because nothing can be paid out without it.
        </p>
      ) : null}
    </div>
  );
}
