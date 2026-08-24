import type { Metadata } from 'next';
import Link from 'next/link';
import { ApprovalPill } from '@/components/ApprovalPill';
import { formatDateTime } from '@/lib/analytics';
import { isBypassed } from '@/lib/approval';
import { maskAccount, maskTin } from '@/lib/mask';
import { canOpen, isLocked, stepsFor, waivedSteps, type StepKey } from '@/lib/onboarding';
import { onboardingFor } from '@/lib/onboarding-guard';
import { readAgreement, readBank, readW9 } from '@/lib/onboarding-store';
import { findUserById } from '@/lib/users';
import { requireViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Your profile' };

/**
 * Your own paperwork, from inside the app.
 *
 * The four forms already existed, but only as a corridor: you walked them once,
 * in order, before you were let in. That works for somebody arriving through
 * the front door and not at all for somebody an admin waved through, who is
 * already inside and now needs to file a W-9 on Friday and nothing else today.
 *
 * So this is the list rather than the queue. Every item, what state it is in,
 * and a way into each one on its own. It is shown to everybody, not only to
 * waived accounts: "where is the thing I signed" is a reasonable question from
 * anyone, and the answer should not be "you cannot get back to it".
 */
export default async function ProfilePage() {
  const viewer = await requireViewer();
  const { state, applies, approval, bypass } = await onboardingFor(viewer);
  const waived = isBypassed(bypass);
  /*
   * Two lists, because a waiver produces two different kinds of item. The
   * agreement and the W-9 are not late, they are not being collected; showing
   * them in the same list with a disabled button would read as a form that has
   * broken rather than a decision somebody made.
   */
  const mine = stepsFor({ bypassed: waived });
  const skipped = waivedSteps({ bypassed: waived });
  const approved = approval.status === 'approved';

  /** The two steps that produce a file. The other two produce rows. */
  const pdfFor: Partial<Record<StepKey, string>> = {
    agreement: `/api/onboarding/${encodeURIComponent(viewer.id)}/agreement.pdf`,
    w9: `/api/onboarding/${encodeURIComponent(viewer.id)}/w9.pdf`,
  };

  const [account, agreement, w9, bank] = await Promise.all([
    findUserById(viewer.id).catch(() => null),
    applies ? readAgreement(viewer.id).catch(() => null) : null,
    applies ? readW9(viewer.id).catch(() => null) : null,
    applies ? readBank(viewer.id).catch(() => null) : null,
  ]);

  const detail: Record<StepKey, string> = {
    profile: state.profile
      ? [account?.position, account?.mobile].filter(Boolean).join(', ') || 'On file'
      : 'Your name, how to reach you, and a password of your own.',
    agreement: agreement
      ? `Signed ${formatDateTime(agreement.signedAt)}`
      : 'The terms of the engagement, signed.',
    w9: w9
      ? `Filed ${formatDateTime(w9.signedAt)}, ${maskTin(w9.tinLast4, w9.tinType)}`
      : 'What the IRS needs before anyone can be paid.',
    bank: bank
      ? `${bank.bankName}, ${maskAccount(bank.accountLast4)}`
      : 'Where the ACH payment goes.',
  };

  return (
    <div className="w-full max-w-[900px]">
      <div className="rise">
        <h1 className="font-display text-[26px] leading-[1.05]">Your profile</h1>
        <p className="plain mt-2.5">
          {account?.fullName || viewer.username}
          {account?.email ? ` · ${account.email}` : ''}
          {viewer.usr ? (
            <>
              {' · '}
              <span className="tnum">usr={viewer.usr}</span>
            </>
          ) : null}
        </p>
      </div>

      {!applies ? (
        <p className="panel mt-5 p-5 text-[13px] text-ink-soft">
          Onboarding does not apply to this account, so there is nothing to fill in here.
        </p>
      ) : (
        <>
          {waived ? (
            <div className="panel mt-5 border-gold-edge bg-gold-faint p-5 sm:p-6">
              <p className="text-[14px] leading-relaxed text-ink">
                <strong className="font-semibold">An admin has let you straight in.</strong> You do
                not have to finish these before using the dashboard. Work through whichever ones you
                need, in any order.
              </p>
              <p className="plain mt-1.5">
                The agreement and the W-9 have been waived, so there is nothing for you to sign.
                Your bank details are the one thing a payment still needs, so they are worth doing
                before your first one is due.
                {bypass.by ? ` Waived by ${bypass.by}` : ''}
                {bypass.at ? ` on ${formatDateTime(bypass.at)}` : ''}
                {bypass.by || bypass.at ? '.' : ''}
              </p>
            </div>
          ) : (
            <div className="panel mt-5 p-5 sm:p-6">
              <p className="flex flex-wrap items-center gap-3 text-[14px] text-ink">
                <span>Account status</span>
                <ApprovalPill approval={approval} bypass={bypass} />
              </p>
              {approval.status === 'declined' && approval.note ? (
                <p className="plain mt-2">{approval.note}</p>
              ) : null}
            </div>
          )}

          <section className="panel mt-5 overflow-hidden">
            <div className="border-b border-edge px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">Your paperwork</h2>
              <p className="plain mt-1">
                Open any of these to fill it in or change what is there. Nothing is lost by looking.
                The agreement and the W-9 settle once your account does: after that they are yours
                to read and download, and an admin has to be asked to change one.
              </p>
            </div>

            <ul>
              {mine.map((step) => {
                const done = state[step.key];
                const open = canOpen(state, step.key, { bypassed: waived });
                const settled = isLocked(step.key, state, { approved, bypassed: waived });
                const pdf = done ? pdfFor[step.key] : undefined;
                return (
                  <li
                    key={step.key}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge-faint px-5 py-4 last:border-b-0"
                  >
                    <span
                      aria-hidden
                      className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[2px] text-[11px] font-semibold ${
                        done ? 'bg-leaf-wash text-leaf-text' : 'bg-paper-sunk text-ink-dim'
                      }`}
                    >
                      {done ? '✓' : ''}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-ink">{step.label}</span>
                      <span className="block text-[12px] text-ink-dim">{detail[step.key]}</span>
                    </span>

                    {pdf ? (
                      <a href={pdf} className="link-text flex-none text-[12px] font-medium">
                        Download PDF
                      </a>
                    ) : null}

                    {open ? (
                      <Link href={step.path} className="btn-outline btn-sm flex-none">
                        {settled ? 'View' : done ? 'Change' : 'Fill it in'}
                      </Link>
                    ) : (
                      <span className="flex-none text-[12px] text-ink-dim">
                        Earlier steps come first
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            {skipped.length > 0 ? (
              <div className="border-t border-edge bg-paper-card px-5 py-4">
                <p className="text-[13px] font-semibold text-ink">Not needed for your account</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {skipped.map((step) => (
                  <li
                    key={step.key}
                    className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-ink-dim"
                  >
                    <span className="font-medium text-ink-soft">{step.label}</span>
                    <span>
                      {state[step.key]
                        ? `${detail[step.key]}. Kept on file.`
                        : 'Waived by an admin. There is nothing here for you to sign.'}
                    </span>
                    {/* Signed before the waiver was granted. Not being asked
                        for it again is one thing; being unable to read back
                        what you put your name to is another. */}
                    {state[step.key] ? (
                      <>
                        <Link href={step.path} className="link-text">
                          Read it
                        </Link>
                        {pdfFor[step.key] ? (
                          <a href={pdfFor[step.key]} className="link-text">
                            Download PDF
                          </a>
                        ) : null}
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
              </div>
            ) : null}
          </section>

          <p className="plain mt-5">
            Your taxpayer number and bank account number are encrypted. Nobody, including an admin,
            can read either of them back in full from this app.
          </p>
        </>
      )}
    </div>
  );
}
