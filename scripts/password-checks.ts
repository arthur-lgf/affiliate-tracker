// Password hashing and the generated passwords an admin hands out.
//
// The properties worth pinning are the ones whose absence looks like success:
// a malformed hash must not verify, a hash must not be reproducible without the
// salt, and the generated password must not be drawn from a biased alphabet.
//
//   npx tsx scripts/password-checks.ts
import { generatePassword, hashPassword, needsRehash, verifyPassword } from '../src/lib/password';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

/** Most cases do not care about the cost, and 600k iterations x 30 cases is a minute of waiting. */
const FAST = 1_000;

async function main() {
  console.log('— round trip —');
  const stored = await hashPassword('correct horse battery staple', FAST);
  check('the right password verifies', await verifyPassword('correct horse battery staple', stored));
  check('a wrong password does not', !(await verifyPassword('correct horse battery stapl', stored)));
  check('an empty password does not', !(await verifyPassword('', stored)));
  check('a case change does not', !(await verifyPassword('Correct horse battery staple', stored)));

  check('the hash names its algorithm', stored.startsWith('pbkdf2-sha256$'));
  check('and its iteration count', stored.split('$')[1] === String(FAST));
  check('the plaintext is nowhere in it', !stored.includes('correct'));

  console.log('\n— salting —');
  const a = await hashPassword('same-password', FAST);
  const b = await hashPassword('same-password', FAST);
  check('the same password hashes differently twice', a !== b);
  check('but both verify', (await verifyPassword('same-password', a)) && (await verifyPassword('same-password', b)));

  console.log('\n— a hash we cannot read must never verify —');
  const bad = [
    ['empty', ''],
    ['not a hash at all', 'hunter2'],
    ['too few parts', 'pbkdf2-sha256$1000$salt'],
    ['too many parts', 'pbkdf2-sha256$1000$salt$hash$extra'],
    ['an unknown algorithm', 'bcrypt$1000$c2FsdA$aGFzaA'],
    ['a plaintext-looking value', '$$$'],
    ['a non-numeric iteration count', 'pbkdf2-sha256$abc$c2FsdA$aGFzaA'],
    ['an empty salt', 'pbkdf2-sha256$1000$$aGFzaA'],
    ['an empty digest', 'pbkdf2-sha256$1000$c2FsdA$'],
  ] as const;
  for (const [label, value] of bad) {
    check(`${label} does not verify`, !(await verifyPassword('anything', value)));
  }

  // An attacker who could write to the users table would otherwise set the
  // count to 1 (making every hash trivial to crack offline) or to something
  // enormous (hanging the process on the next sign-in attempt).
  check(
    'an absurdly low iteration count is refused',
    !(await verifyPassword('x', 'pbkdf2-sha256$1$c2FsdA$aGFzaA')),
  );
  check(
    'an absurdly high iteration count is refused',
    !(await verifyPassword('x', 'pbkdf2-sha256$999999999$c2FsdA$aGFzaA')),
  );

  console.log('\n— rehashing —');
  check('a hash below the current cost is flagged', needsRehash(stored));
  check('garbage is flagged rather than trusted', needsRehash('nonsense'));
  const current = await hashPassword('slow-but-once');
  check('a hash at the current cost is not flagged', !needsRehash(current));
  check('and it still verifies at full cost', await verifyPassword('slow-but-once', current));

  console.log('\n— generated passwords —');
  const sample = Array.from({ length: 400 }, () => generatePassword());

  check('the shape is four groups of four', sample.every((p) => /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/.test(p)));
  check('every one is 19 characters', sample.every((p) => p.length === 19));

  // Read off a screen and typed back in, or read down a phone. These are the
  // pairs that get confused when that happens.
  const ambiguous = /[ilo01]/;
  check('no ambiguous characters', sample.every((p) => !ambiguous.test(p)));

  check('no two are the same', new Set(sample).size === sample.length);

  // Rejection sampling should leave the alphabet flat. With 400 passwords there
  // are 6400 characters over 31 letters, ~206 each; a letter appearing less
  // than half or more than double that would mean the modulo bias is back.
  const counts = new Map<string, number>();
  for (const ch of sample.join('').replace(/-/g, '')) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  const expected = (sample.length * 16) / 31;
  const skewed = [...counts.values()].filter((n) => n < expected / 2 || n > expected * 2);
  check('the alphabet is used evenly', skewed.length === 0);
  check('the whole alphabet gets used', counts.size === 31);

  console.log(`\npassword: ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
