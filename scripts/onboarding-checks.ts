// The onboarding gate, the field rules, and the sealing of the two numbers
// that must never be readable from a database dump.
//
// These are the decisions a type check cannot catch: which step comes next,
// whether the app is barred, whether a redirect loops, whether a nine-digit
// number survives a round trip through AES-256-GCM. The pages are wiring
// around this; this is the part that can be wrong.
//
//   npx tsx scripts/onboarding-checks.ts

import {
  agreementProblems,
  bankProblems,
  canOpen,
  firstMissingRequired,
  gateFor,
  isBlocked,
  isComplete,
  looksLikeEmail,
  looksLikePhone,
  looksSigned,
  needsForeignPartnersQuestion,
  nextStep,
  NOTHING_DONE,
  profileProblems,
  progressOf,
  STEPS,
  w9Problems,
  type OnboardingState,
  type W9Input,
} from '../src/lib/onboarding';
import { digitsOf, formatTin, last4, maskAccount, maskTin, validTin } from '../src/lib/mask';
import { open, seal, sealedMatches, SecretBoxError, secretsConfigured } from '../src/lib/secret-box';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

function state(over: Partial<OnboardingState> = {}): OnboardingState {
  return { ...NOTHING_DONE, ...over };
}

const ALL_DONE = state({ profile: true, agreement: true, w9: true, bank: true });
/** The realistic middle: everything required is signed, the bank step is not. */
const DOCS_DONE = state({ profile: true, agreement: true, w9: true });

console.log('— the order of things —');
check('a fresh account starts at the details', nextStep(NOTHING_DONE)?.key === 'profile');
check('and is barred from the app', isBlocked(NOTHING_DONE));
check('the details come first', STEPS[0]!.key === 'profile');
check('the bank step comes last', STEPS[STEPS.length - 1]!.key === 'bank');
check('and it is the only optional one', STEPS.filter((s) => !s.required).length === 1);
check(
  'the three documents are all required',
  ['profile', 'agreement', 'w9'].every((k) => STEPS.find((s) => s.key === k)!.required),
);

check('after the details comes the agreement', nextStep(state({ profile: true }))?.key === 'agreement');
check(
  'after the agreement comes the W-9',
  nextStep(state({ profile: true, agreement: true }))?.key === 'w9',
);
check('after the W-9 comes the bank', nextStep(DOCS_DONE)?.key === 'bank');
check('and then nothing', nextStep(ALL_DONE) === null);

console.log('\n— what bars the app —');
check('the signed documents lift the bar', !isBlocked(DOCS_DONE));
check('even though onboarding is not finished', !isComplete(DOCS_DONE));
check('only all four count as finished', isComplete(ALL_DONE));
check('a missing W-9 bars it', isBlocked(state({ profile: true, agreement: true })));
check('a missing agreement bars it', isBlocked(state({ profile: true, w9: true })));
check('and names the earliest missing one', firstMissingRequired(state({ profile: true, w9: true }))?.key === 'agreement');
check('nothing is missing once the documents are in', firstMissingRequired(DOCS_DONE) === null);

console.log('\n— progress —');
check('nothing done is zero of four', progressOf(NOTHING_DONE).done === 0);
check('and four is the total', progressOf(NOTHING_DONE).total === STEPS.length);
check('the documents are three of four', progressOf(DOCS_DONE).done === 3);
check('everything is four of four', progressOf(ALL_DONE).done === 4);

console.log('\n— which steps can be opened —');
check('the first is always open', canOpen(NOTHING_DONE, 'profile'));
check('the agreement is not, before the details', !canOpen(NOTHING_DONE, 'agreement'));
check('the W-9 is not, before the agreement', !canOpen(state({ profile: true }), 'w9'));
check('the agreement opens once the details are in', canOpen(state({ profile: true }), 'agreement'));
check('the bank step opens once the W-9 is in', canOpen(DOCS_DONE, 'bank'));
// Signing an agreement on an account whose password an admin still knows is
// signing as somebody else, which is the whole reason for the ordering.
check('a signed W-9 does not unlock a skipped agreement', !canOpen(state({ profile: true, w9: true }), 'w9'));

