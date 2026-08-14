// The tracking key an affiliate account is bound to.
//
// This value decides which rows a person sees, so the properties that matter
// are that it is drawn uniformly (a biased generator makes keys guessable),
// that it survives the two validators it has to pass, and that it does not
// contain characters that get confused when the key is read off a screen.
//
//   npx tsx scripts/tracking-key-checks.ts
import { isTrackingKey, newTrackingKey } from '../src/lib/tracking-key';
import { usrSchema } from '../src/lib/validate';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

const SAMPLE = Array.from({ length: 2_000 }, () => newTrackingKey());

console.log('— shape —');
check('every key is 6 characters', SAMPLE.every((k) => k.length === 6));
check('lowercase letters and digits only', SAMPLE.every((k) => /^[a-z0-9]{6}$/.test(k)));
check('isTrackingKey recognises its own output', SAMPLE.every(isTrackingKey));
check('and rejects a hand-picked key', !isTrackingKey('mark'));
check('and rejects the wrong length', !isTrackingKey('abcdefg'));
check('and rejects an excluded character', !isTrackingKey('abcdei'));

console.log('\n— it survives the validators it has to pass —');
// usrSchema is what /api/links applies, and the database has an equivalent
// check constraint. A key that fails either would create an account nobody can
// make a link for.
check('usrSchema accepts every key', SAMPLE.every((k) => usrSchema.safeParse(k).success));
check(
  'and the value is unchanged by it',
  SAMPLE.every((k) => usrSchema.safeParse(k).success && usrSchema.parse(k) === k),
);
const dbShape = /^[a-z0-9]+(-[a-z0-9]+)*$/;
check("the database's users_usr_shape_check would accept it", SAMPLE.every((k) => dbShape.test(k)));

console.log('\n— no ambiguous characters —');
// i/l/1 and o/0 are the pairs that get mistyped when a key is dictated or
// copied by eye. The key travels in a URL people share.
check('no i, l, o, 0 or 1', SAMPLE.every((k) => !/[ilo01]/.test(k)));

console.log('\n— uniformity —');
// Rejection sampling should leave the alphabet flat. 2000 keys is 12,000
// characters over 31 letters, about 387 each. A letter appearing half or twice
// that would mean modulo bias had crept back in, which shrinks the real key
// space and makes keys easier to guess.
const counts = new Map<string, number>();
for (const ch of SAMPLE.join('')) counts.set(ch, (counts.get(ch) ?? 0) + 1);
const expected = (SAMPLE.length * 6) / 31;
const skewed = [...counts.values()].filter((n) => n < expected / 2 || n > expected * 2);
check('the whole alphabet is used', counts.size === 31);
check('and used evenly', skewed.length === 0);

console.log('\n— collisions —');
// 31^6 is about 887 million, so 2000 draws should not repeat. A duplicate here
// means the generator is not random, not that we were unlucky: the birthday
// bound puts the chance of any collision at roughly 0.2%.
const unique = new Set(SAMPLE);
check('2000 keys are distinct', unique.size === SAMPLE.length);

console.log(`\ntracking-key: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
