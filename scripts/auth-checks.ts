// Sign-in: credentials, session cookies, and where a redirect is allowed to go.
//
// This is the code that decides who sees lead names, emails and phone numbers,
// so the rules are pinned here rather than left to a manual click-through.
//
//   npx tsx scripts/auth-checks.ts
import {
  createSessionToken,
  credentialsValid,
  readSessionToken,
  safeNextPath,
  timingSafeEqual,
} from '../src/lib/auth';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

function withEnv(env: Record<string, string | undefined>, run: () => void | Promise<void>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const out = run();
  if (out instanceof Promise) return out.finally(restore);
  restore();
  return Promise.resolve();
}

async function main() {
  console.log('— constant-time compare —');
  check('equal strings match', timingSafeEqual('hunter2', 'hunter2'));
  check('different strings do not', !timingSafeEqual('hunter2', 'hunter3'));
  check('different lengths do not', !timingSafeEqual('short', 'longer-value'));
  check('empty vs empty matches', timingSafeEqual('', ''));
  check('empty vs non-empty does not', !timingSafeEqual('', 'x'));
  check('unicode compares by code unit', timingSafeEqual('pässwörd', 'pässwörd'));

  console.log('\n— credentials —');
  await withEnv({ ADMIN_USER: 'admin', ADMIN_PASSWORD: 's3cret' }, () => {
    check('correct pair is valid', credentialsValid('admin', 's3cret'));
    check('wrong password is not', !credentialsValid('admin', 'nope'));
    check('wrong username is not', !credentialsValid('root', 's3cret'));
    check('empty pair is not', !credentialsValid('', ''));
    check('username is case sensitive', !credentialsValid('Admin', 's3cret'));
  });

  await withEnv({ ADMIN_USER: undefined, ADMIN_PASSWORD: 's3cret' }, () => {
    check('username defaults to admin', credentialsValid('admin', 's3cret'));
  });

  await withEnv({ ADMIN_USER: 'admin', ADMIN_PASSWORD: undefined }, () => {
    // With no password there is no account — not an account with a blank
    // password that anyone can walk into.
    check('no password configured means nothing is valid', !credentialsValid('admin', ''));
    check('no password configured rejects any guess', !credentialsValid('admin', 'anything'));
  });

  console.log('\n— session round trip —');
  await withEnv({ ADMIN_USER: 'admin', ADMIN_PASSWORD: 's3cret', SESSION_SECRET: undefined }, async () => {
    const token = await createSessionToken('admin');
    const session = await readSessionToken(token);
    check('a fresh token verifies', session?.user === 'admin');
    check('it carries an expiry in the future', (session?.expiresAt ?? 0) > Date.now());

    check('a tampered payload is rejected', (await readSessionToken(`x${token}`)) === null);
    check(
      'a tampered signature is rejected',
      (await readSessionToken(`${token.split('.')[0]}.AAAA`)) === null,
    );
    check('gibberish is rejected', (await readSessionToken('not-a-token')) === null);
    check('an empty token is rejected', (await readSessionToken('')) === null);
    check('a missing token is rejected', (await readSessionToken(undefined)) === null);
    check('a payload with no signature is rejected', (await readSessionToken('abc')) === null);

    // An expired cookie is not a valid one, however well signed.
    const expired = await createSessionToken('admin', Date.now() - 1000 * 60 * 60 * 24 * 30);
    check('an expired token is rejected', (await readSessionToken(expired)) === null);
  });

  console.log('\n— rotating a credential invalidates old cookies —');
  await withEnv({ ADMIN_USER: 'admin', ADMIN_PASSWORD: 'old-password', SESSION_SECRET: undefined }, async () => {
    const token = await createSessionToken('admin');
    check('valid before the change', (await readSessionToken(token)) !== null);

    await withEnv({ ADMIN_PASSWORD: 'new-password' }, async () => {
      check('changing the password signs everyone out', (await readSessionToken(token)) === null);
    });

    await withEnv({ ADMIN_USER: 'someone-else' }, async () => {
      check('changing the username signs everyone out', (await readSessionToken(token)) === null);
    });
  });

  console.log('\n— an explicit SESSION_SECRET survives a password change —');
  await withEnv(
    { ADMIN_USER: 'admin', ADMIN_PASSWORD: 'old-password', SESSION_SECRET: 'a-fixed-secret' },
    async () => {
      const token = await createSessionToken('admin');
      await withEnv({ ADMIN_PASSWORD: 'new-password' }, async () => {
        check('signature still verifies', (await readSessionToken(token)) !== null);
      });
    },
  );

  console.log('\n— where sign-in may redirect —');
  check('a normal path is kept', safeNextPath('/links') === '/links');
  check('a path with a query is kept', safeNextPath('/?period=week') === '/?period=week');
  check('an encoded path is kept', safeNextPath('/affiliate/_house') === '/affiliate/_house');
  check('nothing becomes the dashboard', safeNextPath(null) === '/');
  check('empty becomes the dashboard', safeNextPath('') === '/');
  // The ones that matter: every browser-legal way of writing another origin.
  check('a full URL is refused', safeNextPath('https://evil.example') === '/');
  check('a protocol-relative URL is refused', safeNextPath('//evil.example') === '/');
  check('a backslash URL is refused', safeNextPath('/\\evil.example') === '/');
  check('a backslash anywhere is refused', safeNextPath('/links\\@evil.example') === '/');
  check('a scheme-only value is refused', safeNextPath('javascript:alert(1)') === '/');
  check('a bare word is refused', safeNextPath('links') === '/');
  check('a newline is refused', safeNextPath('/links\nSet-Cookie: x=1') === '/');
  check('a tab is refused', safeNextPath('/links\tx') === '/');
  check('a NUL is refused', safeNextPath(`/links${String.fromCharCode(0)}`) === '/');
  check('a DEL is refused', safeNextPath(`/links${String.fromCharCode(127)}`) === '/');
  // Bouncing back to /login would loop the form onto itself.
  check('/login is refused', safeNextPath('/login') === '/');
  check('/login with a query is refused', safeNextPath('/login?next=/links') === '/');

  console.log(`\nauth: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