console.log('\n— the gate —');
check('a barred affiliate is sent to their first step', gateFor('/', NOTHING_DONE) === '/welcome');
check('from anywhere in the app', gateFor('/links', NOTHING_DONE) === '/welcome');
check('and to the earliest one still missing', gateFor('/links', state({ profile: true })) === '/welcome/agreement');
check('once the documents are in, the app opens', gateFor('/', DOCS_DONE) === null);
check('including the pages behind it', gateFor('/cpa', DOCS_DONE) === null);
check('a finished account is never gated', gateFor('/links', ALL_DONE) === null);

// The loop this function exists to avoid: the welcome pages must never send
// somebody back to a welcome page they are already allowed to be on.
check('the current step is not redirected away from', gateFor('/welcome', NOTHING_DONE) === null);
check('nor the agreement once it is reachable', gateFor('/welcome/agreement', state({ profile: true })) === null);
check('nor the W-9', gateFor('/welcome/w9', state({ profile: true, agreement: true })) === null);
check('nor the bank step', gateFor('/welcome/bank', DOCS_DONE) === null);

check('a step reached too early moves them back', gateFor('/welcome/w9', NOTHING_DONE) === '/welcome');
check('and a step already done moves them on', gateFor('/welcome', state({ profile: true })) === '/welcome/agreement');
check(
  'the last step, done, ends the flow',
  gateFor('/welcome/bank', ALL_DONE) === '/',
);
check('an unknown welcome path lands on the next real one', gateFor('/welcome/nope', DOCS_DONE) === '/welcome/bank');

/*
 * The one that would be a real bug: an affiliate who has signed everything
 * required but skipped the bank step must not be bounced between the app and
 * the bank form. Walking both directions proves the two rules agree.
 */
check('a soft-skipped bank step does not trap them in the app', gateFor('/', DOCS_DONE) === null);
check('and does not trap them in the form', gateFor('/welcome/bank', DOCS_DONE) === null);

console.log('\n— the details step —');
const goodProfile = {
  fullName: 'Arthur Reyes',
  email: 'arthur@example.com',
  position: 'Affiliate',
  mobile: '+1 415 555 0123',
  password: 'correct-horse-battery',
  confirmPassword: 'correct-horse-battery',
};
check('a filled form has no problems', Object.keys(profileProblems(goodProfile)).length === 0);
check('a missing name is caught', Boolean(profileProblems({ ...goodProfile, fullName: ' ' }).fullName));
check('a missing position is caught', Boolean(profileProblems({ ...goodProfile, position: '' }).position));
check('a bad email is caught', Boolean(profileProblems({ ...goodProfile, email: 'arthur' }).email));
check('a short password is caught', Boolean(profileProblems({ ...goodProfile, password: 'short', confirmPassword: 'short' }).password));
check(
  'a mismatch is caught',
  Boolean(profileProblems({ ...goodProfile, confirmPassword: 'something-else-entirely' }).confirmPassword),
);
// A short password is already wrong; saying so twice reads as two mistakes.
check(
  'and a short password is not also blamed for mismatching',
  !profileProblems({ ...goodProfile, password: 'short', confirmPassword: 'other' }).confirmPassword,
);

check('an email needs a dot in the domain', !looksLikeEmail('arthur@example'));
check('a plus address is fine', looksLikeEmail('arthur+ledger@example.com'));
check('a seven-digit number is a number', looksLikePhone('5550123'));
check('six digits is not', !looksLikePhone('555012'));
check('sixteen digits is not', !looksLikePhone('12345678901234567'));
check('punctuation is not counted', looksLikePhone('(415) 555-0123'));

console.log('\n— the agreement —');
const inked = 'data:image/png;base64,' + 'A'.repeat(900);
const goodAgreement = {
  affiliateName: 'Arthur Reyes',
  affiliateEmail: 'arthur@example.com',
  affiliateAddress: '1 Example Street, Austin TX 78701',
  effectiveDate: '2026-08-24',
  signaturePng: inked,
  affirmed: true,
};
check('a signed agreement has no problems', Object.keys(agreementProblems(goodAgreement)).length === 0);
check('an unticked box is caught', Boolean(agreementProblems({ ...goodAgreement, affirmed: false }).affirmed));
check('a missing address is caught', Boolean(agreementProblems({ ...goodAgreement, affiliateAddress: '' }).affiliateAddress));
check('a half-typed date is caught', Boolean(agreementProblems({ ...goodAgreement, effectiveDate: '2026-08' }).effectiveDate));
// An untouched signature pad still exports a PNG, so a short one is a blank one.
check('an untouched pad is not a signature', Boolean(agreementProblems({ ...goodAgreement, signaturePng: 'data:image/png;base64,AAAA' }).signaturePng));
check('nor is a jpeg', !looksSigned('data:image/jpeg;base64,' + 'A'.repeat(900)));
check('nor an empty string', !looksSigned(''));
check('a real one is', looksSigned(inked));

