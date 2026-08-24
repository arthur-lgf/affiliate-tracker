// The approval gate: who is let in, who is waiting, and who gets told.
//
// The rules that decide whether somebody can use the app at all, and the one
// that decides whether an email goes out. Both are the sort of thing a type
// check cannot see and a wrong answer is expensive in opposite directions: too
// strict and working accounts are locked out, too loose and unreviewed ones are
// let in.
//
//   npx tsx scripts/approval-checks.ts

import {
  approvalLabel,
  awaitingReview,
  blocksApp,
  gatesApply,
  isApprovalStatus,
  isBypassed,
  NO_BYPASS,
  isReviewDecision,
  MAX_NOTE,
  NOT_APPLICABLE,
  reviewProblems,
  shouldEmailApproval,
  UNREVIEWED,
  type Approval,
  type Bypass,
} from '../src/lib/approval';
import { accountApprovedEmail } from '../src/lib/emails/account-approved';
import { emailConfigured, emailProblem } from '../src/lib/email';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

function approval(over: Partial<Approval> = {}): Approval {
  return { ...UNREVIEWED, ...over };
}

const SUBMITTED = '2026-08-24T10:00:00.000Z';

console.log('\n— who the app is open to —');
check('a brand new account is shut out', blocksApp(UNREVIEWED));
check('so is one that has just submitted', blocksApp(approval({ submittedAt: SUBMITTED })));
check('and a declined one', blocksApp(approval({ status: 'declined', note: 'Name mismatch' })));
check('an approved one is let in', !blocksApp(approval({ status: 'approved' })));
/*
 * The default for anybody the flow does not apply to: an admin, the env
 * account, an app with no database. Approved rather than pending, because the
 * failure mode of guessing "not approved" is locking people out of something
 * that was working.
 */
check('and so is anybody the flow does not apply to', !blocksApp(NOT_APPLICABLE));

console.log('\n— what is actually in the queue —');
check('nothing, before they have sent anything', !awaitingReview(UNREVIEWED));
check('an account that has submitted is waiting', awaitingReview(approval({ submittedAt: SUBMITTED })));
check(
  'an approved account is not waiting',
  !awaitingReview(approval({ status: 'approved', submittedAt: SUBMITTED })),
);
check(
  'nor is a declined one, until they resubmit',
  !awaitingReview(approval({ status: 'declined', submittedAt: SUBMITTED })),
);

console.log('\n— what the pill says —');
check('not started', approvalLabel(UNREVIEWED) === 'Not submitted');
check('waiting', approvalLabel(approval({ submittedAt: SUBMITTED })) === 'Awaiting review');
check('approved', approvalLabel(approval({ status: 'approved' })) === 'Approved');
check('declined', approvalLabel(approval({ status: 'declined' })) === 'Declined');
// The distinction the column exists for: only one of these two is work.
check(
  'pending is two different things and says so',
  approvalLabel(UNREVIEWED) !== approvalLabel(approval({ submittedAt: SUBMITTED })),
);

console.log('\n— what counts as a status —');
check('the three real ones', ['pending', 'approved', 'declined'].every(isApprovalStatus));
check('and nothing else', !isApprovalStatus('APPROVED') && !isApprovalStatus('ok'));
check('not a near miss', !isApprovalStatus('approve'));
check('nor a non-string', !isApprovalStatus(1) && !isApprovalStatus(null) && !isApprovalStatus(true));
check('decisions are the same three', ['pending', 'approved', 'declined'].every(isReviewDecision));
check('and nothing else', !isReviewDecision('deleted'));

console.log('\n— what a review has to say for itself —');
check('approving needs no words', Object.keys(reviewProblems({ decision: 'approved', note: '' })).length === 0);
check('putting it back needs none either', Object.keys(reviewProblems({ decision: 'pending', note: '' })).length === 0);
/*
 * The one rule with teeth. A decline is shown to the person it happened to, and
 * "declined" with nothing after it leaves somebody with a locked account and
 * nothing to do about it.
 */
check('declining needs a reason', Boolean(reviewProblems({ decision: 'declined', note: '' }).note));
check('and not a token one', Boolean(reviewProblems({ decision: 'declined', note: 'no' }).note));
check('whitespace is not a reason', Boolean(reviewProblems({ decision: 'declined', note: '      ' }).note));
check(
  'a real reason passes',
  Object.keys(reviewProblems({ decision: 'declined', note: 'The name on the W-9 does not match.' })).length === 0,
);
check(
  'an essay does not',
  Boolean(reviewProblems({ decision: 'approved', note: 'x'.repeat(MAX_NOTE + 1) }).note),
);
check(
  'exactly the limit is fine',
  Object.keys(reviewProblems({ decision: 'approved', note: 'x'.repeat(MAX_NOTE) })).length === 0,
);

