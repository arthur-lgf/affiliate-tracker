// Sign-in: credentials, session cookies, and where a redirect is allowed to go.
//
// This is the code that decides who sees lead names, emails and phone numbers,
// so the rules are pinned here rather than left to a manual click-through.
//
// Since accounts became multi-user, the cookie also carries a *role* and a
// *tracking key*. Those two fields are what stand between one affiliate and
// another affiliate's earnings, so most of what is new below is about the ways
// a cookie could claim to be something it is not.
//
//   npx tsx scripts/auth-checks.ts
import {
  createSessionToken,
  ENV_ADMIN_ID,
  envCredentialsValid,
  readSessionToken,
  safeNextPath,
  timingSafeEqual,
  type SessionSubject,
} from '../src/lib/auth';
import { base64UrlDecode, base64UrlEncode } from '../src/lib/base64url';

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

const ADMIN: SessionSubject = {
  uid: ENV_ADMIN_ID,
  user: 'admin',
  role: 'admin',
  usr: '',
  pwdAt: 0,
};

const AFFILIATE: SessionSubject = {
  uid: '1a2b3c4d-0000-4000-8000-000000000001',
  user: 'arthur',
  role: 'affiliate',
  usr: 'arthur',
  pwdAt: 1_700_000_000_000,
};

/** Re-sign a payload we have edited, to prove the *content* checks bite too. */
function payloadOf(token: string): Record<string, unknown> {
  const raw = base64UrlDecode(token.slice(0, token.indexOf('.')))!;
  return JSON.parse(new TextDecoder().decode(raw));
}

function swapPayload(token: string, next: Record<string, unknown>): string {
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(next)));
  return `${encoded}.${token.slice(token.indexOf('.') + 1)}`;
}