console.log('\n— the W-9 —');
const goodW9: W9Input = {
  line1Name: 'Arthur Reyes',
  line2Business: '',
  classification: 'individual',
  llcCode: '',
  otherText: '',
  foreignPartners: false,
  exemptPayeeCode: '',
  fatcaCode: '',
  address: '1 Example Street',
  cityStateZip: 'Austin, TX 78701',
  accountNumbers: '',
  tinType: 'ssn',
  tin: '123-45-6789',
  signaturePng: inked,
  certified: true,
};
check('a filled W-9 has no problems', Object.keys(w9Problems(goodW9)).length === 0);
check('line 1 is required, as the form says', Boolean(w9Problems({ ...goodW9, line1Name: '' }).line1Name));
check('line 2 is genuinely optional', Object.keys(w9Problems({ ...goodW9, line2Business: '' })).length === 0);
check('a box must be checked', Boolean(w9Problems({ ...goodW9, classification: '' }).classification));
check('line 5 is required', Boolean(w9Problems({ ...goodW9, address: '' }).address));
check('line 6 is required', Boolean(w9Problems({ ...goodW9, cityStateZip: '' }).cityStateZip));
check('line 7 is optional', Object.keys(w9Problems({ ...goodW9, accountNumbers: '' })).length === 0);

check('the LLC box needs its letter', Boolean(w9Problems({ ...goodW9, classification: 'llc', llcCode: '' }).llcCode));
check('and only C, S or P', Boolean(w9Problems({ ...goodW9, classification: 'llc', llcCode: 'X' }).llcCode));
check('C is fine', Object.keys(w9Problems({ ...goodW9, classification: 'llc', llcCode: 'C' })).length === 0);
check('"other" needs saying what', Boolean(w9Problems({ ...goodW9, classification: 'other', otherText: '' }).otherText));

check('a TIN is nine digits', Boolean(w9Problems({ ...goodW9, tin: '123-45-678' }).tin));
check('formatting is not counted', Object.keys(w9Problems({ ...goodW9, tin: '123 45 6789' })).length === 0);
check('an EIN works too', Object.keys(w9Problems({ ...goodW9, tinType: 'ein', tin: '12-3456789' })).length === 0);
check('one of the two must be chosen', Boolean(w9Problems({ ...goodW9, tinType: '' }).tinType));
check('an unsigned W-9 is caught', Boolean(w9Problems({ ...goodW9, signaturePng: '' }).signaturePng));
// Part II is signed under penalties of perjury. The database refuses a row
// without it too — this is the half that says so before the round trip.
check('an uncertified W-9 is caught', Boolean(w9Problems({ ...goodW9, certified: false }).certified));

check('line 3b applies to a partnership', needsForeignPartnersQuestion('partnership', ''));
check('and to a trust or estate', needsForeignPartnersQuestion('trust_estate', ''));
check('and to an LLC taxed as one', needsForeignPartnersQuestion('llc', 'P'));
check('but not to an LLC taxed as a corporation', !needsForeignPartnersQuestion('llc', 'C'));
check('nor to an individual', !needsForeignPartnersQuestion('individual', ''));

console.log('\n— bank details —');
const goodBank = { accountName: 'Arthur Reyes', bankName: 'Example Bank', accountNumber: '000123456789' };
check('a filled form has no problems', Object.keys(bankProblems(goodBank)).length === 0);
check('a missing name is caught', Boolean(bankProblems({ ...goodBank, accountName: '' }).accountName));
check('a missing bank is caught', Boolean(bankProblems({ ...goodBank, bankName: '' }).bankName));
check('three digits is not an account', Boolean(bankProblems({ ...goodBank, accountNumber: '123' }).accountNumber));
check('eighteen is not either', Boolean(bankProblems({ ...goodBank, accountNumber: '1'.repeat(18) }).accountNumber));
check('four is', Object.keys(bankProblems({ ...goodBank, accountNumber: '1234' })).length === 0);
check('and dashes do not count against it', Object.keys(bankProblems({ ...goodBank, accountNumber: '0001-2345-6789' })).length === 0);