console.log('\n— when the email goes —');
check(
  'on the move into approved',
  shouldEmailApproval(approval({ submittedAt: SUBMITTED }), 'approved'),
);
check(
  'and from declined to approved',
  shouldEmailApproval(approval({ status: 'declined' }), 'approved'),
);
/*
 * Not twice. Re-saving a note on an already-approved account is an edit, and
 * sending "your account is approved" again a week later reads as a mistake,
 * which it would be.
 */
check(
  'not again on an account already approved',
  !shouldEmailApproval(approval({ status: 'approved' }), 'approved'),
);
check('not on a decline', !shouldEmailApproval(approval({ submittedAt: SUBMITTED }), 'declined'));
check('not on putting it back in the queue', !shouldEmailApproval(approval({ status: 'approved' }), 'pending'));

console.log('\n— the message —');
const message = accountApprovedEmail({
  to: 'arthur@example.com',
  name: 'Arthur Reyes',
  origin: 'https://ledger.example.com/',
  note: '',
});
check('it goes to them', message.to === 'arthur@example.com');
check('the subject says what it is', message.subject === 'Your affiliate account is approved');
check('it uses their first name', message.text.includes('Hi Arthur,'));
check('there is always a text part', message.text.length > 100);
check('and an html one', (message.html ?? '').includes('<div'));
check('the sign-in link is absolute', message.text.includes('https://ledger.example.com/login'));
check('the trailing slash is not doubled', !message.text.includes('.com//login'));
check('the html links to the same place', (message.html ?? '').includes('https://ledger.example.com/login'));
// The most recognisable tell in generated copy, and this is the most
// customer-facing surface in the app.
check('no em dash in the text part', !message.text.includes('—'));
check('nor in the html', !(message.html ?? '').includes('—'));

const noName = accountApprovedEmail({ to: 'a@b.test', name: '', origin: 'https://x.test', note: '' });
check('a missing name does not produce "Hi ,"', noName.text.includes('Hi there,'));

const noted = accountApprovedEmail({
  to: 'a@b.test',
  name: 'Dana Okafor',
  origin: 'https://x.test',
  note: 'Welcome aboard.',
});
check('an approval note reaches the text part', noted.text.includes('Welcome aboard.'));
check('and the html', (noted.html ?? '').includes('Welcome aboard.'));
check('no note, no empty section', !message.text.includes('A note from the team'));

// A note is typed by an admin and rendered into HTML, so it is escaped.
const nasty = accountApprovedEmail({
  to: 'a@b.test',
  name: '<script>alert(1)</script>',
  origin: 'https://x.test',
  note: '<img src=x onerror=alert(1)>',
});
check('a name cannot inject markup', !(nasty.html ?? '').includes('<script>'));
check('nor can a note', !(nasty.html ?? '').includes('<img src=x'));
check('but the text is still there, escaped', (nasty.html ?? '').includes('&lt;img src=x'));

console.log('\n— when nothing is configured —');
// Whatever the environment running these checks happens to have, the two
// answers must agree with each other.
check(
  'configured and problem are opposites',
  emailConfigured() === (emailProblem() === ''),
);

console.log('\n— the way round it —');
const waived: Bypass = { at: '2026-08-24T12:00:00.000Z', by: 'arthur', note: 'Signed on paper' };

check('no waiver by default', !isBypassed(NO_BYPASS));
check('a timestamp is the waiver', isBypassed(waived));
check('the gates apply to everybody else', gatesApply(NO_BYPASS));
check('and not to them', !gatesApply(waived));
// A waiver with no note or no name is still a waiver. The record is worth
// having; the flag does not depend on it.
check('a bare waiver still counts', isBypassed({ at: '2026-08-24T12:00:00.000Z', by: '', note: '' }));
check('an empty string is not a timestamp', !isBypassed({ ...NO_BYPASS, at: null }));

/*
 * Bypass is its own axis, not a value of the approval status. Everything below
 * says the same thing from a different angle: waiving the gate must not be
 * recorded as a review that never happened.
 */
const pendingAndWaived = approval({ submittedAt: SUBMITTED });
check('a waived account still reads as pending underneath', blocksApp(pendingAndWaived));
check('and the pill says which fact wins', approvalLabel(pendingAndWaived, waived) === 'Bypassed');
check('an approved one too, while waived', approvalLabel(approval({ status: 'approved' }), waived) === 'Bypassed');
check('a declined one too', approvalLabel(approval({ status: 'declined' }), waived) === 'Bypassed');
check('without a waiver nothing changes', approvalLabel(pendingAndWaived, NO_BYPASS) === 'Awaiting review');
check('and the default argument is no waiver', approvalLabel(pendingAndWaived) === 'Awaiting review');
// The queue is still the queue: a waived account is not work, but the fact that
// its paperwork is outstanding has not gone away.
check('the review state survives a waiver', awaitingReview(pendingAndWaived));

console.log(`\napproval: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