async function main() {
  console.log('— constant-time compare —');
  check('equal strings match', timingSafeEqual('hunter2', 'hunter2'));
  check('different strings do not', !timingSafeEqual('hunter2', 'hunter3'));
  check('different lengths do not', !timingSafeEqual('short', 'longer-value'));
  check('empty vs empty matches', timingSafeEqual('', ''));
  check('empty vs non-empty does not', !timingSafeEqual('', 'x'));
  check('unicode compares by code unit', timingSafeEqual('pässwörd', 'pässwörd'));

  console.log('\n— the environment account —');
  await withEnv({ ADMIN_USER: 'admin', ADMIN_PASSWORD: 's3cret' }, () => {
    check('correct pair is valid', envCredentialsValid('admin', 's3cret'));
    check('wrong password is not', !envCredentialsValid('admin', 'nope'));
    check('wrong username is not', !envCredentialsValid('root', 's3cret'));
    check('empty pair is not', !envCredentialsValid('', ''));
    // Changed deliberately when accounts arrived: every username in the users
    // table is stored lowercased, so the built-in one matches that rule rather
    // than being the single case-sensitive name in the system.
    check('username is case insensitive', envCredentialsValid('Admin', 's3cret'));
    check('password is still case sensitive', !envCredentialsValid('admin', 'S3CRET'));
  });

  await withEnv({ ADMIN_USER: undefined, ADMIN_PASSWORD: 's3cret' }, () => {
    check('username defaults to admin', envCredentialsValid('admin', 's3cret'));
  });

  await withEnv({ ADMIN_USER: 'admin', ADMIN_PASSWORD: undefined }, () => {
    // With no password there is no account — not an account with a blank
    // password that anyone can walk into.
    check('no password configured means nothing is valid', !envCredentialsValid('admin', ''));
    check('no password configured rejects any guess', !envCredentialsValid('admin', 'anything'));
  });

  console.log('\n— session round trip —');
  await withEnv({ ADMIN_USER: 'admin', ADMIN_PASSWORD: 's3cret', SESSION_SECRET: undefined }, async () => {
    const token = await createSessionToken(ADMIN);
    const session = await readSessionToken(token);
    check('a fresh token verifies', session?.user === 'admin');
    check('it carries the role', session?.role === 'admin');
    check('it carries the user id', session?.uid === ENV_ADMIN_ID);
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
    const expired = await createSessionToken(ADMIN, Date.now() - 1000 * 60 * 60 * 24 * 30);
    check('an expired token is rejected', (await readSessionToken(expired)) === null);
  });

  console.log('\n— an affiliate session —');
  await withEnv({ SESSION_SECRET: 'a-fixed-secret', ADMIN_PASSWORD: undefined }, async () => {
    const token = await createSessionToken(AFFILIATE);
    const session = await readSessionToken(token);
    check('it verifies with only SESSION_SECRET set', session !== null);
    check('the role survives', session?.role === 'affiliate');
    check('the tracking key survives', session?.usr === 'arthur');
    check('the password stamp survives', session?.pwdAt === AFFILIATE.pwdAt);
    check('the row id survives', session?.uid === AFFILIATE.uid);
  });

  console.log('\n— a cookie cannot claim a shape it should never have —');
  await withEnv({ SESSION_SECRET: 'a-fixed-secret' }, async () => {
    // These re-use a VALID signature over an EDITED payload. They must fail on
    // the signature, which is the real defence; the shape checks below are the
    // second line, tested separately by re-signing.
    const token = await createSessionToken(AFFILIATE);
    const escalated = swapPayload(token, { ...payloadOf(token), role: 'admin', usr: '' });
    check(
      'editing the role to admin breaks the signature',
      (await readSessionToken(escalated)) === null,
    );

    const rekeyed = swapPayload(token, { ...payloadOf(token), usr: 'bianca' });
    check(
      'editing the tracking key breaks the signature',
      (await readSessionToken(rekeyed)) === null,
    );
  });

  console.log('\n— and the shape checks hold even for a correctly signed token —');
  await withEnv({ SESSION_SECRET: 'a-fixed-secret' }, async () => {
    // createSessionToken forces usr to '' for an admin, so an admin token with
    // a scope cannot be minted through the front door at all.
    const admin = await createSessionToken({ ...ADMIN, usr: 'arthur' });
    const parsed = payloadOf(admin);
    check('an admin subject is minted with no scope', parsed.usr === '');

    // An affiliate with no key: mintable, and refused on the way back in,
    // because an empty scope is one careless filter away from no filter.
    const scopeless = await createSessionToken({ ...AFFILIATE, usr: '' });
    check(
      'an affiliate with an empty key is rejected on read',
      (await readSessionToken(scopeless)) === null,
    );
  });

  console.log('\n— an old v1 cookie is not honoured —');
  await withEnv({ SESSION_SECRET: 'a-fixed-secret' }, async () => {
    // What the previous single-admin build issued: a user and an expiry, no
    // role. There is no safe way to guess what it should now be allowed to see.
    const legacy = { user: 'admin', expiresAt: Date.now() + 3_600_000 };
    const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(legacy)));
    const token = await createSessionToken(ADMIN);
    check(
      'a v1 payload is rejected',
      (await readSessionToken(swapPayload(token, legacy as never))) === null,
    );
    check('and so is a bare v1 shape', (await readSessionToken(`${encoded}.AAAA`)) === null);
  });

  console.log('\n— rotating a credential invalidates old cookies —');
  await withEnv({ ADMIN_USER: 'admin', ADMIN_PASSWORD: 'old-password', SESSION_SECRET: undefined }, async () => {
    const token = await createSessionToken(ADMIN);
    check('valid before the change', (await readSessionToken(token)) !== null);

    await withEnv({ ADMIN_PASSWORD: 'new-password' }, async () => {
      check('changing the password signs everyone out', (await readSessionToken(token)) === null);
    });

    await withEnv({ ADMIN_USER: 'someone-else' }, async () => {
      check('changing the username signs everyone out', (await readSessionToken(token)) === null);
    });
  });

  console.log('\n— with nothing configured, nothing verifies —');
  await withEnv({ ADMIN_PASSWORD: undefined, SESSION_SECRET: 'temporary' }, async () => {
    const token = await createSessionToken(AFFILIATE);
    await withEnv({ SESSION_SECRET: undefined }, async () => {
      // No signing material at all: the app is open, and an old cookie must not
      // be treated as proof of anything.
      check('a token cannot be read with no secret', (await readSessionToken(token)) === null);
    });
  });

  console.log('\n— an explicit SESSION_SECRET survives a password change —');
  await withEnv(
    { ADMIN_USER: 'admin', ADMIN_PASSWORD: 'old-password', SESSION_SECRET: 'a-fixed-secret' },
    async () => {
      const token = await createSessionToken(ADMIN);
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