console.log('\n— masking —');
check('digits are pulled out of formatting', digitsOf('(415) 555-0123') === '4155550123');
check('the last four are the last four', last4('123-45-6789') === '6789');
check('a short number gives what there is', last4('12') === '12');
check('an SSN mask keeps the SSN shape', maskTin('6789', 'ssn') === '•••-••-6789');
check('an EIN mask keeps the EIN shape', maskTin('6789', 'ein') === '••-•••6789');
check('an empty SSN still masks', maskTin('', 'ssn') === '•••-••-••••');
check('an account mask claims no length', maskAccount('6789') === '••••6789');
check('a mask never leaks more than four', !maskTin('123456789', 'ssn').includes('12345'));
check('nine digits is a TIN', validTin('123456789'));
check('eight is not', !validTin('12345678'));
check('ten is not', !validTin('1234567890'));
check('an SSN reads back with dashes', formatTin('123456789', 'ssn') === '123-45-6789');
check('an EIN reads back with its own dash', formatTin('123456789', 'ein') === '12-3456789');
check('anything else is handed back untouched', formatTin('12345', 'ssn') === '12345');

console.log('\n— sealing —');
/*
 * The key is set here rather than assumed. These checks have to run on a
 * machine with no .env, and the alternative — skipping when the key is absent —
 * is a suite that silently tests nothing on exactly the machine where a
 * mistake would ship.
 */
process.env.ONBOARDING_SECRET_KEY = 'a-test-key-that-is-long-enough-to-be-accepted';
check('a key makes sealing available', secretsConfigured());

const ssn = '123456789';
const sealed = seal(ssn);
check('a sealed value does not contain the plaintext', !sealed.includes(ssn));
check('it is versioned', sealed.startsWith('v1.'));
check('it opens back to what went in', open(sealed) === ssn);
check('two seals of the same number differ', seal(ssn) !== seal(ssn));
check('and both still open', open(seal(ssn)) === ssn && open(seal(ssn)) === ssn);
check('a long value round trips', open(seal('x'.repeat(4000))) === 'x'.repeat(4000));
check('so does one with unicode in it', open(seal('Ítem — ñ 東京')) === 'Ítem — ñ 東京');

check('comparing without printing works', sealedMatches(sealed, ssn));
check('and says no to the wrong number', !sealedMatches(sealed, '987654321'));

// GCM is authenticated, which is the whole reason for choosing it: an edited
// ciphertext must fail rather than decrypt to something else.
const parts = sealed.split('.');
const tampered = [parts[0], parts[1], parts[2], Buffer.from('999999999').toString('base64url')].join('.');
let refusedTamper = false;
try {
  open(tampered);
} catch (error) {
  refusedTamper = error instanceof SecretBoxError;
}
check('an edited ciphertext is refused, not decrypted', refusedTamper);

let refusedShape = false;
try {
  open('not-a-sealed-value');
} catch (error) {
  refusedShape = error instanceof SecretBoxError;
}
check('so is something that was never sealed', refusedShape);

// The key changing is the same failure as tampering, on purpose: telling them
// apart would tell an attacker which of the two they had got wrong.
process.env.ONBOARDING_SECRET_KEY = 'a-completely-different-key-of-sufficient-length';
let refusedKey = false;
try {
  open(sealed);
} catch (error) {
  refusedKey = error instanceof SecretBoxError;
}
check('a value sealed under another key will not open', refusedKey);

// Without a key there is nowhere safe to put an SSN, so the app refuses rather
// than quietly storing one in the clear.
process.env.ONBOARDING_SECRET_KEY = '';
check('no key means sealing is unavailable', !secretsConfigured());
let refusedMissing = false;
try {
  seal(ssn);
} catch (error) {
  refusedMissing = error instanceof SecretBoxError;
}
check('and sealing refuses rather than storing in the clear', refusedMissing);

console.log(`\nonboarding: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
